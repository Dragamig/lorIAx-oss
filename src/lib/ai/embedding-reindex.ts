import { sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { documents } from "@/lib/db/schema";
import { getSetting, setSetting } from "@/lib/settings/system-settings";
import {
  instanceProviderScope,
  resolveEmbeddingProviderInOrg,
} from "@/lib/ai/provider-resolver";
import {
  dimensionForModel,
  probeEmbeddingDimension,
  resolveActiveEmbeddingModel,
  DEFAULT_EMBEDDING_DIMENSION,
  type EmbeddingActive,
} from "@/lib/ai/embedding-dimensions";
import { enqueueMediaIndex } from "@/lib/media/ai/enqueue";
import { ensureMediaEmbeddingSchema } from "@/lib/media/ai/embedding-schema";
import { indexDocument } from "@/lib/ai/embeddings";
import { indexKbFromDisk } from "@/lib/kb/kb";
import logger from "@/lib/logger";

// ============================================================
// Ré-indexation des embeddings (documents + KB)
//
// Déclenchée à la main depuis l'admin après un changement de modèle/dimension
// d'embedding. Migre les colonnes vectorielles si la dimension change, puis
// ré-indexe tout en arrière-plan. La progression est suivie dans
// `system_settings.embedding_reindex_status` (polling UI).
// ============================================================

const STATUS_KEY = "embedding_reindex_status";
const PROGRESS_TICK = 5; // persiste la progression tous les N documents

export type ReindexPhase = "idle" | "kb" | "documents" | "media" | "done" | "error";

export interface ReindexStatus {
  running: boolean;
  phase: ReindexPhase;
  total: number;
  done: number;
  startedAt: string | null;
  finishedAt: string | null;
  model?: string;
  dimensions?: number;
  error?: string;
  /** Index actuel (`embedding_active`), absent ou null si aucun index. */
  current?: EmbeddingActive | null;
}

export const IDLE_STATUS: ReindexStatus = {
  running: false,
  phase: "idle",
  total: 0,
  done: 0,
  startedAt: null,
  finishedAt: null,
};

export async function getReindexStatus(): Promise<ReindexStatus> {
  const status = await getSetting<ReindexStatus>(STATUS_KEY);
  return status ?? IDLE_STATUS;
}

/** Modèle de l'index vectoriel actuel (instance entière), null si aucun. */
export async function getCurrentEmbeddingIndex(): Promise<EmbeddingActive | null> {
  return (await getSetting<EmbeddingActive>("embedding_active")) ?? null;
}

async function setReindexStatus(status: ReindexStatus): Promise<void> {
  await setSetting<ReindexStatus>(STATUS_KEY, status);
}

/**
 * Dimension réelle de la colonne vectorielle `embedding` d'une table, lue depuis
 * le catalogue Postgres (`atttypmod` = dimension pour pgvector). Renvoie `null`
 * si la colonne n'existe pas (ou est sans dimension typée). `table` est une
 * constante interne (pas d'entrée utilisateur) → interpolation sûre.
 */
async function getColumnVectorDimension(table: string): Promise<number | null> {
  try {
    const res = await db.execute(
      sql.raw(
        `SELECT a.atttypmod AS dim
           FROM pg_attribute a
           JOIN pg_class c ON a.attrelid = c.oid
          WHERE c.relname = '${table}'
            AND a.attname = 'embedding'
            AND a.attnum > 0
            AND NOT a.attisdropped`
      )
    );
    const rows = res.rows as Array<{ dim: number }>;
    if (rows.length === 0) return null;
    const dim = Number(rows[0].dim);
    return dim > 0 ? dim : null;
  } catch (err) {
    logger.warn({ err, table }, "getColumnVectorDimension: lecture échouée");
    return null;
  }
}

/**
 * (Re)construit la colonne vectorielle `embedding` d'une table à la dimension
 * cible : DROP COLUMN (cascade l'index) + ADD COLUMN + recrée l'index HNSW.
 * Idempotent. `table`/`indexName` sont des constantes internes.
 */
async function rebuildEmbeddingColumn(
  table: string,
  indexName: string,
  dimension: number
): Promise<void> {
  await db.execute(sql`CREATE EXTENSION IF NOT EXISTS vector;`);
  await db.execute(sql.raw(`DROP INDEX IF EXISTS ${indexName};`));
  await db.execute(sql.raw(`ALTER TABLE ${table} DROP COLUMN IF EXISTS embedding;`));
  await db.execute(sql.raw(`ALTER TABLE ${table} ADD COLUMN embedding vector(${dimension});`));
  await db.execute(
    sql.raw(
      `CREATE INDEX IF NOT EXISTS ${indexName} ON ${table} USING hnsw (embedding vector_cosine_ops);`
    )
  );
}

/**
 * Détermine le modèle d'embedding cible et sa dimension. Dimension : table
 * connue, sinon sonde réseau, sinon défaut.
 */
async function resolveTarget(): Promise<{
  providerId: string | null;
  model: string | null;
  dimension: number;
}> {
  const model = await resolveActiveEmbeddingModel();
  let dimension = dimensionForModel(model);
  if (dimension == null) {
    try {
      dimension = await probeEmbeddingDimension();
    } catch (err) {
      logger.warn({ err }, "resolveTarget: sonde de dimension échouée, défaut appliqué");
      dimension = DEFAULT_EMBEDDING_DIMENSION;
    }
  }
  let providerId: string | null = null;
  try {
    // Tâche d'INSTANCE : la ré-indexation reconstruit les colonnes vectorielles
    // de toute la base, tous tenants confondus, et fige `embedding_active` pour
    // l'instance entière. Aucune organisation ne peut être « celle » de ce
    // traitement, et en désigner une arbitrairement reviendrait à indexer les
    // documents de tous les tenants avec le fournisseur de l'un d'eux. La
    // portée instance est donc le bon choix, explicitement.
    providerId =
      (await resolveEmbeddingProviderInOrg(await instanceProviderScope()))?.providerId ?? null;
  } catch {
    providerId = null;
  }
  return { providerId, model, dimension };
}

/**
 * Vide les vecteurs médias de toutes les organisations (invalides après un changement de modèle ou
 * de dimension). Les organisations désactivées n'ont pas de remise en file ensuite : leurs textes
 * `done` (sans vecteurs désormais) repassent en `pending` pour être revectorisés à la réactivation.
 */
export async function resetMediaEmbeddings(): Promise<void> {
  await db.execute(sql`DELETE FROM media_embeddings`);
  await db.execute(
    sql`UPDATE media_texts SET status = 'pending', attempts = 0, next_attempt_at = now(), locked_at = NULL, updated_at = now()
        WHERE status = 'done'
          AND NOT EXISTS (SELECT 1 FROM media_ai_settings s
                          WHERE s.organization_id = media_texts.organization_id AND s.index_enabled = true)`
  );
}

/**
 * Lance la ré-indexation complète (migration colonnes si nécessaire + KB +
 * documents + médias) en suivant la progression dans `system_settings`. Conçue pour être
 * appelée en fire-and-forget par la route admin. Ne lève jamais : toute erreur
 * est consignée dans le statut (`phase: "error"`).
 */
export async function runEmbeddingReindex(): Promise<void> {
  const startedAt = new Date().toISOString();
  const { providerId, model, dimension } = await resolveTarget();

  await setReindexStatus({
    running: true,
    phase: "kb",
    total: 0,
    done: 0,
    startedAt,
    finishedAt: null,
    model: model ?? undefined,
    dimensions: dimension,
  });

  try {
    // 1. Migration des colonnes si la dimension réelle diffère de la cible.
    //    On lit la dimension RÉELLE des colonnes (catalogue Postgres) plutôt
    //    que le réglage, pour gérer correctement les colonnes préexistantes.
    const kbDim = await getColumnVectorDimension("kb_chunks");
    if (kbDim !== dimension) {
      await rebuildEmbeddingColumn("kb_chunks", "idx_kb_chunks_embedding", dimension);
    }
    const docDim = await getColumnVectorDimension("document_embeddings");
    if (docDim !== dimension) {
      await rebuildEmbeddingColumn(
        "document_embeddings",
        "idx_embeddings_vector",
        dimension
      );
    }

    // Index IA des médias : pose la colonne si absente, puis l'aligne sur la cible.
    await ensureMediaEmbeddingSchema();
    const mediaDim = await getColumnVectorDimension("media_embeddings");
    if (mediaDim !== dimension) {
      await rebuildEmbeddingColumn("media_embeddings", "idx_media_embeddings_vector", dimension);
    }

    // On fige la dimension active AVANT la ré-indexation pour que les ensure*
    // appelés par indexKbFromDisk/indexDocument utilisent la bonne dimension.
    await setSetting<EmbeddingActive>("embedding_active", {
      providerId,
      model: model ?? "auto",
      dimensions: dimension,
    });

    // 2. Ré-indexation de la base de connaissances.
    await indexKbFromDisk(undefined, { force: true });

    // 3. Ré-indexation de tous les documents.
    const rows = await db.select({ id: documents.id }).from(documents);
    const total = rows.length;

    await setReindexStatus({
      running: true,
      phase: "documents",
      total,
      done: 0,
      startedAt,
      finishedAt: null,
      model: model ?? undefined,
      dimensions: dimension,
    });

    let done = 0;
    for (const row of rows) {
      try {
        await indexDocument(row.id);
      } catch (err) {
        logger.error({ err, documentId: row.id }, "Ré-indexation document échouée");
      }
      done++;
      if (done % PROGRESS_TICK === 0 || done === total) {
        await setReindexStatus({
          running: true,
          phase: "documents",
          total,
          done,
          startedAt,
          finishedAt: null,
          model: model ?? undefined,
          dimensions: dimension,
        });
      }
    }

    // 4. Médias : les vecteurs de l'ancien modèle ou de l'ancienne dimension sont vidés pour toutes
    //    les organisations (ils sont invalides), puis les médias des organisations dont l'indexation
    //    est active repassent en file (le texte déjà extrait reste servi jusqu'au succès).
    await resetMediaEmbeddings();
    const mediaRows = (
      await db.execute(
        sql`SELECT mt.media_id AS id FROM media_texts mt
            INNER JOIN media_ai_settings s ON s.organization_id = mt.organization_id
            WHERE s.index_enabled = true`
      )
    ).rows as Array<{ id: string }>;
    const mediaTotal = mediaRows.length;
    await setReindexStatus({
      running: true,
      phase: "media",
      total: mediaTotal,
      done: 0,
      startedAt,
      finishedAt: null,
      model: model ?? undefined,
      dimensions: dimension,
    });
    let mediaDone = 0;
    for (const row of mediaRows) {
      await enqueueMediaIndex(row.id, "manual");
      mediaDone++;
      if (mediaDone % PROGRESS_TICK === 0 || mediaDone === mediaTotal) {
        await setReindexStatus({
          running: true,
          phase: "media",
          total: mediaTotal,
          done: mediaDone,
          startedAt,
          finishedAt: null,
          model: model ?? undefined,
          dimensions: dimension,
        });
      }
    }

    await setReindexStatus({
      running: false,
      phase: "done",
      total: total + mediaTotal,
      done: done + mediaDone,
      startedAt,
      finishedAt: new Date().toISOString(),
      model: model ?? undefined,
      dimensions: dimension,
    });
    logger.info({ total, dimension, model }, "Ré-indexation embeddings terminée");
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    logger.error({ err }, "Ré-indexation embeddings en échec");
    await setReindexStatus({
      running: false,
      phase: "error",
      total: 0,
      done: 0,
      startedAt,
      finishedAt: new Date().toISOString(),
      model: model ?? undefined,
      dimensions: dimension,
      error: message,
    });
  }
}
