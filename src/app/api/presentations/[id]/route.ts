/**
 * Présentation unique : lecture, enregistrement versionné, suppression.
 *
 * La table `presentations` ne connaît que l'espace : c'est lui, et jamais le
 * document porteur, qui décide de l'accès. On charge donc la ligne d'abord,
 * uniquement pour en tirer son `spaceId`, puis on autorise. `OrgScopeResource`
 * ne sait pas parler de présentation, ce détour est le contrat.
 */
import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { presentations } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import { requireOrgScoped, OrgScopeError } from "@/lib/auth/require-org-scoped";
import {
  getFileJson,
  listKeys,
  deleteFile,
} from "@/lib/storage/s3";
import { deckSchema, createEmptyDeck, type Deck } from "@/lib/presentations/deck";
import { guardPresentationsModule } from "@/lib/presentations/guards";
import {
  presentationKey,
  revisionPrefix,
  writeVersionedDeck,
} from "@/lib/presentations/versioned-write";
import {
  assertTemplateInOrg,
  canSeeTemplateRow,
  requireTemplateAdminFor,
  requireTemplateReader,
} from "@/lib/presentations/template-access";
import { readTemplateDeck } from "@/lib/presentations/templates";
import { z } from "zod";

/** Plafond de la charge utile sérialisée, aligné sur designs/[id]. */
const MAX_SIZE_BYTES = 5 * 1024 * 1024; // 5 Mo

/** Nombre de révisions conservées par présentation. */
const KEPT_REVISIONS = 10;

const currentKey = presentationKey;

async function loadPresentation(id: string) {
  // Identifiant non UUID : 404, jamais une erreur de cast en base (500).
  if (!z.string().uuid().safeParse(id).success) return null;
  const [row] = await db
    .select()
    .from(presentations)
    .where(eq(presentations.id, id))
    .limit(1);
  return row ?? null;
}

/**
 * Ne garde que les `KEPT_REVISIONS` révisions les plus récentes.
 *
 * Le tri porte sur le numéro extrait de la clé, pas sur l'ordre
 * lexicographique rendu par S3, qui placerait v10 avant v9. Toute erreur est
 * avalée : une purge est du ménage, elle ne doit jamais faire échouer un
 * enregistrement déjà réussi ni faire croire à l'utilisateur qu'il a perdu son
 * travail.
 */
async function purgeOldRevisions(id: string): Promise<void> {
  try {
    const keys = await listKeys(revisionPrefix(id));
    const numbered = keys
      .map((key) => {
        const match = /\/v(\d+)\.json$/.exec(key);
        return match ? { key, version: Number(match[1]) } : null;
      })
      .filter((entry): entry is { key: string; version: number } => entry !== null)
      .sort((a, b) => b.version - a.version);
    for (const stale of numbered.slice(KEPT_REVISIONS)) {
      await deleteFile(stale.key);
    }
  } catch (err) {
    console.error("[presentations/purge] Purge des révisions ignorée :", err);
  }
}

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const row = await loadPresentation(id);
  if (!row) return NextResponse.json({ error: "Introuvable" }, { status: 404 });

  // Modèle : lecture ouverte à tout membre de l'organisation, sans espace.
  // Un modèle masqué n'existe que pour l'administrateur.
  if (row.isTemplate) {
    const tctx = await requireTemplateReader(_req);
    if (tctx instanceof NextResponse) return tctx;
    const outside = assertTemplateInOrg(row, tctx.orgId);
    if (outside) return outside;
    if (!canSeeTemplateRow(tctx, row)) {
      return NextResponse.json({ error: "Introuvable" }, { status: 404 });
    }
    try {
      return NextResponse.json({ presentation: row, deck: await readTemplateDeck(row) });
    } catch (err) {
      console.error("[presentations/GET] Erreur S3 :", err);
      return NextResponse.json({ error: "Erreur serveur" }, { status: 500 });
    }
  }

  // Une présentation ordinaire a toujours un espace (contrainte en base).
  if (!row.spaceId) return NextResponse.json({ error: "Introuvable" }, { status: 404 });
  let ctx;
  try {
    ctx = await requireOrgScoped({
      resource: { type: "space", id: row.spaceId },
      minPermission: "viewer",
    });
  } catch (e) {
    if (e instanceof OrgScopeError) return e.response;
    throw e;
  }
  const blocked = await guardPresentationsModule(ctx.user);
  if (blocked) return blocked;

  try {
    // Clé absente : cas nominal d'une ligne créée dont l'envoi S3 n'a pas
    // abouti. On reconstruit un document vide plutôt que de bloquer l'ouverture
    // sur une erreur que l'utilisateur ne peut pas résoudre.
    const stored = await getFileJson<Deck>(currentKey(id));
    return NextResponse.json({
      presentation: row,
      deck: stored ?? createEmptyDeck(row.title),
    });
  } catch (err) {
    console.error("[presentations/GET] Erreur S3 :", err);
    return NextResponse.json({ error: "Erreur serveur" }, { status: 500 });
  }
}

const putSchema = z.object({
  deck: deckSchema,
  expectedVersion: z.number().int().positive(),
  title: z.string().min(1).optional(),
});

export async function PUT(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const row = await loadPresentation(id);
  if (!row) return NextResponse.json({ error: "Introuvable" }, { status: 404 });

  let ctx;
  if (row.isTemplate) {
    // Écrire un modèle est réservé à l'administrateur, même éditeur de
    // l'espace : refus avant toute lecture du corps et toute écriture S3.
    const tctx = await requireTemplateAdminFor(row, request);
    if (tctx instanceof NextResponse) return tctx;
    ctx = tctx;
  } else {
    if (!row.spaceId) return NextResponse.json({ error: "Introuvable" }, { status: 404 });
    try {
      ctx = await requireOrgScoped({
        resource: { type: "space", id: row.spaceId },
        minPermission: "editor",
      });
    } catch (e) {
      if (e instanceof OrgScopeError) return e.response;
      throw e;
    }
    const blocked = await guardPresentationsModule(ctx.user);
    if (blocked) return blocked;
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Corps JSON invalide" }, { status: 400 });
  }
  const parsed = putSchema.safeParse(body);
  if (!parsed.success)
    return NextResponse.json({ error: parsed.error.issues[0].message }, { status: 400 });
  const { deck, expectedVersion, title } = parsed.data;

  const serialized = JSON.stringify(deck);
  if (Buffer.byteLength(serialized, "utf-8") > MAX_SIZE_BYTES) {
    return NextResponse.json(
      { error: "Charge utile trop volumineuse (max 5 Mo)" },
      { status: 413 }
    );
  }

  // Concurrence optimiste, ligne avant objet S3 : voir writeVersionedDeck.
  const result = await writeVersionedDeck(row, deck, serialized, expectedVersion, title);
  if (result.status === "conflict") {
    if (result.currentVersion === null)
      return NextResponse.json({ error: "Introuvable" }, { status: 404 });
    return NextResponse.json(
      { error: "Version obsolète", currentVersion: result.currentVersion },
      { status: 409 }
    );
  }
  if (result.status === "storage-error") {
    return NextResponse.json({ error: "Erreur serveur" }, { status: 500 });
  }
  const updated = result.presentation;

  await purgeOldRevisions(id);

  return NextResponse.json({ ok: true, presentation: updated });
}

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const row = await loadPresentation(id);
  if (!row) return NextResponse.json({ error: "Introuvable" }, { status: 404 });

  // Un modèle ne se supprime pas : on le retire des modèles (masquage).
  if (row.isTemplate) {
    const tctx = await requireTemplateAdminFor(row, _req);
    if (tctx instanceof NextResponse) return tctx;
    return NextResponse.json({ error: "Retirer d'abord des modèles" }, { status: 409 });
  }

  if (!row.spaceId) return NextResponse.json({ error: "Introuvable" }, { status: 404 });
  let ctx;
  try {
    ctx = await requireOrgScoped({
      resource: { type: "space", id: row.spaceId },
      minPermission: "editor",
    });
  } catch (e) {
    if (e instanceof OrgScopeError) return e.response;
    throw e;
  }
  const blocked = await guardPresentationsModule(ctx.user);
  if (blocked) return blocked;

  await db.delete(presentations).where(eq(presentations.id, id));

  // Le stockage est nettoyé après la base, dans le même esprit que l'écriture :
  // un objet résiduel est du déchet inerte, une ligne pointant vers un objet
  // supprimé serait une présentation morte dans la liste.
  try {
    for (const key of await listKeys(revisionPrefix(id))) {
      await deleteFile(key);
    }
    await deleteFile(currentKey(id));
  } catch (err) {
    console.error("[presentations/DELETE] Nettoyage S3 incomplet :", err);
  }

  return NextResponse.json({ ok: true });
}
