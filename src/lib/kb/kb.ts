import { createHash } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { kbChunks } from "@/lib/db/schema";
import { generateEmbedding, isEmbeddingConfiguredAsync } from "@/lib/ai/embeddings";
import { getActiveEmbeddingDimension } from "@/lib/ai/embedding-dimensions";
import { rerankCandidates, fetchLimitForRerank } from "@/lib/ai/rerank";
import { instanceProviderScope } from "@/lib/ai/provider-resolver";
import logger from "@/lib/logger";

// ============================================================
// Configuration KB (assistant d'aide)
// Un MÊME modèle d'embedding sert aux documents utilisateur ET à la KB d'aide
// (usage `embeddings` unique). La résolution provider/modèle est désormais
// unifiée dans embeddings.ts (config admin → ENV) ; on ne force plus de
// provider/modèle KB spécifique. La dimension vectorielle est celle du modèle
// actif, lue via getActiveEmbeddingDimension() (config admin → modèle → défaut) ;
// KB_EMBEDDING_DIMENSIONS n'est plus qu'un repli statique déprécié.
// ============================================================

/**
 * @deprecated Repli statique uniquement. La dimension active est désormais
 * pilotée par {@link getActiveEmbeddingDimension} (config admin → modèle → défaut).
 */
export const KB_EMBEDDING_DIMENSIONS = Number(
  process.env.KB_EMBEDDING_DIMENSIONS || 1024
);

/**
 * Libellé du modèle stocké dans `kb_chunks.model` (colonne NOT NULL, purement
 * informative). Le modèle réel est résolu dynamiquement (admin → ENV) par
 * generateEmbedding ; on conserve ici un libellé best-effort.
 */
const KB_EMBEDDING_MODEL_LABEL = process.env.EMBEDDING_MODEL || "auto";

/** Concurrence des appels d'embedding (calque indexDocument). */
const CONCURRENCY = 5;

/**
 * Vrai si un provider d'embedding est utilisable (config admin ou ENV).
 * Réutilise la logique unifiée des embeddings (cf. embeddings.ts).
 */
export function isKbEmbeddingConfigured(): Promise<boolean> {
  return isEmbeddingConfiguredAsync();
}

/**
 * Crée (idempotent) l'extension pgvector, la colonne vectorielle de kb_chunks
 * et l'index HNSW cosinus. Chaque instruction est exécutée séparément.
 */
export async function ensureKbSchema(): Promise<void> {
  await db.execute(sql`CREATE EXTENSION IF NOT EXISTS vector;`);
  const dimension = await getActiveEmbeddingDimension();
  // Un type SQL ne peut pas être paramétré → interpolation via sql.raw.
  // IF NOT EXISTS : ne change PAS la dimension d'une colonne déjà posée — le
  // changement de dimension est géré par la route de ré-indexation (DROP+ADD).
  await db.execute(
    sql.raw(
      `ALTER TABLE kb_chunks ADD COLUMN IF NOT EXISTS embedding vector(${dimension});`
    )
  );
  await db.execute(
    sql`CREATE INDEX IF NOT EXISTS idx_kb_chunks_embedding ON kb_chunks USING hnsw (embedding vector_cosine_ops);`
  );
}

/**
 * Extrait le `title` du frontmatter YAML en tête et renvoie le corps sans le
 * bloc `---...---`. Fonction pure. Si pas de frontmatter, title=null, body=raw.
 */
export function parseFrontmatter(raw: string): {
  title: string | null;
  body: string;
} {
  const match = raw.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?/);
  if (!match) {
    return { title: null, body: raw };
  }

  const frontmatter = match[1];
  const body = raw.slice(match[0].length);

  let title: string | null = null;
  const titleMatch = frontmatter.match(/^\s*title\s*:\s*(.+?)\s*$/m);
  if (titleMatch) {
    let value = titleMatch[1].trim();
    // Retire les guillemets optionnels (simples ou doubles).
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    title = value || null;
  }

  return { title, body };
}

/**
 * Découpe le texte en chunks en respectant les paragraphes (séparés par lignes
 * vides). Accumule les paragraphes jusqu'à ~maxChars. Un paragraphe plus long
 * que maxChars est coupé brutalement. Fonction pure. Pas de chunk vide.
 */
export function chunkMarkdown(text: string, maxChars = 1500): string[] {
  const paragraphs = text
    .split(/\n\s*\n/)
    .map((p) => p.trim())
    .filter((p) => p.length > 0);

  const chunks: string[] = [];
  let current = "";

  const flush = () => {
    const trimmed = current.trim();
    if (trimmed.length > 0) chunks.push(trimmed);
    current = "";
  };

  for (const paragraph of paragraphs) {
    if (paragraph.length > maxChars) {
      // Le paragraphe seul dépasse → on vide l'accumulateur puis on le coupe.
      flush();
      for (let i = 0; i < paragraph.length; i += maxChars) {
        const piece = paragraph.slice(i, i + maxChars).trim();
        if (piece.length > 0) chunks.push(piece);
      }
      continue;
    }

    if (current.length === 0) {
      current = paragraph;
    } else if (current.length + 2 + paragraph.length <= maxChars) {
      current += "\n\n" + paragraph;
    } else {
      flush();
      current = paragraph;
    }
  }

  flush();
  return chunks;
}

/** sha256 hex d'un chunk (indexation incrémentale). */
export function hashChunk(text: string): string {
  return createHash("sha256").update(text, "utf8").digest("hex");
}

export interface KbSearchResult {
  source: string;
  title: string | null;
  chunkText: string;
  score: number;
}

/**
 * Recherche dans la base de connaissances (GLOBALE, pas de scoping par espace).
 * Sémantique pgvector si configuré, sinon (ou en cas d'erreur) fallback ILIKE.
 *
 * Reclassement systématique (surface `"help"`) avant de rendre. Attention au
 * champ `score` : après reclassement, l'ORDRE des lignes reflète la
 * pertinence du reranker mais `score` reste le score vectoriel d'origine (ou
 * 0 dans le repli ILIKE), il n'est plus cohérent avec cet ordre. Aucun
 * appelant ne doit retrier dessus.
 */
/**
 * Plafond de sur-echantillonnage propre a la KB d'aide : les passages KB
 * pesant jusqu'a 1500 caracteres, suivre le plafond generique (jusqu'a 40)
 * enverrait jusqu'a 30000 caracteres au fournisseur pour une seule question,
 * on retient donc un compromis cout/qualite plus bas ici.
 */
const KB_OVERSAMPLE_CAP = 10;

/** Limite SQL a utiliser pour la KB, plafonnee a `KB_OVERSAMPLE_CAP` sans jamais descendre sous `limit`. */
export function kbFetchLimit(limit: number): number {
  return Math.min(fetchLimitForRerank(limit), Math.max(limit, KB_OVERSAMPLE_CAP));
}

export async function searchKb(
  query: string,
  limit = 5,
  userId?: string
): Promise<KbSearchResult[]> {
  if (await isKbEmbeddingConfigured()) {
    try {
      const embedding = await generateEmbedding(query);
      const vectorStr = `[${embedding.join(",")}]`;

      const results = await db.execute(
        sql`SELECT source, title, chunk_text, 1 - (embedding <=> ${vectorStr}::vector) AS score
            FROM kb_chunks
            WHERE embedding IS NOT NULL
            ORDER BY embedding <=> ${vectorStr}::vector
            LIMIT ${kbFetchLimit(limit)}`
      );

      const hits = (
        results.rows as Array<{
          source: string;
          title: string | null;
          chunk_text: string;
          score: number;
        }>
      ).map((r) => ({
        source: r.source,
        title: r.title,
        chunkText: r.chunk_text,
        score: Number(r.score),
      }));

      return rerankCandidates(query, hits, {
        getText: (hit) => hit.chunkText,
        topN: limit,
        surface: "help",
        userId,
        // `kb_chunks` porte la documentation du PRODUIT, la même pour tous les
        // tenants : la portée de son reclassement appartient à l'instance, pas
        // à une organisation. Portée assumée et écrite ici, jamais déduite
        // d'un champ omis.
        organizationId: await instanceProviderScope(),
      });
    } catch (error) {
      logger.error({ err: error }, "Erreur recherche sémantique KB — fallback ILIKE");
    }
  }

  // Fallback : recherche plein-texte simple.
  return searchKbFallback(query, limit, userId);
}

async function searchKbFallback(
  query: string,
  limit: number,
  userId?: string
): Promise<KbSearchResult[]> {
  try {
    const pattern = `%${query.slice(0, 100)}%`;
    const results = await db.execute(
      // Ordre stable (source, chunk_index) : sans clause ORDER BY, l'ensemble
      // des candidats soumis au reclassement pourrait varier d'un appel à
      // l'autre pour une même recherche, et avec lui le résultat final et la
      // clé de cache du reranker.
      sql`SELECT source, title, chunk_text, 0 AS score
          FROM kb_chunks
          WHERE chunk_text ILIKE ${pattern}
          ORDER BY source, chunk_index
          LIMIT ${kbFetchLimit(limit)}`
    );

    const hits = (
      results.rows as Array<{
        source: string;
        title: string | null;
        chunk_text: string;
      }>
    ).map((r) => ({
      source: r.source,
      title: r.title,
      chunkText: r.chunk_text,
      score: 0,
    }));

    // Repli textuel : les lignes ne portent aucun ordre de pertinence
    // (score forcé à 0), le reclassement est donc le seul tri disponible.
    return rerankCandidates(query, hits, {
      getText: (hit) => hit.chunkText,
      topN: limit,
      surface: "help",
      userId,
      // Même portée que le chemin sémantique ci-dessus : la KB d'aide est une
      // ressource d'instance.
      organizationId: await instanceProviderScope(),
    });
  } catch (error) {
    logger.error({ err: error }, "Erreur recherche KB (fallback)");
    return [];
  }
}

export interface KbIndexSummary {
  sources: number;
  chunksIndexed: number;
  chunksSkipped: number;
  chunksDeleted: number;
  /**
   * Fragments qui devaient être (ré)indexés mais ne l'ont pas été : embedding
   * refusé, dimension incohérente avec la colonne vectorielle, ou écriture en
   * base en échec. Un résumé qui ne compte pas ces cas laisse croire à un
   * succès alors que la base de connaissances reste périmée.
   */
  chunksFailed: number;
}

/**
 * Verdict d'une indexation KB. Distingue le « rien à faire » légitime (aucun
 * fragment à réindexer parce que rien n'a changé) du « tout ou partie a
 * échoué », qui doit être signalé : un appelant qui se déclare en succès sans
 * avoir rien écrit laisse l'assistant d'aide servir une base périmée sans que
 * personne ne le sache. Fonction pure.
 */
export function kbIndexVerdict(summary: KbIndexSummary): {
  ok: boolean;
  reason: string;
} {
  if (summary.chunksFailed > 0) {
    const scope =
      summary.chunksIndexed > 0 ? "échec partiel" : "aucun fragment indexé";
    return {
      ok: false,
      reason: `${scope} : ${summary.chunksFailed} fragment(s) en échec, base de connaissances incomplète`,
    };
  }

  if (summary.sources > 0 && summary.chunksIndexed + summary.chunksSkipped === 0) {
    return {
      ok: false,
      reason: `${summary.sources} source(s) lue(s) mais aucun fragment indexé ni conservé`,
    };
  }

  if (summary.chunksIndexed === 0) {
    return { ok: true, reason: "rien à faire, contenu déjà à jour" };
  }

  return { ok: true, reason: "indexation complète" };
}

/** Ligne de résumé lisible, échecs compris. Fonction pure. */
export function formatKbSummary(summary: KbIndexSummary): string {
  return `sources=${summary.sources} indexés=${summary.chunksIndexed} ignorés=${summary.chunksSkipped} supprimés=${summary.chunksDeleted} échoués=${summary.chunksFailed}`;
}

/**
 * Indexe la base de connaissances depuis les fichiers Markdown du disque.
 * Indexation incrémentale par hash de contenu : les chunks inchangés sont
 * sautés (hash identique ET embedding présent), les obsolètes et les sources
 * disparues sont supprimés. `force` recalcule tous les chunks quel que soit
 * le hash (réindexation après changement de modèle d'embedding).
 */
export async function indexKbFromDisk(
  kbDir?: string,
  options: { force?: boolean } = {}
): Promise<KbIndexSummary> {
  const force = options.force === true;
  await ensureKbSchema();

  const dir =
    kbDir || process.env.KB_DIR || path.join(process.cwd(), "docs/kb");

  const files = readdirSync(dir).filter((f) => f.endsWith(".md"));

  const summary: KbIndexSummary = {
    sources: 0,
    chunksIndexed: 0,
    chunksSkipped: 0,
    chunksDeleted: 0,
    chunksFailed: 0,
  };

  // Dimension attendue par la colonne `kb_chunks.embedding` (résolue une seule
  // fois pour tout le lot). Écrire un vecteur d'une autre dimension casserait
  // la recherche KB : on refuse le fragment plutôt que de tenter l'écriture.
  const expectedDimension = await getActiveEmbeddingDimension();

  const seenSources: string[] = [];

  for (const file of files) {
    const source = file.replace(/\.md$/, "");
    seenSources.push(source);
    summary.sources++;

    const raw = readFileSync(path.join(dir, file), "utf8");
    const { title, body } = parseFrontmatter(raw);
    const chunks = chunkMarkdown(body);

    // Chunks existants pour cette source.
    const existingRows = (
      await db.execute(
        sql`SELECT chunk_index, content_hash, (embedding IS NOT NULL) AS has_embedding FROM kb_chunks WHERE source = ${source}`
      )
    ).rows as Array<{
      chunk_index: number;
      content_hash: string;
      has_embedding?: boolean;
    }>;
    // Un chunk n'est réutilisable que s'il porte déjà un vecteur.
    const existing = new Map<number, string>(
      existingRows
        .filter((r) => r.has_embedding === true)
        .map((r) => [Number(r.chunk_index), r.content_hash])
    );

    // Détermine les chunks à (ré)indexer.
    const toIndex: Array<{ index: number; text: string; hash: string }> = [];
    for (let i = 0; i < chunks.length; i++) {
      const hash = hashChunk(chunks[i]);
      if (!force && existing.get(i) === hash) {
        summary.chunksSkipped++;
      } else {
        toIndex.push({ index: i, text: chunks[i], hash });
      }
    }

    // Génère les embeddings + upsert avec concurrence limitée.
    for (let batch = 0; batch < toIndex.length; batch += CONCURRENCY) {
      const slice = toIndex.slice(batch, batch + CONCURRENCY);
      const results = await Promise.allSettled(
        slice.map((c) => generateEmbedding(c.text))
      );

      for (let j = 0; j < results.length; j++) {
        const result = results[j];
        const chunk = slice[j];

        if (result.status === "rejected") {
          logger.error(
            { err: result.reason, source, chunkIndex: chunk.index },
            "Erreur embedding chunk KB"
          );
          summary.chunksFailed++;
          continue;
        }

        if (result.value.length !== expectedDimension) {
          logger.error(
            {
              source,
              chunkIndex: chunk.index,
              expectedDimension,
              actualDimension: result.value.length,
            },
            "Dimension d'embedding incohérente avec kb_chunks.embedding — fragment refusé"
          );
          summary.chunksFailed++;
          continue;
        }

        let insertedId: string | null = null;
        try {
          // UPSERT : retire l'éventuelle ligne (source, index) puis insère.
          await db.execute(
            sql`DELETE FROM kb_chunks WHERE source = ${source} AND chunk_index = ${chunk.index}`
          );

          const [inserted] = await db
            .insert(kbChunks)
            .values({
              source,
              title,
              chunkIndex: chunk.index,
              chunkText: chunk.text,
              contentHash: chunk.hash,
              model: KB_EMBEDDING_MODEL_LABEL,
            })
            .returning({ id: kbChunks.id });

          insertedId = inserted.id;

          const vectorStr = `[${result.value.join(",")}]`;
          await db.execute(
            sql`UPDATE kb_chunks SET embedding = ${vectorStr}::vector, updated_at = now() WHERE id = ${inserted.id}`
          );
          summary.chunksIndexed++;
        } catch (error) {
          logger.error(
            { err: error, source, chunkIndex: chunk.index },
            "Erreur insertion chunk KB"
          );
          summary.chunksFailed++;
          // La ligne a pu être insérée avant l'échec de l'UPDATE du vecteur :
          // elle porterait alors le hash à jour SANS embedding, donc serait
          // « sautée » aux exécutions suivantes et jamais servie à la
          // recherche (qui filtre sur embedding IS NOT NULL). On la retire.
          if (insertedId) {
            try {
              await db.execute(
                sql`DELETE FROM kb_chunks WHERE id = ${insertedId}`
              );
            } catch (cleanupError) {
              logger.error(
                { err: cleanupError, source, chunkIndex: chunk.index },
                "Nettoyage du chunk KB partiellement inséré en échec"
              );
            }
          }
        }
      }
    }

    // Supprime les chunks obsolètes (au-delà du nombre courant).
    const deleted = await db.execute(
      sql`DELETE FROM kb_chunks WHERE source = ${source} AND chunk_index >= ${chunks.length}`
    );
    summary.chunksDeleted += deleted.rowCount ?? 0;
  }

  // Supprime les sources disparues du disque.
  const allSources = (
    await db.execute(sql`SELECT DISTINCT source FROM kb_chunks`)
  ).rows as Array<{ source: string }>;
  const obsolete = allSources
    .map((r) => r.source)
    .filter((s) => !seenSources.includes(s));

  for (const source of obsolete) {
    const deleted = await db.execute(
      sql`DELETE FROM kb_chunks WHERE source = ${source}`
    );
    summary.chunksDeleted += deleted.rowCount ?? 0;
  }

  logger.info({ ...summary }, "Indexation KB terminée");
  return summary;
}
