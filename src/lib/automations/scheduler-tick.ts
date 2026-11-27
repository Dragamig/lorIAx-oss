/**
 * Orchestration d'un tick des automatisations planifiées (Spec 1 §5).
 * Appelée chaque minute par le croner de server.ts. Réutilise le scheduler
 * croner déjà présent (pas de nouvelle dépendance) ; l'anti-doublon multi-pod
 * est déjà assuré par les verrous advisory de l'executor (tickCron/tickDate).
 */
import { tickCron, tickDateAutomations } from "@/lib/automations/executor";
import { withTimeout } from "@/lib/automations/with-timeout";
import { MAILING_STEP_TIMEOUT_MS } from "@/lib/mailing/timeouts";

/** La purge de rétention Tally n'a pas besoin de tourner chaque minute. */
export const TALLY_PURGE_EVERY_MS = 10 * 60_000;
let lastTallyPurge = 0;

/** Tick cron, date, Tally : chaque étape bornée, erreurs absorbées (ne throw jamais). */
export async function automationSchedulerTick(): Promise<void> {
  try {
    await withTimeout("automations-cron", () => tickCron());
  } catch (err) {
    console.error("[automations-cron] Erreur:", err);
  }
  try {
    await withTimeout("automations-date", () => tickDateAutomations());
  } catch (err) {
    console.error("[automations-date] Erreur:", err);
  }
  try {
    await withTimeout("tally-import", async () => {
      const { failStaleTallyImports } = await import("@/lib/integrations/tally/import-runner");
      await failStaleTallyImports();
    });
  } catch (err) {
    console.error("[tally-import] Erreur:", err);
  }
  try {
    const now = Date.now();
    if (now - lastTallyPurge >= TALLY_PURGE_EVERY_MS) {
      lastTallyPurge = now;
      await withTimeout("tally-purge", async () => {
        const { purgeTallyImportData } = await import("@/lib/integrations/tally/import-items");
        await purgeTallyImportData();
      });
    }
  } catch (err) {
    console.error("[tally-purge] Erreur:", err);
  }
}

/**
 * Tick de l'outbox mailing, sur sa propre Cron : indépendant des étapes d'automatisme.
 * Reprend aussi les mails `scheduled` échus (après redémarrage) via claimDue.
 */
export async function mailingSchedulerTick(): Promise<void> {
  try {
    await withTimeout("mailing-tick", async () => {
      const { mailingTick } = await import("@/lib/mailing/tick");
      await mailingTick();
    }, MAILING_STEP_TIMEOUT_MS);
  } catch (err) {
    console.error("[mailing-tick] Erreur:", err);
  }
}
