import { sql } from "drizzle-orm";
import { db } from "@/lib/db";
import logger from "@/lib/logger";

const BATCH = 500;

/** Cibles dont la table est connue. `design` et `presentation` n'ont pas de table d'existence : jamais touchées. */
export const RECONCILED_TARGETS = {
  document: "documents",
  database_row: "user_database_rows",
  video_project: "video_projects",
  brand_kit: "brand_kits",
} as const;
export type ReconciledTarget = keyof typeof RECONCILED_TARGETS;

export interface ReconcileStore {
  /** Usages (toutes provenances) de ce type de cible. */
  countChecked(type: ReconciledTarget): Promise<number>;
  /** Usages `explicit` dont la cible n'existe plus : comptés, jamais supprimés. */
  countStaleExplicit(type: ReconciledTarget): Promise<number>;
  /** Usages `content` dont la cible n'existe plus. */
  countStaleContent(type: ReconciledTarget): Promise<number>;
  /** Au plus `limit` identifiants d'usages `content` orphelins. */
  listStaleContentIds(type: ReconciledTarget, limit: number): Promise<string[]>;
  deleteContentUsages(ids: string[]): Promise<number>;
}

function staleWhere(type: ReconciledTarget, source: "content" | "explicit") {
  const table = sql.raw(RECONCILED_TARGETS[type]);
  return sql`mu.target_type = ${type}::media_usage_target
    AND mu.source = ${source}::media_usage_source
    AND NOT EXISTS (SELECT 1 FROM ${table} t WHERE t.id = mu.target_id)`;
}

async function count(query: ReturnType<typeof sql>): Promise<number> {
  const r = await db.execute(query);
  return Number((r.rows[0] as { n: string | number } | undefined)?.n ?? 0);
}

export const dbReconcileStore: ReconcileStore = {
  countChecked: (type) =>
    count(sql`SELECT count(*) AS n FROM media_usages mu WHERE mu.target_type = ${type}::media_usage_target`),
  countStaleExplicit: (type) =>
    count(sql`SELECT count(*) AS n FROM media_usages mu WHERE ${staleWhere(type, "explicit")}`),
  countStaleContent: (type) =>
    count(sql`SELECT count(*) AS n FROM media_usages mu WHERE ${staleWhere(type, "content")}`),
  async listStaleContentIds(type, limit) {
    const r = await db.execute(
      sql`SELECT mu.id FROM media_usages mu WHERE ${staleWhere(type, "content")} ORDER BY mu.id LIMIT ${limit}`,
    );
    return (r.rows as { id: string }[]).map((x) => x.id);
  },
  async deleteContentUsages(ids) {
    if (ids.length === 0) return 0;
    // Garde redondante : la provenance `explicit` n'est jamais supprimée, même par erreur d'appel.
    const r = await db.execute(
      sql`DELETE FROM media_usages WHERE source = 'content'::media_usage_source
        AND id IN (${sql.join(ids.map((i) => sql`${i}::uuid`), sql`, `)})`,
    );
    return r.rowCount ?? 0;
  },
};

/**
 * Rattrapage périodique de `media_usages` : retire les usages de provenance `content`
 * dont la cible n'existe plus. Ne touche jamais un usage `explicit`, ni ceux d'un média
 * en corbeille (la table `media` n'est pas consultée).
 */
export async function reconcileMediaUsages(
  opts: { dryRun?: boolean; store?: ReconcileStore } = {},
): Promise<{ checked: number; removed: number; keptExplicit: number }> {
  const store = opts.store ?? dbReconcileStore;
  let checked = 0;
  let removed = 0;
  let keptExplicit = 0;
  for (const type of Object.keys(RECONCILED_TARGETS) as ReconciledTarget[]) {
    checked += await store.countChecked(type);
    keptExplicit += await store.countStaleExplicit(type);
    if (opts.dryRun) {
      removed += await store.countStaleContent(type);
      continue;
    }
    for (;;) {
      const ids = await store.listStaleContentIds(type, BATCH);
      if (ids.length === 0) break;
      const n = await store.deleteContentUsages(ids);
      removed += n;
      if (n === 0) break; // aucune progression : évite une boucle infinie
    }
  }
  return { checked, removed, keptExplicit };
}

/** Enveloppe sûre pour `server.ts` : ne lève jamais. */
export async function runMediaReconcileJob(): Promise<void> {
  try {
    const r = await reconcileMediaUsages();
    if (r.removed > 0) logger.info({ ...r }, "Réconciliation des usages médias terminée");
  } catch (err) {
    logger.error({ err }, "Erreur de la réconciliation des usages médias");
  }
}
