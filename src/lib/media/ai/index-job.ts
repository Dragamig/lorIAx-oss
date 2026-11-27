import { pool } from "@/lib/db";
import logger from "@/lib/logger";
import { isEmbeddingConfiguredAsync } from "@/lib/ai/embeddings";
import { claimBatch, processOne, type ProcessOutcome } from "./runner";

const BATCH = 9;
/** Extraction PDF et transcription : jamais plus de 3 traitements simultanés. */
const PARALLEL = 3;
/** Budget par exécution (la tâche planifiée tourne toutes les 2 minutes, `protect: true`). */
const BUDGET_MS = 90_000;

/** Coupe-circuit : MEDIA_INDEX_DISABLED=1. */
export function isMediaIndexDisabled(): boolean {
  const v = (process.env.MEDIA_INDEX_DISABLED ?? "").trim().toLowerCase();
  return v === "1" || v === "true";
}

export type MediaIndexJobResult =
  | { status: "ok"; done: number; skipped: number; retried: number; failed: number }
  | { status: "skipped"; skipped: "disabled" | "running" | "no_embedding" };

/** Fast path local au module ; le verrou Postgres ci-dessous couvre toute l'instance (bundle server.js et route cron). */
let running = false;
/** Clé du verrou consultatif d'instance de l'exécuteur d'indexation IA des médias. */
const ADVISORY_KEY = 7_204_001;

/** Traite `rows` avec au plus `PARALLEL` traitements en vol. */
async function processBounded(rows: Awaited<ReturnType<typeof claimBatch>>, now: Date): Promise<ProcessOutcome[]> {
  const out: ProcessOutcome[] = [];
  let next = 0;
  const worker = async () => {
    while (next < rows.length) {
      const row = rows[next++];
      out.push(await processOne(row, now));
    }
  };
  await Promise.all(Array.from({ length: Math.min(PARALLEL, rows.length) }, worker));
  return out;
}

/**
 * Exécuteur de la file d'indexation IA des médias : non réentrant, ne lève jamais
 * (planificateur interne et route cron).
 */
export async function runMediaIndexJob(): Promise<MediaIndexJobResult> {
  if (isMediaIndexDisabled()) return { status: "skipped", skipped: "disabled" };
  if (running) {
    logger.info("Indexation IA des médias ignorée : une exécution est déjà en cours");
    return { status: "skipped", skipped: "running" };
  }
  running = true;
  const tally = { done: 0, skipped: 0, retried: 0, failed: 0 };
  try {
    // Verrou de session sur UNE connexion dédiée : aucune transaction ouverte pendant le traitement
    // (pas de blocage du vacuum). Rendu explicitement ; si le rendu échoue, la connexion est détruite
    // (ce qui lève le verrou côté serveur).
    const client = await pool.connect();
    let destroy = false;
    let outcome: "locked" | "no_embedding" | "ran";
    try {
      const lock = await client.query<{ acquired: boolean }>("SELECT pg_try_advisory_lock($1) AS acquired", [ADVISORY_KEY]);
      if (!lock.rows[0]?.acquired) {
        outcome = "locked";
      } else {
        try {
          if (!(await isEmbeddingConfiguredAsync())) {
            outcome = "no_embedding";
          } else {
            const deadline = Date.now() + BUDGET_MS;
            while (Date.now() < deadline) {
              const now = new Date();
              const rows = await claimBatch(BATCH, now);
              if (rows.length === 0) break;
              for (const o of await processBounded(rows, now)) {
                if (o === "done") tally.done++;
                else if (o === "skipped") tally.skipped++;
                else if (o === "retry") tally.retried++;
                else tally.failed++;
              }
            }
            outcome = "ran";
          }
        } finally {
          try {
            await client.query("SELECT pg_advisory_unlock($1)", [ADVISORY_KEY]);
          } catch {
            destroy = true;
          }
        }
      }
    } catch (err) {
      destroy = true;
      throw err;
    } finally {
      client.release(destroy);
    }
    if (outcome === "locked") {
      logger.info("Indexation IA des médias ignorée : un autre exécuteur de l'instance est en cours");
      return { status: "skipped", skipped: "running" };
    }
    if (outcome === "no_embedding") return { status: "skipped", skipped: "no_embedding" };
    if (tally.done || tally.failed) logger.info(tally, "Indexation IA des médias terminée");
  } catch (err) {
    logger.error({ err }, "Erreur de l'indexation IA planifiée des médias");
  } finally {
    running = false;
  }
  return { status: "ok", ...tally };
}
