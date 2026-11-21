import type { MediaKind } from "@/lib/db/schema";

export type MediaView = "all" | "unused" | "mine" | "trash" | "orphan";
export type MediaSort = "createdAt" | "filename" | "sizeBytes" | "kind" | "usageCount";

export type MediaFilters = {
  view: MediaView;
  q?: string;
  kinds: MediaKind[];
  tagIds: string[];
  /** "none" désigne la vue Hors espace. */
  spaceId?: string;
  folderId?: string | "none";
  uploadedBy?: string;
  /** Médias précis (« Afficher les fichiers ajoutés »), toujours sous la visibilité. */
  ids?: string[];
  from?: string;
  to?: string;
  minSize?: number;
  maxSize?: number;
  sort: MediaSort;
  dir: "asc" | "desc";
  cursor?: string;
  limit: number;
};

/** Erreur de paramètres, message français, mappée en 400 par les routes. */
export class FilterError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "FilterError";
  }
}

const VIEWS: readonly MediaView[] = ["all", "unused", "mine", "trash", "orphan"];
const SORTS: readonly MediaSort[] = ["createdAt", "filename", "sizeBytes", "kind", "usageCount"];
const KINDS: readonly MediaKind[] = ["image", "pdf", "document", "video", "audio", "archive", "other"];
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const DEFAULT_LIMIT = 50;
export const MAX_LIMIT = 100;
const MAX_QUERY_LENGTH = 200;
const MAX_TAG_FILTERS = 50;
const MAX_ID_FILTERS = 100;

function uuid(value: string, name: string): string {
  if (!UUID_RE.test(value)) throw new FilterError(`Identifiant invalide : ${name}`);
  return value;
}

function nonNegativeInt(value: string, name: string): number {
  if (!/^\d{1,15}$/.test(value)) throw new FilterError(`Taille invalide : ${name}`);
  return Number(value);
}

function isoDate(value: string, name: string): string {
  if (Number.isNaN(Date.parse(value))) throw new FilterError(`Date invalide : ${name}`);
  return value;
}

export function parseMediaFilters(params: URLSearchParams): MediaFilters {
  const viewRaw = params.get("view") ?? "all";
  if (!(VIEWS as readonly string[]).includes(viewRaw)) throw new FilterError("Vue inconnue");

  const sortRaw = params.get("sort") ?? "createdAt";
  if (!(SORTS as readonly string[]).includes(sortRaw)) throw new FilterError("Tri inconnu");

  const dirRaw = params.get("dir") ?? "desc";
  if (dirRaw !== "asc" && dirRaw !== "desc") throw new FilterError("Sens de tri inconnu");

  const kinds: MediaKind[] = [];
  for (const k of params.getAll("kind")) {
    if (!(KINDS as readonly string[]).includes(k)) throw new FilterError("Type inconnu");
    if (!kinds.includes(k as MediaKind)) kinds.push(k as MediaKind);
  }

  const tagIds: string[] = [];
  for (const t of params.getAll("tagId")) {
    const id = uuid(t, "tagId");
    if (!tagIds.includes(id)) tagIds.push(id);
  }
  if (tagIds.length > MAX_TAG_FILTERS) throw new FilterError("Trop de tags dans le filtre");

  const ids: string[] = [];
  for (const raw of params.getAll("id")) {
    const id = uuid(raw, "id");
    if (!ids.includes(id)) ids.push(id);
  }
  if (ids.length > MAX_ID_FILTERS) throw new FilterError("Trop d'identifiants dans le filtre");

  let limit = DEFAULT_LIMIT;
  const limitRaw = params.get("limit");
  if (limitRaw !== null) {
    if (!/^\d{1,15}$/.test(limitRaw)) throw new FilterError("Limite invalide");
    limit = Number(limitRaw);
    if (limit < 1) throw new FilterError("Limite invalide");
    limit = Math.min(limit, MAX_LIMIT);
  }

  const filters: MediaFilters = {
    view: viewRaw as MediaView,
    kinds,
    tagIds,
    sort: sortRaw as MediaSort,
    dir: dirRaw,
    limit,
  };

  if (ids.length > 0) filters.ids = ids;

  const q = params.get("q")?.trim().slice(0, MAX_QUERY_LENGTH).trim();
  if (q) filters.q = q;

  const spaceId = params.get("spaceId");
  if (spaceId) filters.spaceId = spaceId === "none" ? "none" : uuid(spaceId, "spaceId");

  const folderId = params.get("folderId");
  if (folderId) filters.folderId = folderId === "none" ? "none" : uuid(folderId, "folderId");

  const uploadedBy = params.get("uploadedBy");
  if (uploadedBy) filters.uploadedBy = uuid(uploadedBy, "uploadedBy");

  const from = params.get("from");
  if (from) filters.from = isoDate(from, "from");
  const to = params.get("to");
  if (to) filters.to = isoDate(to, "to");
  if (filters.from && filters.to && Date.parse(filters.from) > Date.parse(filters.to)) {
    throw new FilterError("Période inversée : la date de début suit la date de fin");
  }

  const minSize = params.get("minSize");
  if (minSize) filters.minSize = nonNegativeInt(minSize, "minSize");
  const maxSize = params.get("maxSize");
  if (maxSize) filters.maxSize = nonNegativeInt(maxSize, "maxSize");
  if (filters.minSize !== undefined && filters.maxSize !== undefined && filters.minSize > filters.maxSize) {
    throw new FilterError("Taille minimale supérieure à la taille maximale");
  }

  const cursor = params.get("cursor");
  if (cursor) {
    // Le curseur porte le tri qui l'a produit : un autre tri le rend caduc.
    if (decodeCursor(cursor).sort !== sortRaw) throw new FilterError("Curseur invalide");
    filters.cursor = cursor;
  }

  return filters;
}

export function serializeMediaFilters(f: Partial<MediaFilters>): URLSearchParams {
  const p = new URLSearchParams();
  if (f.view && f.view !== "all") p.set("view", f.view);
  if (f.q) p.set("q", f.q);
  for (const k of f.kinds ?? []) p.append("kind", k);
  for (const t of f.tagIds ?? []) p.append("tagId", t);
  if (f.spaceId) p.set("spaceId", f.spaceId);
  if (f.folderId) p.set("folderId", f.folderId);
  if (f.uploadedBy) p.set("uploadedBy", f.uploadedBy);
  for (const id of f.ids ?? []) p.append("id", id);
  if (f.from) p.set("from", f.from);
  if (f.to) p.set("to", f.to);
  if (f.minSize !== undefined) p.set("minSize", String(f.minSize));
  if (f.maxSize !== undefined) p.set("maxSize", String(f.maxSize));
  if (f.sort && f.sort !== "createdAt") p.set("sort", f.sort);
  if (f.dir && f.dir !== "desc") p.set("dir", f.dir);
  if (f.cursor) p.set("cursor", f.cursor);
  if (f.limit !== undefined && f.limit !== DEFAULT_LIMIT) p.set("limit", String(f.limit));
  return p;
}

export function encodeCursor(sort: MediaSort, sortValue: string | number, id: string): string {
  return Buffer.from(JSON.stringify([sort, sortValue, id]), "utf8").toString("base64url");
}

export function decodeCursor(cursor: string): { sort: MediaSort; sortValue: string | number; id: string } {
  try {
    const parsed: unknown = JSON.parse(Buffer.from(cursor, "base64url").toString("utf8"));
    if (
      Array.isArray(parsed) &&
      parsed.length === 3 &&
      typeof parsed[0] === "string" &&
      (SORTS as readonly string[]).includes(parsed[0]) &&
      (typeof parsed[1] === "string" || (typeof parsed[1] === "number" && Number.isFinite(parsed[1]))) &&
      typeof parsed[2] === "string" &&
      parsed[2].length > 0
    ) {
      return { sort: parsed[0] as MediaSort, sortValue: parsed[1], id: parsed[2] };
    }
  } catch {
    // tombe sur l'erreur ci-dessous
  }
  throw new FilterError("Curseur invalide");
}
