import { and, eq, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import logger from "@/lib/logger";
import { media } from "@/lib/db/schema";
import { mediaEmbeddings, mediaTexts } from "@/lib/db/schema-media-ai";
import { generateEmbedding, isEmbeddingConfiguredAsync } from "@/lib/ai/embeddings";
import { visibleMediaCondition } from "@/lib/media/list";
import type { SessionUser } from "@/types";

/** Colonne posée à l'exécution (dimension de l'index actif), absente du schéma drizzle. */
const EMBEDDING = sql`"media_embeddings"."embedding"`;

const log = logger.child({ module: "media-ai-search" });

export const MEDIA_AI_SEARCH_MIN_LENGTH = 3;
export const MEDIA_AI_SEARCH_DEFAULT_LIMIT = 10;
/** Blocs lus par média retenu : plusieurs blocs d'un même média se partagent le LIMIT SQL. */
const CHUNKS_PER_MEDIA = 3;

export type MediaAiSearchHit = { mediaId: string; chunkText: string; score: number };

/**
 * Recherche sémantique sur l'index IA des médias.
 *
 * Les droits sont dans la clause WHERE de la requête vectorielle, jamais appliqués après
 * coup sur un top-k : `visibleMediaCondition(..., "live")` est la même condition que la
 * médiathèque (organisation, espaces lisibles avec lignes d'équipe et replis, hors espace
 * réservé à l'auteur ou à l'admin de l'organisation, corbeille exclue). Seul le texte de la
 * version courante est cherché (`media_texts.version = media.current_version`). Le scan HNSW
 * est itératif pour qu'un filtre sélectif ne vide pas le résultat.
 * Pas de reclassement externe : ce chemin n'envoie aucun extrait à un tiers.
 */
export async function searchMediaSemantic(
  user: SessionUser,
  orgId: string,
  query: string,
  limit: number = MEDIA_AI_SEARCH_DEFAULT_LIMIT,
): Promise<MediaAiSearchHit[]> {
  const q = query.trim();
  if (q.length < MEDIA_AI_SEARCH_MIN_LENGTH || limit < 1) return [];
  if (!(await isEmbeddingConfiguredAsync())) return [];

  try {
    const visible = await visibleMediaCondition(user, orgId, "live");
    const vec = `[${(await generateEmbedding(q, { userId: user.id })).join(",")}]`;
    const distance = sql`${EMBEDDING} <=> ${vec}::vector`;

    const rows = await db.transaction(async (tx) => {
      await tx.execute(sql`SELECT set_config('hnsw.iterative_scan', 'strict_order', true)`);
      return tx
        .select({
          mediaId: mediaEmbeddings.mediaId,
          chunkText: mediaEmbeddings.chunkText,
          score: sql<number>`1 - (${distance})`,
        })
        .from(mediaEmbeddings)
        .innerJoin(media, eq(media.id, mediaEmbeddings.mediaId))
        .innerJoin(mediaTexts, eq(mediaTexts.mediaId, media.id))
        .where(
          and(
            sql`${EMBEDDING} IS NOT NULL`,
            eq(mediaEmbeddings.organizationId, orgId),
            eq(mediaTexts.status, "done"),
            sql`${mediaTexts.version} = ${media.currentVersion}`,
            visible,
          ),
        )
        .orderBy(distance)
        .limit(limit * CHUNKS_PER_MEDIA);
    });

    const seen = new Set<string>();
    const hits: MediaAiSearchHit[] = [];
    for (const r of rows) {
      if (seen.has(r.mediaId)) continue;
      seen.add(r.mediaId);
      hits.push({ mediaId: r.mediaId, chunkText: r.chunkText, score: Number(r.score) });
      if (hits.length >= limit) break;
    }
    return hits;
  } catch (err) {
    log.error({ err: String(err) }, "Recherche sémantique des médias échouée");
    return [];
  }
}
