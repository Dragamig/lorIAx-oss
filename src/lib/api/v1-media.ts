import { asc, eq, inArray } from "drizzle-orm";
import { db } from "@/lib/db";
import { media, mediaTagLinks, mediaTags, type Media } from "@/lib/db/schema";
import { getMediaFull, resolveMediaAccess } from "@/lib/media/access";
import type { MediaListItem } from "@/lib/media/list";
import { apiError } from "@/lib/api/response";
import type { SessionUser } from "@/types";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Forme publique d'un média en API v1 : aucun champ interne (clé de stockage, organisation, empreinte, auteur). */
export type V1Media = {
  id: string;
  filename: string;
  title: string | null;
  altText: string | null;
  kind: string;
  mimeType: string;
  sizeBytes: number;
  width: number | null;
  height: number | null;
  spaceId: string | null;
  folderId: string | null;
  tags: string[];
  createdAt: string;
  updatedAt: string;
  url: string;
  contentUrl: string;
};

type V1Source = {
  id: string;
  filename: string;
  title: string | null;
  altText: string | null;
  kind: string;
  mimeType: string;
  sizeBytes: number | string;
  width: number | null;
  height: number | null;
  spaceId: string | null;
  folderId: string | null;
  createdAt: Date | string;
  updatedAt: Date | string;
};

const iso = (d: Date | string) => (d instanceof Date ? d.toISOString() : d);

export function toV1Media(row: V1Source, tags: string[], updatedAt?: Date | string): V1Media {
  return {
    id: row.id,
    filename: row.filename,
    title: row.title,
    altText: row.altText,
    kind: row.kind,
    mimeType: row.mimeType,
    sizeBytes: Number(row.sizeBytes),
    width: row.width,
    height: row.height,
    spaceId: row.spaceId,
    folderId: row.folderId,
    tags,
    createdAt: iso(row.createdAt),
    updatedAt: iso(updatedAt ?? row.updatedAt ?? row.createdAt),
    url: `/api/media/${row.id}`,
    contentUrl: `/api/v1/media/${row.id}/content`,
  };
}

/** `updatedAt` n'est pas porté par la liste de la médiathèque : relu pour la page courante. */
export async function listItemsToV1(items: MediaListItem[]): Promise<V1Media[]> {
  const ids = items.map((i) => i.id);
  const rows =
    ids.length > 0
      ? await db.select({ id: media.id, updatedAt: media.updatedAt }).from(media).where(inArray(media.id, ids))
      : [];
  const updated = new Map(rows.map((r) => [r.id, r.updatedAt]));
  return items.map((item) =>
    toV1Media(
      { ...item, updatedAt: updated.get(item.id) ?? item.createdAt },
      item.tags.map((t) => t.label)
    )
  );
}

/**
 * Lecture d'un média par `<id>` pour l'API v1 : 404 silencieux pour un
 * identifiant invalide, inconnu, d'une autre organisation, en corbeille ou
 * illisible (jamais de différence observable avec un média absent).
 */
export async function loadReadableMedia(
  user: SessionUser,
  orgId: string,
  id: string
): Promise<{ ok: true; row: Media } | { ok: false; res: ReturnType<typeof apiError> }> {
  const notFound = { ok: false as const, res: apiError("Média introuvable", 404) };
  if (!UUID_RE.test(id)) return notFound;
  const row = await getMediaFull(id);
  if (!row || row.deletedAt) return notFound;
  const verdict = await resolveMediaAccess(user, row, "read", { orgId });
  if (!verdict.allowed) return notFound;
  return { ok: true, row };
}

export async function getMediaTagLabels(mediaId: string): Promise<string[]> {
  const rows = await db
    .select({ label: mediaTags.label })
    .from(mediaTagLinks)
    .innerJoin(mediaTags, eq(mediaTags.id, mediaTagLinks.tagId))
    .where(eq(mediaTagLinks.mediaId, mediaId))
    .orderBy(asc(mediaTags.label));
  return rows.map((r) => r.label);
}
