import { db } from "@/lib/db";
import { documentEmbeddings, documents } from "@/lib/db/schema";
import { eq, sql } from "drizzle-orm";
import logger from "@/lib/logger";
import { logAIUsage } from "@/lib/ai/usage-logger";
import {
  instanceProviderScope,
  resolveEmbeddingProviderInOrg,
  type ProviderOrgScope,
} from "@/lib/ai/provider-resolver";
import { buildClassificationFilterSql } from "@/lib/ai/search-filters";
import { rerankCandidates, fetchLimitForRerank } from "@/lib/ai/rerank";
import {
  getActiveEmbeddingDimension,
  resolveActiveEmbeddingModel,
} from "@/lib/ai/embedding-dimensions";

const CHUNK_SIZE = 1000;
const CHUNK_OVERLAP = 200;

export function chunkText(text: string): string[] {
  const chunks: string[] = [];
  let start = 0;

  while (start < text.length) {
    const end = Math.min(start + CHUNK_SIZE, text.length);
    chunks.push(text.slice(start, end));
    start += CHUNK_SIZE - CHUNK_OVERLAP;
  }

  return chunks;
}

export interface EmbeddingOptions {
  /** Utilisateur pour le log d'usage (optionnel). */
  userId?: string;
  /**
   * Force un fournisseur (sinon résolution admin → EMBEDDING_PROVIDER).
   * Utilisé par le script d'indexation pour figer la cohérence index/requête.
   */
  provider?: string;
  /** Force un modèle (sinon résolution admin → EMBEDDING_MODEL). */
  model?: string;
}

const DEFAULT_EMBEDDING_MODEL = "text-embedding-3-small";

/**
 * Config d'embedding normalisée, indépendante de la source (override, admin
 * ou env). `providerId` sert uniquement au log d'usage.
 */
interface EmbeddingConfig {
  kind: "openai" | "ollama" | "mistral";
  apiKey: string | null;
  baseUrl: string | null;
  model: string;
  providerId: string;
}

/** Construit une config d'embedding depuis l'ENV pour un provider donné. */
function buildEnvEmbeddingConfig(provider: string, model: string): EmbeddingConfig {
  if (provider === "openai") {
    return { kind: "openai", apiKey: process.env.OPENAI_API_KEY ?? null, baseUrl: null, model, providerId: "openai" };
  }
  if (provider === "ollama") {
    return {
      kind: "ollama",
      apiKey: null,
      baseUrl: process.env.OLLAMA_BASE_URL || "http://localhost:11434",
      model,
      providerId: "ollama",
    };
  }
  if (provider === "mistral") {
    return { kind: "mistral", apiKey: process.env.MISTRAL_API_KEY ?? null, baseUrl: null, model, providerId: "mistral" };
  }
  throw new Error(`Embedding provider inconnu : ${provider}`);
}

/**
 * Résout la config d'embedding à utiliser. Ordre :
 * a. override explicite (`options.provider`/`options.model`) → ENV pour ce provider ;
 * b. config admin (`ai_model_assignments`, usage `embeddings`) ;
 * c. repli ENV (`EMBEDDING_PROVIDER`/`EMBEDDING_MODEL`).
 */
async function resolveEmbeddingConfig(options?: EmbeddingOptions): Promise<EmbeddingConfig> {
  // a. Override explicite (script d'indexation) → ENV pour ce provider.
  if (options?.provider || options?.model) {
    const provider = options?.provider || process.env.EMBEDDING_PROVIDER || "openai";
    const model = options?.model || process.env.EMBEDDING_MODEL || DEFAULT_EMBEDDING_MODEL;
    return buildEnvEmbeddingConfig(provider, model);
  }

  // b. Config admin, en portée INSTANCE et non par organisation.
  //
  //    Ce choix est délibéré (cloisonnement AZ-06, lot 6). Les vecteurs de
  //    toutes les organisations cohabitent dans une colonne unique,
  //    `document_embeddings.embedding vector(N)`, dont la dimension découle du
  //    modèle d'embedding. Résoudre ce modèle par organisation ferait écrire
  //    dans la même colonne des vecteurs de dimensions incompatibles, et
  //    surtout comparer à la requête d'un tenant des vecteurs indexés avec un
  //    autre modèle : le modèle d'embedding est un réglage d'instance, pas de
  //    tenant. `instanceProviderScope` ne rend jamais le fournisseur d'un
  //    tenant sur une instance multi-organisations.
  const admin = await resolveEmbeddingProviderInOrg(await instanceProviderScope());
  if (admin) {
    return {
      kind: admin.kind,
      apiKey: admin.apiKey,
      baseUrl: admin.baseUrl,
      model: admin.model,
      providerId: admin.providerId,
    };
  }

  // c. Repli ENV.
  const provider = process.env.EMBEDDING_PROVIDER || "openai";
  const model = process.env.EMBEDDING_MODEL || DEFAULT_EMBEDDING_MODEL;
  return buildEnvEmbeddingConfig(provider, model);
}

/** Normalise une base OpenAI-compat en `<root>/v1/embeddings` (tolère un `/v1` final). */
function openAiCompatEmbeddingsUrl(baseUrl: string | null, fallback: string): string {
  const root = (baseUrl || fallback).replace(/\/+$/, "").replace(/\/v1$/, "");
  return `${root}/v1/embeddings`;
}

export async function generateEmbedding(
  text: string,
  options?: EmbeddingOptions
): Promise<number[]> {
  const config = await resolveEmbeddingConfig(options);
  const { kind, model, providerId } = config;
  const userId = options?.userId;
  const startTime = Date.now();

  if (kind === "openai") {
    if (!config.apiKey) throw new Error("OPENAI_API_KEY requis pour les embeddings");

    const res = await fetch(openAiCompatEmbeddingsUrl(config.baseUrl, "https://api.openai.com"), {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${config.apiKey}`,
      },
      body: JSON.stringify({ input: text, model }),
    });

    if (!res.ok) {
      const err = await res.text();
      throw new Error(`OpenAI embeddings error: ${err}`);
    }

    const data = await res.json();

    if (userId) {
      logAIUsage({
        userId,
        providerId,
        model,
        usageType: "embeddings",
        tokensIn: data.usage?.prompt_tokens,
        tokensOut: 0,
        latencyMs: Date.now() - startTime,
        status: "success",
      });
    }

    return data.data[0].embedding;
  }

  if (kind === "ollama") {
    const baseUrl = config.baseUrl || "http://localhost:11434";
    const res = await fetch(`${baseUrl}/api/embeddings`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ model, prompt: text }),
    });

    if (!res.ok) {
      throw new Error(`Ollama embeddings error: ${res.statusText}`);
    }

    const data = await res.json();

    if (userId) {
      logAIUsage({
        userId,
        providerId,
        model,
        usageType: "embeddings",
        latencyMs: Date.now() - startTime,
        status: "success",
      });
    }

    return data.embedding;
  }

  if (kind === "mistral") {
    if (!config.apiKey) throw new Error("MISTRAL_API_KEY requis pour les embeddings Mistral");

    const res = await fetch(openAiCompatEmbeddingsUrl(config.baseUrl, "https://api.mistral.ai"), {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${config.apiKey}`,
      },
      body: JSON.stringify({ model, input: [text] }),
    });

    if (!res.ok) {
      const err = await res.text();
      throw new Error(`Mistral embeddings error: ${err}`);
    }

    const data = await res.json();

    if (userId) {
      logAIUsage({
        userId,
        providerId,
        model,
        usageType: "embeddings",
        tokensIn: data.usage?.prompt_tokens,
        tokensOut: 0,
        latencyMs: Date.now() - startTime,
        status: "success",
      });
    }

    return data.data[0].embedding;
  }

  throw new Error(`Embedding provider inconnu : ${kind}`);
}

/**
 * Vrai si l'ENV configure un provider d'embedding (vérif synchrone, sans DB).
 * Ne tient PAS compte de la config admin → préférer {@link isEmbeddingConfiguredAsync}
 * dans un contexte async.
 */
export function isEmbeddingConfigured(): boolean {
  const provider = process.env.EMBEDDING_PROVIDER || "openai";
  if (provider === "openai") return !!process.env.OPENAI_API_KEY;
  if (provider === "ollama") return !!process.env.OLLAMA_BASE_URL;
  if (provider === "mistral") return !!process.env.MISTRAL_API_KEY;
  return false;
}

/**
 * Vrai si un assignment admin `embeddings` actif existe OU si l'ENV est configuré.
 * Variante async à utiliser par les appelants async (routes, recherche).
 */
export async function isEmbeddingConfiguredAsync(): Promise<boolean> {
  try {
    // Même portée instance que `resolveEmbeddingConfig` : cette fonction dit
    // si l'instance sait produire des vecteurs, pas si un tenant le peut.
    if (await resolveEmbeddingProviderInOrg(await instanceProviderScope())) return true;
  } catch (err) {
    logger.warn({ err }, "isEmbeddingConfiguredAsync: résolution admin échouée");
  }
  return isEmbeddingConfigured();
}

/**
 * Crée (idempotent) l'extension pgvector, la colonne vectorielle de
 * `document_embeddings` (dimension active) et l'index HNSW cosinus.
 * IF NOT EXISTS : ne change PAS la dimension d'une colonne déjà posée — le
 * changement de dimension est géré par la route de ré-indexation (DROP+ADD).
 */
export async function ensureDocumentEmbeddingSchema(): Promise<void> {
  await db.execute(sql`CREATE EXTENSION IF NOT EXISTS vector;`);
  const dimension = await getActiveEmbeddingDimension();
  await db.execute(
    sql.raw(
      `ALTER TABLE document_embeddings ADD COLUMN IF NOT EXISTS embedding vector(${dimension});`
    )
  );
  await db.execute(
    sql`CREATE INDEX IF NOT EXISTS idx_embeddings_vector ON document_embeddings USING hnsw (embedding vector_cosine_ops);`
  );
}

export async function indexDocument(documentId: string): Promise<void> {
  if (!(await isEmbeddingConfiguredAsync())) {
    return;
  }

  await ensureDocumentEmbeddingSchema();

  const [doc] = await db
    .select()
    .from(documents)
    .where(eq(documents.id, documentId))
    .limit(1);

  if (!doc || !doc.contentText) return;

  // Supprimer les anciens embeddings
  await db
    .delete(documentEmbeddings)
    .where(eq(documentEmbeddings.documentId, documentId));

  const chunks = chunkText(doc.contentText);
  // Libellé informatif (colonne NOT NULL) : modèle réellement résolu (admin → ENV).
  const model =
    (await resolveActiveEmbeddingModel()) ||
    process.env.EMBEDDING_MODEL ||
    "text-embedding-3-small";

  // Générer les embeddings en parallèle (concurrence limitée à 5)
  const CONCURRENCY = 5;
  for (let batch = 0; batch < chunks.length; batch += CONCURRENCY) {
    const batchChunks = chunks.slice(batch, batch + CONCURRENCY);
    const results = await Promise.allSettled(
      batchChunks.map((chunk) => generateEmbedding(chunk))
    );

    for (let j = 0; j < results.length; j++) {
      const result = results[j];
      const chunkIndex = batch + j;

      if (result.status === "rejected") {
        logger.error({ err: result.reason, documentId, chunkIndex }, "Erreur embedding chunk");
        continue;
      }

      try {
        const [inserted] = await db
          .insert(documentEmbeddings)
          .values({
            documentId,
            chunkIndex,
            chunkText: batchChunks[j],
            model,
          })
          .returning({ id: documentEmbeddings.id });

        const vectorStr = `[${result.value.join(",")}]`;
        await db.execute(
          sql`UPDATE document_embeddings SET embedding = ${vectorStr}::vector WHERE id = ${inserted.id}`
        );
      } catch (error) {
        logger.error({ err: error, documentId, chunkIndex }, "Erreur insertion chunk");
      }
    }
  }
}

/**
 * Recherche sémantique (pgvector) sur les chunks de documents.
 *
 * Cloisonnement multi-tenant : `options.spaceIds` restreint la recherche aux
 * espaces fournis. Convention alignée sur {@link getAccessibleSpaceIds} —
 * une liste **vide** signifie « aucun espace accessible » et retourne `[]`
 * (jamais « tous les espaces »). Omettre `spaceIds` désactive le filtre (à
 * réserver aux contextes déjà cloisonnés en amont).
 *
 * Filtrage par classification : `options.viewerId` et `options.isGlobalAdmin`
 * écartent, directement dans le SQL, les documents classés « secret » dont
 * le lecteur n'est pas l'auteur (voir {@link buildClassificationFilterSql}).
 * Ce filtre doit rester dans la requête et non en post-traitement : les
 * extraits candidats peuvent être envoyés à un fournisseur de reclassement
 * externe après cet appel.
 *
 * Reclassement : `options.rerank` (défaut vrai) sur-échantillonne la requête
 * SQL puis reclasse les candidats via {@link rerankCandidates} avant de
 * tronquer à `limit`. Mettre `rerank: false` quand l'appelant reclasse
 * lui-même la liste fusionnée en aval (évite un double appel).
 *
 * Attention au champ `score` : quand le reclassement est actif, l'ORDRE des
 * lignes rendues reflète la pertinence du reranker, mais `score` reste le
 * score vectoriel d'origine, il n'est plus cohérent avec cet ordre. Aucun
 * appelant ne doit retrier dessus après appel.
 */
export async function searchSemantic(
  query: string,
  limit = 10,
  options?: {
    spaceIds?: string[];
    viewerId?: string;
    isGlobalAdmin?: boolean;
  } & (
    | {
        rerank?: true;
        /**
         * Portée d'organisation transmise au reclassement (cf.
         * `RerankOptions`), obligatoire tant que le reclassement est possible.
         * Le vecteur de requête, lui, est produit par le modèle d'instance :
         * voir la note de `resolveEmbeddingConfig`.
         */
        organizationId: ProviderOrgScope;
      }
    | { rerank: false; organizationId?: ProviderOrgScope }
  )
): Promise<Array<{ documentId: string; chunkText: string; score: number }>> {
  if (!(await isEmbeddingConfiguredAsync())) {
    return [];
  }

  const spaceIds = options?.spaceIds;
  // Scope explicite mais vide → aucun accès, aucun résultat (fail-closed).
  if (spaceIds && spaceIds.length === 0) {
    return [];
  }

  try {
    const queryEmbedding = await generateEmbedding(query);
    const vectorStr = `[${queryEmbedding.join(",")}]`;

    const spaceFilter =
      spaceIds && spaceIds.length > 0
        ? sql`AND d.space_id IN (${sql.join(
            spaceIds.map((id) => sql`${id}`),
            sql`, `
          )})`
        : sql``;

    const classificationFilter =
      buildClassificationFilterSql({
        viewerId: options?.viewerId,
        isGlobalAdmin: options?.isGlobalAdmin,
      }) ?? sql``;

    // Sur-échantillonnage réservé au cas où le reclassement est demandé :
    // inutile de remonter plus de lignes que nécessaire sinon.
    // fetchLimitForRerank (pas oversampleLimit seul) : au-delà de son plafond
    // de 40 candidats, oversampleLimit descend sous `limit`, ce qui ferait
    // perdre des résultats en silence pour un appelant demandant plus de 40.
    // Le reclassement envoie les extraits de documents a un fournisseur
    // externe : sans identifiant du lecteur, on ne peut pas rattacher cet
    // envoi a un lecteur identifie ni le filtrer correctement en amont. On
    // refuse donc de reclasser plutot que de risquer d'exposer des extraits
    // pour un appelant futur qui omettrait `viewerId`. Surface codee en dur a
    // "chat" ci-dessous : un futur appelant heriterait de ce choix, pense
    // pour le chat sur documents, pas necessairement adapte a son propre cas.
    const useRerank =
      options?.rerank !== false &&
      Boolean(options?.viewerId) &&
      options?.organizationId !== undefined;
    const fetchLimit = useRerank ? fetchLimitForRerank(limit) : limit;

    const results = await db.execute(
      sql`SELECT de.document_id, de.chunk_text, 1 - (de.embedding <=> ${vectorStr}::vector) AS score
          FROM document_embeddings de
          JOIN documents d ON d.id = de.document_id
          WHERE de.embedding IS NOT NULL
            ${spaceFilter}
            ${classificationFilter}
          ORDER BY de.embedding <=> ${vectorStr}::vector
          LIMIT ${fetchLimit}`
    );

    const rows = (results.rows as Array<{ document_id: string; chunk_text: string; score: number }>).map((r) => ({
      documentId: r.document_id,
      chunkText: r.chunk_text,
      score: Number(r.score),
    }));

    if (!useRerank) return rows.slice(0, limit);

    return rerankCandidates(query, rows, {
      getText: (row) => row.chunkText,
      topN: limit,
      surface: "chat",
      userId: options?.viewerId,
      organizationId: options.organizationId as ProviderOrgScope,
    });
  } catch (error) {
    logger.error({ err: error }, "Erreur recherche sémantique");
    return [];
  }
}
