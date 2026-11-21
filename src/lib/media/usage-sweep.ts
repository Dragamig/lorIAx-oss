import { and, asc, eq, gt, lte, notInArray, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import {
  documents,
  spaces,
  systemSettings,
  userDatabaseRows,
  userDatabases,
} from "@/lib/db/schema";
import { brandKits } from "@/lib/db/schema-org";
import { videoProjects } from "@/lib/db/schema-video";
import { mediaUsages } from "@/lib/db/schema-media";
import logger from "@/lib/logger";
import { extractMediaRefs, syncContentUsages, type UsageTarget } from "./usages";

const WATERMARK_KEY = "media_usage_watermark";
const DEFAULT_BATCH = 200;
// Marge sur la borne haute : une ligne dont la transaction se valide juste après
// le balayage garde un `updated_at` déjà dépassé par le filigrane, sans cette marge.
const SETTLE_MS = 5_000;

type SourceName = "documents" | "rows" | "videos" | "brandKits";
const SOURCES: SourceName[] = ["documents", "rows", "videos", "brandKits"];

type Mark = { ts: string; id: string };
type Watermark = Record<SourceName, Mark>;
type SweepResult = {
  documents: number;
  rows: number;
  videos: number;
  brandKits: number;
  hasMore: boolean;
};

type SourceRow = { id: string; updatedAt: Date; organizationId: string; spaceId: string | null; payload: unknown };

const NIL_UUID = "00000000-0000-0000-0000-000000000000";
const EPOCH: Mark = { ts: new Date(0).toISOString(), id: NIL_UUID };

async function readWatermark(): Promise<Watermark> {
  const wm: Watermark = { documents: EPOCH, rows: EPOCH, videos: EPOCH, brandKits: EPOCH };
  const [setting] = await db
    .select({ value: systemSettings.value })
    .from(systemSettings)
    .where(eq(systemSettings.key, WATERMARK_KEY))
    .limit(1);
  const value = setting?.value as Record<string, string | Partial<Mark> | undefined> | undefined;
  if (value && typeof value === "object") {
    for (const name of SOURCES) {
      const v = value[name];
      // Ancien format : horodatage seul, l'id manquant vaut l'uuid nul.
      if (typeof v === "string" && !Number.isNaN(Date.parse(v))) wm[name] = { ts: v, id: NIL_UUID };
      else if (v && typeof v === "object" && typeof v.ts === "string" && !Number.isNaN(Date.parse(v.ts))) {
        wm[name] = { ts: v.ts, id: typeof v.id === "string" ? v.id : NIL_UUID };
      }
    }
  }
  return wm;
}

async function writeWatermark(wm: Watermark): Promise<void> {
  await db
    .insert(systemSettings)
    .values({ key: WATERMARK_KEY, value: wm, updatedAt: new Date() })
    .onConflictDoUpdate({
      target: systemSettings.key,
      set: { value: wm, updatedAt: new Date() },
    });
}

/** Lot de `batchSize` lignes sur `batchSize + 1` lues : la ligne en trop signale la suite. */
function splitBatch(fetched: SourceRow[], batchSize: number): { batch: SourceRow[]; hasMore: boolean } {
  return { batch: fetched.slice(0, batchSize), hasMore: fetched.length > batchSize };
}

async function fetchSource(
  name: SourceName,
  since: Mark,
  until: Date,
  limit: number,
): Promise<SourceRow[]> {
  // Troncature à la milliseconde : le filigrane est stocké en ISO (ms), la base garde les microsecondes.
  // Comparaison de tuple (updated_at tronqué à la ms, id) : les lignes à égalité d'horodatage
  // sont départagées par l'id, aucune n'est sautée ni retraitée.
  const sinceTs = new Date(since.ts);
  const after = (col: Parameters<typeof sql>[1], id: Parameters<typeof sql>[1]) =>
    sql`(date_trunc('milliseconds', ${col}), ${id}) > (${sinceTs}, ${since.id}::uuid)`;
  const order = (col: Parameters<typeof sql>[1], id: Parameters<typeof sql>[1]) => [
    sql`date_trunc('milliseconds', ${col})`,
    asc(id as never),
  ];
  switch (name) {
    case "documents": {
      const r = await db
        .select({
          id: documents.id,
          updatedAt: documents.updatedAt,
          organizationId: spaces.organizationId,
          spaceId: documents.spaceId,
          payload: documents.contentText,
        })
        .from(documents)
        .innerJoin(spaces, eq(spaces.id, documents.spaceId))
        .where(and(after(documents.updatedAt, documents.id), lte(documents.updatedAt, until)))
        .orderBy(...order(documents.updatedAt, documents.id))
        .limit(limit);
      return r;
    }
    case "rows": {
      const r = await db
        .select({
          id: userDatabaseRows.id,
          updatedAt: userDatabaseRows.updatedAt,
          organizationId: spaces.organizationId,
          spaceId: userDatabases.spaceId,
          payload: userDatabaseRows.cells,
        })
        .from(userDatabaseRows)
        .innerJoin(userDatabases, eq(userDatabases.id, userDatabaseRows.databaseId))
        .innerJoin(spaces, eq(spaces.id, userDatabases.spaceId))
        .where(and(after(userDatabaseRows.updatedAt, userDatabaseRows.id), lte(userDatabaseRows.updatedAt, until)))
        .orderBy(...order(userDatabaseRows.updatedAt, userDatabaseRows.id))
        .limit(limit);
      return r;
    }
    case "videos": {
      const r = await db
        .select({
          id: videoProjects.id,
          updatedAt: videoProjects.updatedAt,
          organizationId: spaces.organizationId,
          spaceId: videoProjects.spaceId,
          payload: videoProjects.timelineJson,
        })
        .from(videoProjects)
        .innerJoin(spaces, eq(spaces.id, videoProjects.spaceId))
        .where(and(after(videoProjects.updatedAt, videoProjects.id), lte(videoProjects.updatedAt, until)))
        .orderBy(...order(videoProjects.updatedAt, videoProjects.id))
        .limit(limit);
      return r;
    }
    case "brandKits": {
      const r = await db
        .select({
          id: brandKits.id,
          updatedAt: brandKits.updatedAt,
          organizationId: brandKits.organizationId,
          payload: brandKits.logos,
        })
        .from(brandKits)
        .where(and(after(brandKits.updatedAt, brandKits.id), lte(brandKits.updatedAt, until)))
        .orderBy(...order(brandKits.updatedAt, brandKits.id))
        .limit(limit);
      return r.map((x) => ({ ...x, spaceId: null }));
    }
  }
}

/** Retire les usages `content` d'une ligne de base dont la colonne n'existe plus. */
async function dropStaleRowContexts(rowId: string, contexts: string[]): Promise<void> {
  const base = and(
    eq(mediaUsages.targetType, "database_row"),
    eq(mediaUsages.targetId, rowId),
    eq(mediaUsages.source, "content"),
  );
  await db
    .delete(mediaUsages)
    .where(contexts.length > 0 ? and(base, notInArray(mediaUsages.context, contexts)) : base);
}

async function syncRow(name: SourceName, row: SourceRow): Promise<void> {
  const base = { organizationId: row.organizationId, spaceId: row.spaceId };
  switch (name) {
    case "documents":
      await syncContentUsages(
        { ...base, targetType: "document", targetId: row.id },
        extractMediaRefs((row.payload as string | null) ?? ""),
      );
      return;
    case "videos":
      await syncContentUsages(
        { ...base, targetType: "video_project", targetId: row.id },
        extractMediaRefs((row.payload as object | null) ?? {}),
      );
      return;
    case "brandKits":
      await syncContentUsages(
        { ...base, targetType: "brand_kit", targetId: row.id },
        extractMediaRefs((row.payload as object | null) ?? []),
      );
      return;
    case "rows": {
      const cells = row.payload;
      const target: Omit<UsageTarget, "context"> = { ...base, targetType: "database_row", targetId: row.id };
      if (cells && typeof cells === "object" && !Array.isArray(cells)) {
        const keys = Object.keys(cells as Record<string, unknown>);
        for (const key of keys) {
          const value = (cells as Record<string, unknown>)[key];
          await syncContentUsages(
            { ...target, context: key },
            extractMediaRefs(typeof value === "string" ? value : (value ?? "") as object),
          );
        }
        await dropStaleRowContexts(row.id, keys);
      } else {
        await syncContentUsages({ ...target, context: null }, extractMediaRefs((cells as object | null) ?? {}));
      }
      return;
    }
  }
}

/**
 * État du balayage pour les consommateurs qui ne doivent agir que sur des usages
 * à jour (ramassage des miniatures) : sources en retard (au moins une ligne
 * modifiée avant `now - graceMs` pas encore balayée, ce qui couvre aussi une
 * source en échec répété) et filigrane des documents.
 */
export async function getSweepHealth(
  now: Date,
  graceMs: number,
): Promise<{ lagging: SourceName[]; documentsWatermark: Date }> {
  const wm = await readWatermark();
  const until = new Date(now.getTime() - graceMs);
  const lagging: SourceName[] = [];
  for (const name of SOURCES) {
    try {
      const pending = await fetchSource(name, wm[name], until, 1);
      if (pending.length > 0) lagging.push(name);
    } catch (err) {
      logger.error({ err, source: name }, "Etat du balayage des usages illisible pour une source");
      lagging.push(name);
    }
  }
  return { lagging, documentsWatermark: new Date(wm.documents.ts) };
}

let running = false;

/**
 * Balayage différé des usages médias : traite par lots les lignes modifiées depuis
 * le filigrane de chaque source. Non réentrant, ne lève jamais ; le filigrane d'une
 * source en échec n'avance pas.
 */
export async function runMediaUsageSweep(
  opts: { batchSize?: number; now?: Date } = {},
): Promise<SweepResult> {
  const result: SweepResult = { documents: 0, rows: 0, videos: 0, brandKits: 0, hasMore: false };
  if (running) {
    logger.info("Balayage des usages médias ignoré : une exécution est déjà en cours");
    return result;
  }
  running = true;
  try {
    const batchSize = opts.batchSize ?? DEFAULT_BATCH;
    const until = new Date((opts.now ?? new Date()).getTime() - SETTLE_MS);
    const wm = await readWatermark();
    let changed = false;

    for (const name of SOURCES) {
      try {
        const fetched = await fetchSource(name, wm[name], until, batchSize + 1);
        const { batch, hasMore } = splitBatch(fetched, batchSize);
        for (const row of batch) await syncRow(name, row);
        result[name] = batch.length;
        if (hasMore) result.hasMore = true;
        if (batch.length > 0) {
          const last = batch[batch.length - 1];
          wm[name] = { ts: last.updatedAt.toISOString(), id: last.id };
          changed = true;
        }
      } catch (err) {
        logger.error({ err, source: name }, "Balayage des usages médias en échec pour une source");
      }
    }

    if (changed) await writeWatermark(wm);
  } catch (err) {
    logger.error({ err }, "Erreur du balayage des usages médias");
  } finally {
    running = false;
  }
  return result;
}

/** Vrai si la planification est désactivée (MEDIA_USAGE_SWEEP=off). */
export function isMediaUsageSweepDisabled(): boolean {
  return (process.env.MEDIA_USAGE_SWEEP ?? "").trim().toLowerCase() === "off";
}

/** Enveloppe sûre pour `server.ts`. */
export async function runMediaUsageSweepJob(): Promise<void> {
  try {
    const r = await runMediaUsageSweep();
    if (r.documents + r.rows + r.videos + r.brandKits > 0) {
      logger.info({ ...r }, "Balayage des usages médias terminé");
    }
  } catch (err) {
    logger.error({ err }, "Erreur du balayage planifié des usages médias");
  }
}
