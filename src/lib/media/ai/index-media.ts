import { sql } from "drizzle-orm";
import { db } from "@/lib/db";
import logger from "@/lib/logger";
import type { MediaTextSource } from "@/lib/db/schema-media-ai";
import {
  generateEmbedding,
  isEmbeddingConfiguredAsync,
} from "@/lib/ai/embeddings";
import { getActiveEmbeddingDimension, resolveActiveEmbeddingModel } from "@/lib/ai/embedding-dimensions";
import { checkQuota } from "@/lib/ai/quota-checker";
import { orgIdForMedia } from "@/lib/ai/org-scope";
import { ensureMediaEmbeddingSchema } from "./embedding-schema";
import { chunkMediaText } from "./chunking";

export { ensureMediaEmbeddingSchema };

const log = logger.child({ module: "media-ai-index" });
const CONCURRENCY = 5;

export type WriteMediaIndexInput = {
  mediaId: string;
  organizationId: string;
  uploadedBy: string;
  text: string;
  /** Valeur de `media.current_version` dont le texte est issu. */
  version: number;
  source?: MediaTextSource;
};

export type WriteMediaIndexResult =
  | { ok: true; chunks: number }
  | { ok: false; reason: "quota" | "no_embedding" | "stale" | "error"; message?: string };

const fail = (reason: "quota" | "no_embedding" | "stale" | "error", message?: string): WriteMediaIndexResult => ({
  ok: false,
  reason,
  message,
});

/** Dimension de la colonne `media_embeddings.embedding` telle que posée en base (null si absente). */
async function columnDimension(): Promise<number | null> {
  const res = await db.execute(
    sql`SELECT a.atttypmod AS dim FROM pg_attribute a
        WHERE a.attrelid = 'media_embeddings'::regclass AND a.attname = 'embedding' AND NOT a.attisdropped`,
  );
  const dim = Number((res.rows as Array<{ dim: number | string }>)[0]?.dim);
  return Number.isFinite(dim) && dim > 0 ? dim : null;
}

/**
 * Découpe, vectorise et écrit l'index d'un média. Tous les vecteurs sont calculés AVANT la
 * transaction d'écriture : un échec laisse l'ancien index intact (jamais d'état mixte).
 * Le fournisseur d'embedding est celui de l'instance (`generateEmbedding`, jamais celui d'un
 * tenant) et l'organisation du média est vérifiée avant tout appel. À l'écriture, la version
 * courante du média est relue sous verrou : un média remplacé ou mis en corbeille entre-temps
 * n'écrit pas l'index de l'ancienne version (`stale`), et la ligne `media_texts` doit exister et être
 * `running` pour cette version (sinon l'index a été effacé ou remis en file : `stale`).
 */
export async function writeMediaIndex(input: WriteMediaIndexInput): Promise<WriteMediaIndexResult> {
  const { mediaId, organizationId, uploadedBy, text, version } = input;
  try {
    if ((await orgIdForMedia(mediaId)) !== organizationId) return fail("error", "Organisation du média inattendue");
    if (!(await isEmbeddingConfiguredAsync())) return fail("no_embedding");

    const quota = await checkQuota(uploadedBy);
    if (!quota.allowed) return fail("quota", quota.reason);

    await ensureMediaEmbeddingSchema();
    const [active, column] = await Promise.all([getActiveEmbeddingDimension(), columnDimension()]);
    if (column !== active) {
      return fail(
        "error",
        `Dimension de la colonne des vecteurs (${column ?? "absente"}) différente de celle du modèle actif (${active}) : lancer la réindexation du modèle d'embedding`,
      );
    }

    const chunks = chunkMediaText(text, input.source ?? "text");
    const model = (await resolveActiveEmbeddingModel()) || process.env.EMBEDDING_MODEL || "text-embedding-3-small";

    const vectors: number[][] = [];
    for (let i = 0; i < chunks.length; i += CONCURRENCY) {
      const batch = chunks.slice(i, i + CONCURRENCY);
      vectors.push(...(await Promise.all(batch.map((c) => generateEmbedding(c, { userId: uploadedBy })))));
    }

    return await db.transaction(async (tx): Promise<WriteMediaIndexResult> => {
      const locked = await tx.execute(
        sql`SELECT current_version, deleted_at, organization_id FROM media WHERE id = ${mediaId} FOR SHARE`,
      );
      const row = (locked.rows as Array<{ current_version: number; deleted_at: Date | null; organization_id: string }>)[0];
      if (!row || row.deleted_at || row.organization_id !== organizationId || row.current_version !== version) {
        return fail("stale");
      }
      // Le passage doit toujours être en cours : un effacement de l'index (ligne absente) ou une remise
      // en file (plus `running`, autre version) pendant le calcul abandonne l'écriture des vecteurs.
      const mt = await tx.execute(
        sql`SELECT status, version FROM media_texts WHERE media_id = ${mediaId} FOR UPDATE`,
      );
      const state = (mt.rows as Array<{ status: string; version: number }>)[0];
      if (!state || state.status !== "running" || state.version !== version) return fail("stale");
      await tx.execute(sql`DELETE FROM media_embeddings WHERE media_id = ${mediaId}`);
      for (let i = 0; i < chunks.length; i++) {
        const vec = `[${vectors[i].join(",")}]`;
        await tx.execute(
          sql`INSERT INTO media_embeddings (media_id, organization_id, chunk_index, chunk_text, model, embedding)
              VALUES (${mediaId}, ${organizationId}, ${i}, ${chunks[i]}, ${model}, ${vec}::vector)`,
        );
      }
      return { ok: true, chunks: chunks.length };
    });
  } catch (err) {
    log.warn({ mediaId, err: String(err) }, "Écriture de l'index IA du média échouée");
    return fail("error", err instanceof Error ? err.message : String(err));
  }
}
