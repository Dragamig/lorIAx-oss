import { and, asc, desc, eq, inArray, isNotNull, isNull, or, sql, type SQL } from "drizzle-orm";
import { db } from "@/lib/db";
import { media, mediaTagLinks, mediaTags, spaces, users, type MediaKind } from "@/lib/db/schema";
import {
  checkSpaceWriteAccess,
  getAccessibleSpaceIds,
  getWritableSpaceIds,
} from "@/lib/auth/check-access";
import { getHooks } from "@/lib/modules/hooks";
import { isOrgAdminOrOwner } from "@/lib/media/access";
import { notDesignThumbnail } from "@/lib/media/design-thumbnail-key";
import { getLibrarySettings } from "@/lib/media/library-settings";
import { getOrgStorageUsedBytes } from "@/lib/media/quota";
import {
  FilterError,
  decodeCursor,
  encodeCursor,
  type MediaFilters,
  type MediaSort,
} from "@/lib/media/filters";
import { mediaThumbnailUrl } from "@/lib/media/urls";
import type { SessionUser } from "@/types";

export type MediaListItem = {
  id: string;
  filename: string;
  title: string | null;
  altText: string | null;
  kind: MediaKind;
  mimeType: string;
  sizeBytes: number;
  width: number | null;
  height: number | null;
  spaceId: string | null;
  spaceName: string | null;
  folderId: string | null;
  uploadedBy: string;
  uploaderName: string;
  createdAt: string;
  deletedAt: string | null;
  /** Date de purge prévue (mise à la corbeille + délai du réglage), nulle hors corbeille. */
  purgeAt: string | null;
  /** Vue corbeille seulement : nombre de contenus touchés (usages). */
  affectedCount?: number;
  url: string;
  thumbnailUrl: string | null;
  /** Version courante : clé de rafraîchissement des vignettes et de l'aperçu. */
  currentVersion: number;
  usageCount: number;
  tags: { id: string; label: string }[];
  canWrite: boolean;
  /** Utilisé dans un document dont un lien public est actif. */
  publicShared: boolean;
};

/** Lien d'un dérivé vers son original : le nom n'est jamais divulgué si l'original n'est pas lisible. */
export type RetouchSource =
  | { readable: true; id: string; name: string; version: number }
  | { readable: false };

export type RetouchLinks = {
  /** Nul : pas un dérivé, ou original supprimé (aucune ligne à afficher). */
  retouchedFrom: RetouchSource | null;
  /** Retouches lisibles de l'original seulement (jamais un décompte incluant des médias invisibles). */
  retouches: { id: string; name: string; thumbnailUrl: string | null }[];
};

export const RETOUCHES_LISTED_MAX = 50;

export type LibraryStats = {
  total: number;
  unused: number;
  mine: number;
  trash: number;
  orphan: number;
  noFolder: number;
  byFolder: Record<string, number>;
  byTag: { id: string; label: string; count: number }[];
  usedBytes: number;
  limitBytes: number | null;
  percent: number | null;
};

/**
 * - `live` : médias hors corbeille, jugés sur le droit de lecture ;
 * - `trash` : médias en corbeille, jugés sur le droit d'écriture ;
 * - `any` : les deux branches, équivalent exact du résolveur `resolveMediaAccess`.
 */
export type VisibilityScope = "live" | "trash" | "any";

const NO_ROWS = sql`false`;

function inSpaces(ids: string[]): SQL {
  return ids.length > 0 ? inArray(media.spaceId, ids) : NO_ROWS;
}

/**
 * Condition SQL de visibilité, alignée sur les règles 1 à 4 du résolveur
 * d'accès : même organisation ; corbeille visible de qui peut écrire ; espace
 * lisible ; sans espace, auteur ou admin/owner de l'organisation.
 */
export async function visibleMediaCondition(
  user: SessionUser,
  orgId: string,
  scope: VisibilityScope = "any"
): Promise<SQL> {
  const [readable, isAdmin] = await Promise.all([
    getAccessibleSpaceIds(user),
    isOrgAdminOrOwner(user.id, orgId),
  ]);
  const orphan: SQL = isAdmin
    ? isNull(media.spaceId)
    : and(isNull(media.spaceId), eq(media.uploadedBy, user.id))!;

  const live = and(isNull(media.deletedAt), or(inSpaces(readable), orphan))!;

  let trash: SQL = NO_ROWS;
  if (scope !== "live") {
    const writable = await getWritableSpaceIds(user, orgId, readable);
    trash = and(isNotNull(media.deletedAt), or(inSpaces(writable), orphan))!;
  }

  const branch = scope === "live" ? live : scope === "trash" ? trash : or(live, trash)!;
  return and(eq(media.organizationId, orgId), branch)!;
}

/** Visibilité + exclusion des miniatures techniques de design (liste, compteurs, recherche, sélecteur). */
export async function listableMediaCondition(
  user: SessionUser,
  orgId: string,
  scope: VisibilityScope = "any"
): Promise<SQL> {
  return and(await visibleMediaCondition(user, orgId, scope), notDesignThumbnail())!;
}

/** Valeur de tri : horodatage en millisecondes entières (le curseur est exact). */
const CREATED_MS = sql<number>`(floor(extract(epoch from ${media.createdAt}) * 1000))::bigint`;
const PUBLIC_SHARED = sql<boolean>`exists (select 1 from media_usages mu inner join public_shares ps on ps.document_id = mu.target_id where mu.media_id = ${media.id} and mu.target_type = 'document' and ps.revoked_at is null and (ps.expires_at is null or ps.expires_at > now()))`;
const USAGE_COUNT = sql<number>`(select count(*)::int from media_usages mu where mu.media_id = ${media.id})`;

type SortSpec = { expr: SQL; numeric: boolean };

function sortSpec(sort: MediaSort): SortSpec {
  switch (sort) {
    case "createdAt":
      return { expr: CREATED_MS, numeric: true };
    case "sizeBytes":
      return { expr: sql`${media.sizeBytes}`, numeric: true };
    case "usageCount":
      return { expr: USAGE_COUNT, numeric: true };
    case "filename":
      return { expr: sql`${media.filename}`, numeric: false };
    case "kind":
      return { expr: sql`${media.kind}::text`, numeric: false };
  }
}

function likePattern(q: string): string {
  return `%${q.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
}

function filterConditions(user: SessionUser, f: MediaFilters): SQL[] {
  const c: SQL[] = [];
  if (f.view === "unused") c.push(sql`${USAGE_COUNT} = 0`);
  if (f.view === "mine") c.push(eq(media.uploadedBy, user.id));
  if (f.view === "orphan") c.push(isNull(media.spaceId));

  if (f.q) {
    const p = likePattern(f.q);
    c.push(
      sql`(${media.filename} ilike ${p} or ${media.title} ilike ${p} or ${media.altText} ilike ${p} or ${media.description} ilike ${p} or exists (select 1 from ${mediaTagLinks} l inner join ${mediaTags} t on t.id = l.tag_id where l.media_id = ${media.id} and t.label ilike ${p}))`
    );
  }
  if (f.kinds.length > 0) c.push(inArray(media.kind, f.kinds));
  // Plusieurs tags : le média doit les porter tous.
  if (f.tagIds.length > 0) {
    c.push(
      sql`(select count(distinct l.tag_id) from ${mediaTagLinks} l where l.media_id = ${media.id} and l.tag_id in (${sql.join(
        f.tagIds.map((t) => sql`${t}`),
        sql`, `
      )})) = ${f.tagIds.length}`
    );
  }
  if (f.spaceId === "none") c.push(isNull(media.spaceId));
  else if (f.spaceId) c.push(eq(media.spaceId, f.spaceId));
  if (f.folderId === "none") c.push(isNull(media.folderId));
  else if (f.folderId) c.push(eq(media.folderId, f.folderId));
  if (f.uploadedBy) c.push(eq(media.uploadedBy, f.uploadedBy));
  if (f.ids && f.ids.length > 0) c.push(inArray(media.id, f.ids));
  if (f.from) c.push(sql`${media.createdAt} >= ${new Date(f.from)}`);
  if (f.to) c.push(sql`${media.createdAt} <= ${new Date(f.to)}`);
  if (f.minSize !== undefined) c.push(sql`${media.sizeBytes} >= ${f.minSize}`);
  if (f.maxSize !== undefined) c.push(sql`${media.sizeBytes} <= ${f.maxSize}`);
  return c;
}

function cursorCondition(f: MediaFilters, spec: SortSpec): SQL | null {
  if (!f.cursor) return null;
  const { sort, sortValue, id } = decodeCursor(f.cursor);
  if (sort !== f.sort) throw new FilterError("Curseur invalide");
  if (spec.numeric !== (typeof sortValue === "number")) throw new FilterError("Curseur invalide");
  if (typeof sortValue === "number" && !Number.isSafeInteger(sortValue)) {
    throw new FilterError("Curseur invalide");
  }
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) {
    throw new FilterError("Curseur invalide");
  }
  const op = f.dir === "asc" ? sql`>` : sql`<`;
  return sql`(${spec.expr} ${op} ${sortValue} or (${spec.expr} = ${sortValue} and ${media.id} ${op} ${id}))`;
}

export async function listMedia(
  user: SessionUser,
  orgId: string,
  f: MediaFilters
): Promise<{ items: MediaListItem[]; nextCursor: string | null }> {
  const spec = sortSpec(f.sort);
  const cursor = cursorCondition(f, spec);
  const visible = await listableMediaCondition(user, orgId, f.view === "trash" ? "trash" : "live");
  const where = and(visible, ...filterConditions(user, f), cursor ?? undefined);
  const dirFn = f.dir === "asc" ? asc : desc;

  const rows = await db
    .select({
      id: media.id,
      filename: media.filename,
      title: media.title,
      altText: media.altText,
      kind: media.kind,
      mimeType: media.mimeType,
      sizeBytes: media.sizeBytes,
      width: media.width,
      height: media.height,
      spaceId: media.spaceId,
      spaceName: spaces.name,
      folderId: media.folderId,
      uploadedBy: media.uploadedBy,
      uploaderName: users.name,
      createdAt: media.createdAt,
      deletedAt: media.deletedAt,
      thumbnailKey: media.thumbnailKey,
      currentVersion: media.currentVersion,
      usageCount: USAGE_COUNT,
      publicShared: PUBLIC_SHARED,
      sortValue: spec.expr,
    })
    .from(media)
    .leftJoin(spaces, eq(spaces.id, media.spaceId))
    .leftJoin(users, eq(users.id, media.uploadedBy))
    .where(where)
    .orderBy(dirFn(spec.expr), dirFn(media.id))
    .limit(f.limit + 1);

  const hasMore = rows.length > f.limit;
  const page = hasMore ? rows.slice(0, f.limit) : rows;

  const ids = page.map((r) => r.id);
  const tagRows =
    ids.length > 0
      ? await db
          .select({ mediaId: mediaTagLinks.mediaId, id: mediaTags.id, label: mediaTags.label })
          .from(mediaTagLinks)
          .innerJoin(mediaTags, eq(mediaTags.id, mediaTagLinks.tagId))
          .where(inArray(mediaTagLinks.mediaId, ids))
          .orderBy(asc(mediaTags.label))
      : [];
  const tagsByMedia = new Map<string, { id: string; label: string }[]>();
  for (const t of tagRows) {
    const list = tagsByMedia.get(t.mediaId) ?? [];
    list.push({ id: t.id, label: t.label });
    tagsByMedia.set(t.mediaId, list);
  }

  // canWrite : une fois par espace distinct de la page, règle 4 hors espace.
  const isAdmin = await isOrgAdminOrOwner(user.id, orgId);
  const spaceWrite = new Map<string, boolean>();
  for (const sid of new Set(page.map((r) => r.spaceId).filter((s): s is string => !!s))) {
    spaceWrite.set(sid, await checkSpaceWriteAccess(user, sid, { orgId }));
  }

  const inTrash = f.view === "trash";
  const retentionMs = inTrash ? (await getLibrarySettings()).trashRetentionDays * 86_400_000 : 0;

  const items: MediaListItem[] = page.map((r) => ({
    id: r.id,
    filename: r.filename,
    title: r.title,
    altText: r.altText,
    kind: r.kind,
    mimeType: r.mimeType,
    sizeBytes: Number(r.sizeBytes),
    width: r.width,
    height: r.height,
    spaceId: r.spaceId,
    spaceName: r.spaceName ?? null,
    folderId: r.folderId,
    uploadedBy: r.uploadedBy,
    uploaderName: r.uploaderName ?? "",
    createdAt: r.createdAt.toISOString(),
    deletedAt: r.deletedAt ? r.deletedAt.toISOString() : null,
    purgeAt: inTrash && r.deletedAt ? new Date(r.deletedAt.getTime() + retentionMs).toISOString() : null,
    ...(inTrash ? { affectedCount: Number(r.usageCount) } : {}),
    url: `/api/media/${r.id}`,
    thumbnailUrl: r.thumbnailKey ? mediaThumbnailUrl({ id: r.id, currentVersion: r.currentVersion }) : null,
    currentVersion: r.currentVersion,
    usageCount: Number(r.usageCount),
    tags: tagsByMedia.get(r.id) ?? [],
    publicShared: !!r.publicShared,
    canWrite: r.spaceId ? (spaceWrite.get(r.spaceId) ?? false) : isAdmin || r.uploadedBy === user.id,
  }));

  const last = page[page.length - 1];
  const nextCursor =
    hasMore && last ? encodeCursor(f.sort, spec.numeric ? Number(last.sortValue) : String(last.sortValue), last.id) : null;
  return { items, nextCursor };
}

export async function getLibraryStats(user: SessionUser, orgId: string): Promise<LibraryStats> {
  const [live, trash] = await Promise.all([
    listableMediaCondition(user, orgId, "live"),
    listableMediaCondition(user, orgId, "trash"),
  ]);

  const [counts] = await db
    .select({
      total: sql<number>`count(*)::int`,
      unused: sql<number>`(count(*) filter (where ${USAGE_COUNT} = 0))::int`,
      mine: sql<number>`(count(*) filter (where ${media.uploadedBy} = ${user.id}))::int`,
      orphan: sql<number>`(count(*) filter (where ${media.spaceId} is null))::int`,
      noFolder: sql<number>`(count(*) filter (where ${media.folderId} is null))::int`,
    })
    .from(media)
    .where(live);

  const [trashCount] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(media)
    .where(trash);

  const folderRows = await db
    .select({ folderId: media.folderId, n: sql<number>`count(*)::int` })
    .from(media)
    .where(and(live, isNotNull(media.folderId)))
    .groupBy(media.folderId);
  const byFolder: Record<string, number> = {};
  for (const r of folderRows) if (r.folderId) byFolder[r.folderId] = Number(r.n);

  const tagRows = await db
    .select({ id: mediaTags.id, label: mediaTags.label, n: sql<number>`count(*)::int` })
    .from(mediaTagLinks)
    .innerJoin(media, eq(media.id, mediaTagLinks.mediaId))
    .innerJoin(mediaTags, eq(mediaTags.id, mediaTagLinks.tagId))
    .where(live)
    .groupBy(mediaTags.id, mediaTags.label)
    .orderBy(asc(mediaTags.label));

  const [usedBytes, limitBytes] = await Promise.all([
    getOrgStorageUsedBytes(orgId),
    getHooks().usage.getOrgStorageLimitBytes(orgId),
  ]);
  const percent = limitBytes && limitBytes > 0 ? Math.round((usedBytes / limitBytes) * 1000) / 10 : null;

  return {
    total: Number(counts?.total ?? 0),
    unused: Number(counts?.unused ?? 0),
    mine: Number(counts?.mine ?? 0),
    trash: Number(trashCount?.n ?? 0),
    orphan: Number(counts?.orphan ?? 0),
    noFolder: Number(counts?.noFolder ?? 0),
    byFolder,
    byTag: tagRows.map((t) => ({ id: t.id, label: t.label, count: Number(t.n) })),
    usedBytes,
    limitBytes,
    percent,
  };
}


/** « Retouché depuis » et « Retouches » d'un média, filtrés par ce que `user` peut lire. */
export async function getRetouchLinks(
  user: SessionUser,
  orgId: string,
  row: { id: string; sourceMediaId: string | null },
): Promise<RetouchLinks> {
  const visible = await listableMediaCondition(user, orgId, "live");
  const [source, derived] = await Promise.all([
    row.sourceMediaId
      ? db
          .select({
            id: media.id,
            name: sql<string>`coalesce(${media.title}, ${media.filename})`,
            version: media.currentVersion,
            deletedAt: media.deletedAt,
            organizationId: media.organizationId,
            readable: sql<boolean>`(${visible})`,
          })
          .from(media)
          .where(eq(media.id, row.sourceMediaId))
          .limit(1)
      : Promise.resolve([]),
    db
      .select({
        id: media.id,
        name: sql<string>`coalesce(${media.title}, ${media.filename})`,
        thumbnailKey: media.thumbnailKey,
        currentVersion: media.currentVersion,
        filename: media.filename,
      })
      .from(media)
      .where(and(eq(media.sourceMediaId, row.id), eq(media.organizationId, orgId), visible))
      .orderBy(desc(media.createdAt))
      .limit(RETOUCHES_LISTED_MAX),
  ]);
  const src = source[0];
  let retouchedFrom: RetouchSource | null = null;
  if (src && !src.deletedAt && src.organizationId === orgId) {
    retouchedFrom = src.readable
      ? { readable: true, id: src.id, name: src.name, version: src.version }
      : { readable: false };
  }
  return {
    retouchedFrom,
    retouches: derived.map((d) => ({
      id: d.id,
      name: d.name,
      thumbnailUrl: d.thumbnailKey ? mediaThumbnailUrl({ id: d.id, currentVersion: d.currentVersion }) : null,
    })),
  };
}
