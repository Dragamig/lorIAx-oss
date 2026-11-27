import { sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { getActiveEmbeddingDimension } from "@/lib/ai/embedding-dimensions";

/**
 * Pose (idempotent) l'extension pgvector, la colonne `media_embeddings.embedding`
 * à la dimension de l'index actif et l'index HNSW cosinus, comme
 * `ensureDocumentEmbeddingSchema`. IF NOT EXISTS : ne change pas la dimension d'une
 * colonne déjà posée (la réindexation de changement de modèle la reconstruit).
 */
export async function ensureMediaEmbeddingSchema(): Promise<void> {
  await db.execute(sql`CREATE EXTENSION IF NOT EXISTS vector;`);
  const dimension = await getActiveEmbeddingDimension();
  await db.execute(
    sql.raw(`ALTER TABLE media_embeddings ADD COLUMN IF NOT EXISTS embedding vector(${dimension});`),
  );
  await db.execute(
    sql`CREATE INDEX IF NOT EXISTS idx_media_embeddings_vector ON media_embeddings USING hnsw (embedding vector_cosine_ops);`,
  );
}
