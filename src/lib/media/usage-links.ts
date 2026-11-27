import { and, eq, inArray } from "drizzle-orm";
import { db } from "@/lib/db";
import {
  brandKits,
  documents,
  media,
  mediaUsages,
  spaces,
  userDatabaseRows,
  userDatabases,
  whiteboardSnapshots,
  type MediaUsageSource,
  type MediaUsageTarget,
} from "@/lib/db/schema";
import { checkDocumentViewAccess, checkSpaceReadAccess } from "@/lib/auth/check-access";
import { getMediaForAccess, resolveMediaAccess } from "@/lib/media/access";
import { visibleMediaCondition } from "@/lib/media/list";
import type { SessionUser } from "@/types";
import { INCLUDED_MODULE_IDS } from "@/lib/modules/registry.generated";

export type UsageEntry = {
  targetType: MediaUsageTarget;
  targetId: string;
  context: string | null;
  title: string;
  href: string;
  source: MediaUsageSource;
};

export const USAGES_MAX = 500;
export const SUMMARY_MAX_IDS = 200;

type UsageRow = {
  mediaId: string;
  targetType: MediaUsageTarget;
  targetId: string;
  context: string | null;
  source: MediaUsageSource;
  spaceId: string | null;
};

const USAGE_COLUMNS = {
  mediaId: mediaUsages.mediaId,
  targetType: mediaUsages.targetType,
  targetId: mediaUsages.targetId,
  context: mediaUsages.context,
  source: mediaUsages.source,
  spaceId: mediaUsages.spaceId,
};

/**
 * Pour chaque usage, l'entrée affichable ou `null` (cible illisible ou
 * introuvable). Aucun titre ni lien n'est produit pour une cible masquée.
 * Une requête groupée par type de cible, puis des contrôles mis en cache par
 * espace ; `media_usages.space_id` n'est qu'un repli quand la cible n'a pas de
 * table source dans l'organisation.
 */
async function classifyUsages(
  user: SessionUser,
  orgId: string,
  rows: UsageRow[]
): Promise<(UsageEntry | null)[]> {
  const docIds = [...new Set(rows.filter((r) => r.targetType === "document").map((r) => r.targetId))];
  const rowIds = [
    ...new Set(rows.filter((r) => r.targetType === "database_row").map((r) => r.targetId)),
  ];
  const kitIds = [...new Set(rows.filter((r) => r.targetType === "brand_kit").map((r) => r.targetId))];

  const docs = new Map<string, { title: string; spaceId: string; spaceSlug: string; orgId: string }>();
  if (docIds.length > 0) {
    const found = await db
      .select({
        id: documents.id,
        title: documents.title,
        spaceId: documents.spaceId,
        spaceSlug: spaces.slug,
        orgId: spaces.organizationId,
      })
      .from(documents)
      .innerJoin(spaces, eq(spaces.id, documents.spaceId))
      .where(inArray(documents.id, docIds));
    for (const d of found) docs.set(d.id, d);
  }

  const dbRows = new Map<string, { databaseId: string; name: string; spaceId: string; orgId: string }>();
  if (rowIds.length > 0) {
    const found = await db
      .select({
        id: userDatabaseRows.id,
        databaseId: userDatabases.id,
        name: userDatabases.name,
        spaceId: userDatabases.spaceId,
        orgId: spaces.organizationId,
      })
      .from(userDatabaseRows)
      .innerJoin(userDatabases, eq(userDatabases.id, userDatabaseRows.databaseId))
      .innerJoin(spaces, eq(spaces.id, userDatabases.spaceId))
      .where(inArray(userDatabaseRows.id, rowIds));
    for (const r of found) dbRows.set(r.id, r);
  }

  const kits = new Set<string>();
  if (kitIds.length > 0) {
    const found = await db
      .select({ id: brandKits.id })
      .from(brandKits)
      .where(and(inArray(brandKits.id, kitIds), eq(brandKits.organizationId, orgId)));
    for (const k of found) kits.add(k.id);
  }

  // Le tableau blanc est identifié par son canvasId (texte) ; il se lit comme le document qui le porte.
  const boardIds = [...new Set(rows.filter((r) => r.targetType === "whiteboard").map((r) => r.targetId))];
  const boards = new Map<string, { documentId: string; spaceId: string; spaceSlug: string; orgId: string }>();
  if (boardIds.length > 0) {
    const found = await db
      .select({
        canvasId: whiteboardSnapshots.canvasId,
        documentId: documents.id,
        spaceId: documents.spaceId,
        spaceSlug: spaces.slug,
        orgId: spaces.organizationId,
      })
      .from(whiteboardSnapshots)
      .innerJoin(documents, eq(documents.id, whiteboardSnapshots.documentId))
      .innerJoin(spaces, eq(spaces.id, documents.spaceId))
      .where(inArray(whiteboardSnapshots.canvasId, boardIds));
    for (const b of found) boards.set(b.canvasId, b);
  }

  const spaceCache = new Map<string, Promise<boolean>>();
  const canReadSpace = (spaceId: string | null): Promise<boolean> => {
    if (!spaceId) return Promise.resolve(false);
    let p = spaceCache.get(spaceId);
    if (!p) {
      p = checkSpaceReadAccess(user, spaceId, { orgId });
      spaceCache.set(spaceId, p);
    }
    return p;
  };
  const docCache = new Map<string, Promise<boolean>>();

  return Promise.all(
    rows.map(async (r): Promise<UsageEntry | null> => {
      const base = {
        targetType: r.targetType,
        targetId: r.targetId,
        context: r.context,
        source: r.source,
      };
      switch (r.targetType) {
        case "document": {
          const d = docs.get(r.targetId);
          if (!d || d.orgId !== orgId) return null;
          let p = docCache.get(r.targetId);
          if (!p) {
            p = checkDocumentViewAccess(user, d.spaceId, r.targetId);
            docCache.set(r.targetId, p);
          }
          if (!(await p)) return null;
          return { ...base, title: d.title, href: `/s/${d.spaceSlug}/${r.targetId}` };
        }
        case "database_row": {
          const row = dbRows.get(r.targetId);
          if (!row || row.orgId !== orgId) return null;
          if (!(await canReadSpace(row.spaceId))) return null;
          return { ...base, title: row.name, href: `/bases/${row.databaseId}` };
        }
        case "brand_kit":
          return kits.has(r.targetId)
            ? { ...base, title: "Brand Kit", href: "/organisation" }
            : null;
        case "design":
          return (await canReadSpace(r.spaceId)) ? { ...base, title: "Design", href: "/" } : null;
        case "video_project":
          // La route /video-editor n'existe que si le module studiovideo est dans la composition.
          if (!INCLUDED_MODULE_IDS.includes("studiovideo")) return null;
          return (await canReadSpace(r.spaceId))
            ? { ...base, title: "Projet vidéo", href: `/video-editor/${r.targetId}` }
            : null;
        case "whiteboard": {
          const b = boards.get(r.targetId);
          if (!b || b.orgId !== orgId) return null;
          let p = docCache.get(b.documentId);
          if (!p) {
            p = checkDocumentViewAccess(user, b.spaceId, b.documentId);
            docCache.set(b.documentId, p);
          }
          if (!(await p)) return null;
          return { ...base, title: "Tableau blanc", href: `/s/${b.spaceSlug}/${b.documentId}` };
        }
        case "presentation":
          return (await canReadSpace(r.spaceId))
            ? { ...base, title: "Présentation", href: "/s" }
            : null;
        default:
          return null;
      }
    })
  );
}

/** `null` si le média n'est pas lisible (404 côté route). */
export async function getMediaUsages(
  user: SessionUser,
  orgId: string,
  mediaId: string
): Promise<{ entries: UsageEntry[]; hiddenCount: number } | null> {
  const row = await getMediaForAccess(mediaId);
  if (!row || row.organizationId !== orgId) return null;
  const verdict = await resolveMediaAccess(user, row, "read", { orgId });
  if (!verdict.allowed) return null;

  const usages: UsageRow[] = await db
    .select(USAGE_COLUMNS)
    .from(mediaUsages)
    .where(eq(mediaUsages.mediaId, mediaId))
    .limit(USAGES_MAX);
  const classified = await classifyUsages(user, orgId, usages);
  const entries = classified.filter((e): e is UsageEntry => e !== null);
  return { entries, hiddenCount: classified.length - entries.length };
}

export type UsageSummary = {
  perMedia: Record<string, { total: number; visible: number; hidden: number }>;
  usedCount: number;
};

/** Seuls les médias lisibles figurent dans `perMedia` (aucune fuite d'existence). */
export async function summarizeUsages(
  user: SessionUser,
  orgId: string,
  ids: string[]
): Promise<UsageSummary> {
  const unique = [...new Set(ids)].slice(0, SUMMARY_MAX_IDS);
  const perMedia: UsageSummary["perMedia"] = {};
  if (unique.length === 0) return { perMedia, usedCount: 0 };

  const visible = await visibleMediaCondition(user, orgId, "any");
  const readable: { id: string }[] = await db
    .select({ id: media.id })
    .from(media)
    .where(and(inArray(media.id, unique), visible));
  const readableIds = readable.map((r) => r.id);
  if (readableIds.length === 0) return { perMedia, usedCount: 0 };
  for (const id of readableIds) perMedia[id] = { total: 0, visible: 0, hidden: 0 };

  const usages: UsageRow[] = await db
    .select(USAGE_COLUMNS)
    .from(mediaUsages)
    .where(inArray(mediaUsages.mediaId, readableIds));
  const classified = await classifyUsages(user, orgId, usages);
  usages.forEach((u, i) => {
    const slot = perMedia[u.mediaId];
    if (!slot) return;
    slot.total += 1;
    if (classified[i]) slot.visible += 1;
    else slot.hidden += 1;
  });
  const usedCount = Object.values(perMedia).filter((s) => s.total > 0).length;
  return { perMedia, usedCount };
}
