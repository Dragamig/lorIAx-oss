import {
  ensureKbSchema,
  formatKbSummary,
  indexKbFromDisk,
  isKbEmbeddingConfigured,
  kbIndexVerdict,
  type KbIndexSummary,
} from "@/lib/kb/kb";
import logger from "@/lib/logger";

export interface KbIndexRun {
  summary: KbIndexSummary;
  verdict: { ok: boolean; reason: string };
}

/**
 * Cœur partagé par la route `/api/cron/kb-index` et le job planifié :
 * prépare le schéma, indexe depuis le disque et rend le verdict.
 * Lève en cas d'erreur d'infrastructure (base, disque).
 */
export async function executeKbIndex(): Promise<KbIndexRun> {
  await ensureKbSchema();
  const summary = await indexKbFromDisk();
  return { summary, verdict: kbIndexVerdict(summary) };
}

let running = false;

/** Vrai si la planification est désactivée (KB_INDEX_SCHEDULE=off). */
export function isKbIndexScheduleDisabled(): boolean {
  return (process.env.KB_INDEX_SCHEDULE ?? "").trim().toLowerCase() === "off";
}

/**
 * Job d'indexation automatique de la KB d'aide (démarrage différé + nuit).
 * Idempotent (hash de contenu), non réentrant, ne lève jamais.
 */
export async function runKbIndexJob(): Promise<void> {
  if (running) {
    logger.info("Indexation KB planifiée ignorée : une exécution est déjà en cours");
    return;
  }
  running = true;
  try {
    if (!(await isKbEmbeddingConfigured())) {
      logger.info("Indexation KB planifiée ignorée : embedding non configuré");
      return;
    }
    const { summary, verdict } = await executeKbIndex();
    const line = formatKbSummary(summary);
    if (summary.chunksFailed > 0 || !verdict.ok) {
      logger.error({ ...summary, reason: verdict.reason }, `Indexation KB planifiée en échec : ${line}`);
    } else {
      logger.info({ ...summary }, `Indexation KB planifiée terminée : ${line}`);
    }
  } catch (err) {
    logger.error({ err }, "Erreur indexation KB planifiée");
  } finally {
    running = false;
  }
}
