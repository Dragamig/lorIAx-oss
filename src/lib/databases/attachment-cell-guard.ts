import type { SessionUser } from "@/types";
import { getMediaForAccess, resolveMediaAccess } from "@/lib/media/access";
import { MAX_ATTACHMENTS_PER_CELL, normalizeAttachments, normalizeImageCell } from "@/lib/media/cell-values";
import { loadColumnTypes } from "./row-writes";

export type AttachmentGuardResult = { ok: true } | { ok: false; status: number; error: string };

/** Valeur qui peut référencer un média (évite de lire les colonnes pour rien). */
function looksLikeMediaRef(value: unknown): boolean {
  if (typeof value === "string") return value.includes("/api/media/");
  if (!Array.isArray(value)) return false;
  if (value.length > MAX_ATTACHMENTS_PER_CELL) return true;
  return value.some((v) => v && typeof v === "object" && !Array.isArray(v) && "mediaId" in v);
}

/** Vrai si une cellule écrite peut référencer un média (sert à éviter des lectures inutiles). */
export function cellsReferenceMedia(cells: Record<string, unknown>): boolean {
  return Object.values(cells).some(looksLikeMediaRef);
}

/** Identifiants de médias déjà présents dans une valeur de référence (cellule déjà enregistrée). */
function knownMediaIds(type: string | undefined, value: unknown): Set<string> {
  const ids = new Set<string>();
  if (type === "image") {
    const img = normalizeImageCell(value);
    if (img.kind === "media") ids.add(img.mediaId);
  } else if (type === "attachment" && Array.isArray(value)) {
    for (const item of normalizeAttachments(value).items) {
      if (item.kind === "media") ids.add(item.value.mediaId);
    }
  }
  return ids;
}

async function canRead(mediaId: string, user: SessionUser, orgId: string): Promise<boolean> {
  const row = await getMediaForAccess(mediaId);
  const access = row ? await resolveMediaAccess(user, row, "read", { orgId }) : null;
  return !!access?.allowed;
}

/**
 * Contrôle les écritures de cellules de type `attachment` (plafond de 20 pièces,
 * chaque `mediaId` lisible) et `image` (un `/api/media/<id>` doit être lisible).
 * Lisible = accordé à l'utilisateur dans l'organisation de la requête (média
 * d'une autre organisation ou absent : refus). Les formes anciennes (`key`,
 * objets sans `key`, `/api/attachments/`, URL externes, `data:`) passent sans
 * contrôle. Si `known` (valeur enregistrée de la ligne, ou de la sauvegarde
 * restaurée) est fourni, seuls les `mediaId` absents de la valeur de référence
 * de la même colonne sont contrôlés ; le plafond de 20 reste appliqué au total.
 */
export async function validateAttachmentCells(
  databaseId: string,
  cells: Record<string, unknown>,
  user: SessionUser,
  orgId: string,
  known?: Record<string, unknown>
): Promise<AttachmentGuardResult> {
  const candidates = Object.entries(cells).filter(([, v]) => looksLikeMediaRef(v));
  if (candidates.length === 0) return { ok: true };

  const types = await loadColumnTypes(databaseId);
  for (const [columnId, value] of candidates) {
    if (types[columnId] === "image") {
      const img = normalizeImageCell(value);
      if (
        img.kind === "media" &&
        !knownMediaIds("image", known?.[columnId]).has(img.mediaId) &&
        !(await canRead(img.mediaId, user, orgId))) {
        return { ok: false, status: 400, error: "Image introuvable" };
      }
      continue;
    }
    if (types[columnId] !== "attachment" || !Array.isArray(value)) continue;
    const list = value as unknown[];
    if (list.length > MAX_ATTACHMENTS_PER_CELL) {
      return {
        ok: false,
        status: 400,
        error: `Une cellule accepte au plus ${MAX_ATTACHMENTS_PER_CELL} pièces jointes`,
      };
    }
    const already = knownMediaIds("attachment", known?.[columnId]);
    for (const item of normalizeAttachments(list).items) {
      if (item.kind !== "media" || already.has(item.value.mediaId)) continue;
      if (!(await canRead(item.value.mediaId, user, orgId))) {
        return { ok: false, status: 400, error: "Pièce jointe introuvable" };
      }
    }
  }
  return { ok: true };
}

/** Auteur d'une écriture de cellules, à qui les médias référencés doivent être lisibles. */
export type MediaGuardActor = { user: SessionUser | null; orgId: string };

export class MediaCellError extends Error {
  status = 400;
}

/**
 * Garde du niveau commun des écritures de lignes : sans `guard`, aucun contrôle
 * (écritures système). Sans utilisateur identifiable (`user: null`), toute
 * cellule qui référence un média est refusée. Lève {@link MediaCellError}.
 */
export async function assertMediaCells(
  databaseId: string,
  cells: Record<string, unknown>,
  guard: MediaGuardActor | undefined,
  known?: Record<string, unknown>
): Promise<void> {
  if (!guard) return;
  if (!guard.user) {
    if (Object.values(cells).some(looksLikeMediaRef)) {
      const types = await loadColumnTypes(databaseId);
      const refs = Object.entries(cells).some(
        ([id, v]) => looksLikeMediaRef(v) && (types[id] === "attachment" || types[id] === "image")
      );
      if (refs) throw new MediaCellError("Média introuvable");
    }
    return;
  }
  const res = await validateAttachmentCells(databaseId, cells, guard.user, guard.orgId, known);
  if (!res.ok) throw new MediaCellError(res.error);
}

/**
 * Copie de lignes (duplication de base) : neutralise, sans refuser la copie,
 * les références de médias que `user` ne peut pas lire dans `orgId`. Une image
 * illisible devient une cellule vide, une pièce jointe illisible est retirée de
 * la liste ; les formes héritées, externes et `data:` sont conservées. Même
 * critère de lecture que {@link validateAttachmentCells} (`canRead`), avec un
 * cache par appel pour ne lire chaque média qu'une fois.
 */
export async function neutralizeUnreadableMediaCells(
  types: Record<string, string>,
  rows: Record<string, unknown>[],
  user: SessionUser,
  orgId: string
): Promise<Record<string, unknown>[]> {
  const cache = new Map<string, boolean>();
  const readable = async (id: string) => {
    let ok = cache.get(id);
    if (ok === undefined) {
      ok = await canRead(id, user, orgId);
      cache.set(id, ok);
    }
    return ok;
  };
  const out: Record<string, unknown>[] = [];
  for (const cells of rows) {
    const next: Record<string, unknown> = { ...cells };
    for (const [columnId, value] of Object.entries(cells)) {
      if (!looksLikeMediaRef(value)) continue;
      if (types[columnId] === "image") {
        const img = normalizeImageCell(value);
        if (img.kind === "media" && !(await readable(img.mediaId))) next[columnId] = "";
      } else if (types[columnId] === "attachment" && Array.isArray(value)) {
        const kept: unknown[] = [];
        for (const raw of value) {
          const item = normalizeAttachments([raw]).items[0];
          if (item?.kind === "media" && !(await readable(item.value.mediaId))) continue;
          kept.push(raw);
        }
        next[columnId] = kept;
      }
    }
    out.push(next);
  }
  return out;
}
