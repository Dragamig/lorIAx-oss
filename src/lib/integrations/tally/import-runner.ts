/**
 * Import de soumissions Tally dans un automatisme webhook entrant.
 *
 * Chaque soumission est adaptée au format du webhook Tally puis exécutée
 * séquentiellement dans l'automatisme. Tâche de fond dans le processus Node
 * (serveur long-lived) avec état en base ; un import interrompu (redémarrage)
 * est marqué « failed » par `failStaleTallyImports` et se relance sans risque
 * de doublon (idempotence par identifiant de soumission).
 *
 * Quotas : plafond de soumissions par import (`IMPORT_CAP`) et pause entre deux
 * exécutions ; le plafond horaire d'organisation du moteur est volontairement
 * non appliqué (`skipOrgQuota`), il bloquerait tout import au-delà de 100.
 */
import { and, eq, inArray, lt, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import {
  userDatabaseAutomations,
  userDatabaseAutomationRuns,
  tallyImports,
  tallyImportedSubmissions,
} from "@/lib/db/schema";
import { buildTestPayload, executeAutomation, runAutomationTest } from "@/lib/automations/executor";
import { buildWebhookPayload } from "@/lib/automations/webhook-inbound";
import type { AutomationRow } from "@/lib/automations/actions/types";
import type { TraceStep } from "@/lib/automations/trace";
import { submissionToWebhookBody } from "./adapter";
import { getTallyClientForOrg } from "./key-store";
import type { TallyClient } from "./client";
import { createColumnNamer, dropOldSimulatedTraces, recordImportItem } from "./import-items";
import { markSubmissionDone, releaseSubmission, reserveSubmission } from "./submission-claims";
import { TallyError } from "./client";

export const IMPORT_CAP = 2_000;
export const REAL_PAUSE_MS = 600;
export const SIMULATE_PAUSE_MS = 150;
export const STALE_AFTER_MS = 3 * 60_000;
/** Battement de coeur : bien en deçà de STALE_AFTER_MS. */
export const HEARTBEAT_MS = 30_000;

/** Un import est déjà actif pour cet automatisme (contrainte d'unicité). */
export class ActiveImportError extends Error {
  constructor() {
    super("Un import est déjà en cours pour cet automatisme");
  }
}

function isUniqueViolation(err: unknown): boolean {
  const e = err as { code?: unknown; cause?: { code?: unknown } } | null;
  return e?.code === "23505" || e?.cause?.code === "23505";
}

/** Message sûr pour le client : jamais le texte brut de l'erreur. */
export function publicImportError(err: unknown): string {
  if (err instanceof TallyError) {
    if (err.kind === "invalid_key") return "Clé Tally invalide ou révoquée";
    if (err.kind === "rate_limited") return "Quota Tally atteint, relancez l'import plus tard";
    if (err.kind === "not_found") return "Formulaire Tally introuvable";
    return "Tally indisponible, relancez l'import plus tard";
  }
  return "Erreur pendant l'import";
}

export type ImportOutcome = "created" | "completed" | "ignored" | "unknown";

/** Lit `row.outcome` dans les sorties des étapes ; champ absent = « created » si `row.created`. */
export function outcomeFromSteps(steps: readonly TraceStep[] | undefined): ImportOutcome {
  for (const step of steps ?? []) {
    const row = (step.output as { row?: { outcome?: unknown; created?: unknown } } | undefined)?.row;
    if (!row || typeof row !== "object") continue;
    if (row.outcome === "created" || row.outcome === "completed" || row.outcome === "ignored") {
      return row.outcome;
    }
    if (row.created === true) return "created";
  }
  return "unknown";
}

/** Identifiants de réponse déjà connus : imports passés + runs (webhook compris) + dernier corps reçu. */
export async function getKnownSubmissionIds(automationId: string): Promise<Set<string>> {
  const known = new Set<string>();
  const imported = await db
    .select({ id: tallyImportedSubmissions.submissionId })
    .from(tallyImportedSubmissions)
    .where(and(eq(tallyImportedSubmissions.automationId, automationId), eq(tallyImportedSubmissions.state, "done")));
  for (const r of imported) known.add(r.id);

  const rid = sql<string | null>`${userDatabaseAutomationRuns.payload}->'variables'->'body'->'data'->>'responseId'`;
  const runs = await db
    .select({ id: rid })
    .from(userDatabaseAutomationRuns)
    .where(
      and(
        eq(userDatabaseAutomationRuns.automationId, automationId),
        sql`${userDatabaseAutomationRuns.status} in ('success','partial')`,
        sql`${rid} is not null`
      )
    )
    .limit(100_000);
  for (const r of runs) if (r.id) known.add(r.id);

  const [auto] = await db
    .select({ cfg: userDatabaseAutomations.triggerConfig })
    .from(userDatabaseAutomations)
    .where(eq(userDatabaseAutomations.id, automationId))
    .limit(1);
  const last = (auto?.cfg as { lastReceived?: { body?: { data?: { responseId?: unknown } } } } | null)
    ?.lastReceived?.body?.data?.responseId;
  if (typeof last === "string" && last) known.add(last);
  return known;
}

export interface SubmissionCount {
  total: number;
  imported: number;
  toImport: number;
}

export async function countSubmissions(
  client: TallyClient,
  formId: string,
  opts: { since?: Date | null; automationId?: string | null }
): Promise<SubmissionCount> {
  // Une seule page d'une seule ligne : le total vient de Tally, pas d'un parcours.
  const page = await client.listSubmissionsPage(formId, {
    page: 1,
    limit: 1,
    startDate: opts.since?.toISOString(),
  });
  const total = page.total ?? page.submissions.length;
  let imported = 0;
  if (opts.automationId) {
    const [row] = await db
      .select({ n: sql<number>`count(*)::int` })
      .from(tallyImportedSubmissions)
      .where(and(eq(tallyImportedSubmissions.automationId, opts.automationId), eq(tallyImportedSubmissions.state, "done")));
    imported = Math.min(row?.n ?? 0, total);
  }
  return { total, imported, toImport: Math.max(total - imported, 0) };
}

/** Un import non terminé existe-t-il déjà pour cet automatisme ? */
export async function findActiveImport(automationId: string) {
  const [row] = await db
    .select({ id: tallyImports.id })
    .from(tallyImports)
    .where(
      and(eq(tallyImports.automationId, automationId), inArray(tallyImports.status, ["pending", "running"]))
    )
    .limit(1);
  return row ?? null;
}

export async function startImport(p: {
  organizationId: string;
  automation: AutomationRow;
  formId: string;
  mode: "simulate" | "real";
  since?: Date | null;
  actor: { id: string; email?: string; name?: string };
  /** Tests : exécution en ligne au lieu de la tâche de fond. */
  runInline?: boolean;
}): Promise<string> {
  let job: { id: string };
  try {
    [job] = await db
      .insert(tallyImports)
      .values({
        organizationId: p.organizationId,
        automationId: p.automation.id,
        formId: p.formId,
        mode: p.mode,
        since: p.since ?? null,
        cap: IMPORT_CAP,
        startedBy: p.actor.id,
      })
      .returning({ id: tallyImports.id });
  } catch (err) {
    if (isUniqueViolation(err)) throw new ActiveImportError();
    throw err;
  }
  const run = () =>
    runImport(job.id, p.automation, p.actor).catch(async (err) => {
      console.error("[tally-import] échec", err instanceof Error ? err.message.slice(0, 200) : "inconnu");
      await db
        .update(tallyImports)
        .set({ status: "failed", errorMessage: "Erreur interne pendant l'import", updatedAt: new Date() })
        .where(and(eq(tallyImports.id, job.id), inArray(tallyImports.status, ["pending", "running"])));
    });
  if (p.runInline) await run();
  else void run();
  return job.id;
}

const sleepMs = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

export async function runImport(
  importId: string,
  automation: AutomationRow,
  actor: { id: string; email?: string; name?: string },
  deps: { client?: TallyClient | null; pause?: boolean } = {}
): Promise<void> {
  const [job] = await db.select().from(tallyImports).where(eq(tallyImports.id, importId)).limit(1);
  if (!job) return;
  const client = deps.client !== undefined ? deps.client : await getTallyClientForOrg(job.organizationId);
  if (!client) {
    await db
      .update(tallyImports)
      .set({ status: "failed", errorMessage: "Clé Tally absente ou illisible", updatedAt: new Date() })
      .where(eq(tallyImports.id, importId));
    return;
  }
  await db
    .update(tallyImports)
    .set({ status: "running", updatedAt: new Date() })
    .where(and(eq(tallyImports.id, importId), inArray(tallyImports.status, ["pending", "running"])));

  const counters = { total: 0, processed: 0, created: 0, completed: 0, ignored: 0, errors: 0, skipped: 0 };
  const flush = (extra: Record<string, unknown> = {}) =>
    db
      .update(tallyImports)
      .set({ ...counters, ...extra, updatedAt: new Date() })
      // Ne ressuscite jamais un import déjà passé en failed / cancelled / completed.
      .where(and(eq(tallyImports.id, importId), inArray(tallyImports.status, ["pending", "running"])));
  // Battement de coeur indépendant de la boucle (réponses ignorées, pagination, attentes 429).
  const heartbeat = setInterval(() => {
    void db
      .update(tallyImports)
      .set({ updatedAt: new Date() })
      .where(and(eq(tallyImports.id, importId), eq(tallyImports.status, "running")))
      .catch(() => {});
  }, HEARTBEAT_MS);
  heartbeat.unref?.();

  const real = job.mode === "real";
  const nameColumns = createColumnNamer();
  let position = 0;
  if (!real) await dropOldSimulatedTraces(job.automationId, importId).catch(() => {});
  const pauseMs = deps.pause === false ? 0 : real ? REAL_PAUSE_MS : SIMULATE_PAUSE_MS;
  let finalStatus: "completed" | "cancelled" | "failed" = "completed";
  let errorMessage: string | null = null;

  try {
    const known = await getKnownSubmissionIds(job.automationId);
    const form = await client.getForm(job.formId);
    let attempted = 0;
    let totalSet = false;

    pages: for await (const page of client.iterateSubmissions(job.formId, {
      startDate: job.since?.toISOString(),
    })) {
      if (!totalSet) {
        totalSet = true;
        // Total attendu fixé une fois : annoncé par Tally (filtre de date), moins les réponses déjà connues, borné au plafond.
        if (typeof page.total === "number") {
          counters.total = Math.min(Math.max(page.total - known.size, 0), job.cap);
          await flush();
        }
      }
      for (const sub of page.submissions) {
        if (known.has(sub.id)) {
          counters.skipped++;
          continue;
        }
        if (attempted >= job.cap) {
          counters.skipped++;
          errorMessage = `Plafond de ${job.cap} soumissions par import atteint, relancez pour la suite`;
          continue;
        }
        const [state] = await db
          .select({ c: tallyImports.cancelRequested, status: tallyImports.status })
          .from(tallyImports)
          .where(eq(tallyImports.id, importId))
          .limit(1);
        if (state?.status && state.status !== "running") break pages; // déclaré mort : on s'arrête
        if (state?.c) {
          finalStatus = "cancelled";
          break pages;
        }
        if (real && !(await reserveSubmission(job.automationId, sub.id, importId))) {
          counters.skipped++; // déjà traitée (webhook ou autre import) : on passe
          continue;
        }
        attempted++;
        const body = submissionToWebhookBody(sub, page.questions, form);
        const sample = { event: "webhook_inbound" as const, ...buildWebhookPayload(body) };
        let steps: TraceStep[] | undefined;
        let ok = false;
        let runId: string | undefined;
        let failure: string | undefined;
        if (real) {
          let result: Awaited<ReturnType<typeof executeAutomation>>;
          try {
            result = await executeAutomation(
              automation,
              buildTestPayload(automation, sample, actor),
              { source: "import", skipPerAutomationQuota: true, skipLastRunUpdate: true, skipOrgQuota: true }
            );
          } catch (e) {
            await releaseSubmission(job.automationId, sub.id).catch(() => {});
            throw e;
          }
          steps = result.trace;
          runId = result.runId;
          failure = result.error;
          ok = result.status === "success" || result.status === "partial";
        } else {
          const result = await runAutomationTest({ automation, mode: "simulate", sample, actor });
          steps = result.steps;
          failure = result.error;
          ok = result.status === "success" || result.status === "partial";
        }
        counters.processed++;
        if (!ok) {
          counters.errors++;
          if (real) await releaseSubmission(job.automationId, sub.id).catch(() => {});
        } else {
          const outcome = outcomeFromSteps(steps);
          if (outcome === "created") counters.created++;
          else if (outcome === "completed") counters.completed++;
          else if (outcome === "ignored") counters.ignored++;
          if (real) await markSubmissionDone(job.automationId, sub.id);
        }
        await recordImportItem({
          importId, submissionId: sub.id, position: position++, body, ok, steps, error: failure, runId, real, nameColumns,
        }).catch((e) => console.error("[tally-import] détail non enregistré", e instanceof Error ? e.message : "inconnu"));
        await flush();
        if (pauseMs > 0) await sleepMs(pauseMs);
      }
    }
  } catch (err) {
    finalStatus = "failed";
    console.error("[tally-import] erreur", err instanceof Error ? err.message.slice(0, 200) : "inconnue");
    errorMessage = publicImportError(err);
  } finally {
    clearInterval(heartbeat);
  }
  // Flux terminé avec moins de réponses que prévu (ou total inconnu) : le total final est ce qui a été traité.
  if (finalStatus === "completed") counters.total = counters.processed;
  else if (counters.total > 0 && counters.processed > counters.total) counters.total = counters.processed;
  await flush({ status: finalStatus, errorMessage });
}

/** Marque « failed » les imports sans signe de vie (processus redémarré). */
export async function failStaleTallyImports(now = new Date()): Promise<void> {
  await db
    .update(tallyImports)
    .set({ status: "failed", errorMessage: "Import interrompu, relancez-le", updatedAt: now })
    .where(
      and(
        inArray(tallyImports.status, ["pending", "running"]),
        lt(tallyImports.updatedAt, new Date(now.getTime() - STALE_AFTER_MS))
      )
    );
}
