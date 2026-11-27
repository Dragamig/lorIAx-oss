/**
 * Contrôle d'accès des canevas embarqués (tableau blanc, mind map, design).
 *
 * Ces ressources sont adressées par un identifiant généré côté client et écrit
 * en clair dans le markdown du document porteur. Sans rattachement en base,
 * tout compte authentifié pouvait lire et écraser le canevas de n'importe
 * quelle organisation en devinant ou récupérant cet identifiant.
 *
 * Règles appliquées ici :
 *  1. La base fait foi. Si la ligne existe et porte un `documentId`, celui
 *     annoncé par le client est ignoré et le contrôle porte sur celui stocké.
 *  2. Création (aucune ligne) : le `documentId` client est retenu, mais
 *     seulement après un `checkDocumentEditAccess` réussi ; l'appelant doit
 *     écrire le lien dans le même insert (jamais de ligne neuve orpheline).
 *  3. Adoption (ligne présente, `documentId` nul) : le lien n'est accepté que
 *     si l'appelant peut éditer le document annoncé ET que le contenu de ce
 *     document contient effectivement l'identifiant du canevas. Double
 *     condition non usurpable, qui répare automatiquement les traînards.
 *  4. Fail-closed : une ligne restée sans rattachement est inaccessible en
 *     lecture. Après backfill, ce reliquat ne contient que des orphelins déjà
 *     invisibles dans l'interface.
 */
import { db } from "@/lib/db";
import { documents } from "@/lib/db/schema";
import { and, eq, like } from "drizzle-orm";
import {
  checkDocumentViewAccess,
  checkDocumentEditAccess,
} from "@/lib/auth/check-access";
import type { SessionUser } from "@/types";

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type CanvasAccessResult =
  | { ok: true; documentId: string }
  | { ok: false; status: 400 | 403 };

/** Extrait le documentId annoncé par le client (query string `documentId`). */
export function getRequestedDocumentId(request: {
  nextUrl?: { searchParams: URLSearchParams };
  url: string;
}): string | null {
  const params =
    request.nextUrl?.searchParams ?? new URL(request.url).searchParams;
  const raw = params.get("documentId");
  if (!raw || !UUID_RE.test(raw)) return null;
  return raw;
}

async function getDocumentSpaceId(documentId: string): Promise<string | null> {
  const [doc] = await db
    .select({ spaceId: documents.spaceId })
    .from(documents)
    .where(eq(documents.id, documentId))
    .limit(1);
  return doc?.spaceId ?? null;
}

/** Le contenu du document contient-il littéralement cet identifiant ? */
async function documentMentionsResource(
  documentId: string,
  resourceId: string
): Promise<boolean> {
  // `resourceId` est validé en UUID par l'appelant : aucun métacaractère LIKE
  // (`%`, `_`) ne peut s'y glisser.
  const [row] = await db
    .select({ id: documents.id })
    .from(documents)
    .where(
      and(
        eq(documents.id, documentId),
        like(documents.contentText, `%${resourceId}%`)
      )
    )
    .limit(1);
  return !!row;
}

/**
 * Vérifie l'accès en lecture à un canevas déjà rattaché.
 *
 * @param storedDocumentId `document_id` lu en base (null = non rattaché).
 * @returns 403 si non rattaché (fail-closed) ou si la lecture est refusée.
 */
export async function checkCanvasViewAccess(
  user: SessionUser,
  storedDocumentId: string | null
): Promise<CanvasAccessResult> {
  if (!storedDocumentId) return { ok: false, status: 403 };

  const spaceId = await getDocumentSpaceId(storedDocumentId);
  if (!spaceId) return { ok: false, status: 403 };

  const allowed = await checkDocumentViewAccess(user, spaceId, storedDocumentId);
  return allowed
    ? { ok: true, documentId: storedDocumentId }
    : { ok: false, status: 403 };
}

/**
 * Vérifie l'accès en écriture et résout le document à rattacher.
 *
 * @param rowExists  une ligne existe-t-elle déjà pour cet identifiant ?
 * @param storedDocumentId  `document_id` de cette ligne (null si non rattachée).
 * @param requestedDocumentId  `documentId` annoncé par le client.
 * @returns en cas de succès, le documentId à persister sur la ligne.
 */
export async function checkCanvasEditAccess(
  user: SessionUser,
  resourceId: string,
  {
    rowExists,
    storedDocumentId,
    requestedDocumentId,
    requireMention = false,
  }: {
    rowExists: boolean;
    storedDocumentId: string | null;
    requestedDocumentId: string | null;
    /** Exige que le document mentionne la ressource même sans ligne existante (routes qui n'insèrent pas). */
    requireMention?: boolean;
  }
): Promise<CanvasAccessResult> {
  // 1. Ligne déjà rattachée : la base fait foi, le paramètre client est ignoré.
  if (storedDocumentId) {
    const spaceId = await getDocumentSpaceId(storedDocumentId);
    if (!spaceId) return { ok: false, status: 403 };
    const allowed = await checkDocumentEditAccess(
      user,
      spaceId,
      storedDocumentId
    );
    return allowed
      ? { ok: true, documentId: storedDocumentId }
      : { ok: false, status: 403 };
  }

  // 2. Aucun rattachement : le client doit annoncer son document.
  if (!requestedDocumentId) return { ok: false, status: 400 };

  const spaceId = await getDocumentSpaceId(requestedDocumentId);
  if (!spaceId) return { ok: false, status: 403 };

  const canEdit = await checkDocumentEditAccess(
    user,
    spaceId,
    requestedDocumentId
  );
  if (!canEdit) return { ok: false, status: 403 };

  // 3. Adoption d'une ligne préexistante : exiger en plus que le document
  //    contienne réellement l'identifiant, sinon n'importe quel éditeur
  //    pourrait s'approprier le canevas d'une autre organisation.
  if (rowExists || requireMention) {
    const mentioned = await documentMentionsResource(
      requestedDocumentId,
      resourceId
    );
    if (!mentioned) return { ok: false, status: 403 };
  }

  // 4. Création : le lien est retenu et doit être écrit dans le même insert.
  return { ok: true, documentId: requestedDocumentId };
}
