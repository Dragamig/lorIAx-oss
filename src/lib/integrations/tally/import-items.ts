/**
 * Détail par soumission d'un import Tally : identité lisible (nom, mail),
 * issue, colonnes remplies (en noms), erreur, run réel ou trace simulée bornée.
 */
import { and, asc, eq, inArray, lt, ne, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { tallyImportItems, tallyImports, userDatabaseColumns } from "@/lib/db/schema";
import { redact, type TraceStep } from "@/lib/automations/trace";
import type { TallyWebhookBody } from "./adapter";

export type ItemOutcome = "created" | "completed" | "ignored" | "error" | "unknown";

/** Une trace simulée dépassant ce volume perd les entrées et sorties de ses étapes. */
export const ITEM_TRACE_MAX_BYTES = 24 * 1024;
/** Nombre de soumissions par import dont la trace simulée est conservée. */
export const ITEM_TRACE_MAX_ITEMS = 200;
export const ITEMS_PAGE_SIZE = 200;

const str = (v: unknown): string | null => (typeof v === "string" && v.trim() ? v.trim() : null);

/** Nom et mail lisibles, extraits des champs de la soumission. */
export function describeSubmission(body: TallyWebhookBody): { name: string | null; email: string | null } {
  const fields = body.data.fields ?? [];
  const email =
    fields.map((f) => (f.type === "INPUT_EMAIL" ? str(f.value) : null)).find(Boolean) ??
    fields.map((f) => (/mail/i.test(f.label) ? str(f.value) : null)).find(Boolean) ??
    null;
  const parts = fields
    .filter((f) => f.type === "INPUT_TEXT" && /(^|\b)(nom|pr[ée]nom|name|identit[ée])/i.test(f.label))
    .map((f) => str(f.value))
    .filter((v): v is string => !!v);
  const name = parts.length > 0 ? parts.join(" ") : null;
  return { name: name?.slice(0, 200) ?? null, email: email?.slice(0, 200) ?? null };
}

export interface RowResult {
  outcome: "created" | "completed" | "ignored" | "unknown";
  filledColumns: string[];
  databaseId: string | null;
}

/** Issue de la ligne écrite par le premier pas qui en a une. */
export function rowResultFromSteps(steps: readonly TraceStep[] | undefined): RowResult {
  for (const step of steps ?? []) {
    const row = (
      step.output as { row?: { outcome?: unknown; created?: unknown; filledColumns?: unknown; databaseId?: unknown } } | undefined
    )?.row;
    if (!row || typeof row !== "object") continue;
    const outcome =
      row.outcome === "created" || row.outcome === "completed" || row.outcome === "ignored"
        ? row.outcome
        : row.created === true
          ? "created"
          : null;
    if (!outcome) continue;
    return {
      outcome,
      filledColumns: Array.isArray(row.filledColumns) ? row.filledColumns.filter((c): c is string => typeof c === "string") : [],
      databaseId: typeof row.databaseId === "string" ? row.databaseId : null,
    };
  }
  return { outcome: "unknown", filledColumns: [], databaseId: null };
}

/** Message d'erreur lisible : première étape en erreur, sinon l'erreur globale. */
export function errorFromSteps(steps: readonly TraceStep[] | undefined, fallback?: string): string | null {
  const failed = (steps ?? []).find((s) => s.status === "error" && s.error?.message);
  return (failed?.error?.message ?? fallback ?? null)?.slice(0, 500) ?? null;
}

/** Trace conservable : plafonnée en volume, entrées et sorties retirées au-delà. */
export function boundTrace(steps: readonly TraceStep[] | undefined): { trace: TraceStep[] | null; truncated: boolean } {
  if (!steps || steps.length === 0) return { trace: null, truncated: false };
  if (JSON.stringify(steps).length <= ITEM_TRACE_MAX_BYTES) return { trace: [...steps], truncated: false };
  const light = steps.map((s) => ({ ...s, inputs: undefined, output: undefined, truncated: true }));
  if (JSON.stringify(light).length <= ITEM_TRACE_MAX_BYTES) return { trace: light, truncated: true };
  return { trace: null, truncated: true };
}

/** Résout des identifiants de colonnes en noms (cache par base pour la durée d'un import). */
export function createColumnNamer() {
  const cache = new Map<string, Map<string, string>>();
  return async (databaseId: string | null, ids: string[]): Promise<string[]> => {
    if (ids.length === 0) return [];
    if (!databaseId) return ids;
    let names = cache.get(databaseId);
    if (!names) {
      const cols = await db
        .select({ id: userDatabaseColumns.id, name: userDatabaseColumns.name })
        .from(userDatabaseColumns)
        .where(eq(userDatabaseColumns.databaseId, databaseId));
      names = new Map(cols.map((c) => [c.id, c.name]));
      cache.set(databaseId, names);
    }
    return ids.map((id) => names!.get(id) ?? id);
  };
}

export async function recordImportItem(p: {
  importId: string;
  submissionId: string;
  position: number;
  body: TallyWebhookBody;
  ok: boolean;
  steps: readonly TraceStep[] | undefined;
  error?: string;
  runId?: string;
  real: boolean;
  nameColumns: ReturnType<typeof createColumnNamer>;
}): Promise<RowResult> {
  const result = rowResultFromSteps(p.steps);
  const { name, email } = describeSubmission(p.body);
  const filledColumns = p.ok ? await p.nameColumns(result.databaseId, result.filledColumns) : [];
  const keepTrace = !p.real && p.position < ITEM_TRACE_MAX_ITEMS;
  const bounded = keepTrace ? boundTrace(p.steps) : { trace: null, truncated: false };
  await db
    .insert(tallyImportItems)
    .values({
      importId: p.importId,
      submissionId: p.submissionId.slice(0, 128),
      position: p.position,
      name,
      email,
      outcome: p.ok ? result.outcome : "error",
      filledColumns,
      errorMessage: p.ok ? null : errorFromSteps(p.steps, p.error) ?? "Erreur pendant l'exécution",
      runId: p.real ? (p.runId ?? null) : null,
      // Redéfense : la trace passe (encore) par la rédaction commune avant stockage.
      trace: (bounded.trace ? redact(bounded.trace) : null) as unknown[] | null,
      traceTruncated: bounded.truncated,
    })
    .onConflictDoNothing();
  return result;
}

/** Libère les traces des simulations précédentes de cet automatisme (la dernière suffit). */
export async function dropOldSimulatedTraces(automationId: string, keepImportId: string): Promise<void> {
  const old = db
    .select({ id: tallyImports.id })
    .from(tallyImports)
    .where(and(eq(tallyImports.automationId, automationId), ne(tallyImports.id, keepImportId)));
  await db
    .update(tallyImportItems)
    .set({ trace: null })
    .where(and(inArray(tallyImportItems.importId, old), sql`${tallyImportItems.trace} is not null`));
}

/** Rétention : détail par réponse (nom, mail) 30 jours, traces simulées 24 h. */
export const ITEMS_RETENTION_MS = 30 * 24 * 3_600_000;
export const SIMULATED_TRACE_RETENTION_MS = 24 * 3_600_000;

export async function purgeTallyImportData(now = new Date()): Promise<void> {
  await db
    .update(tallyImportItems)
    .set({ trace: null })
    .where(
      and(
        lt(tallyImportItems.createdAt, new Date(now.getTime() - SIMULATED_TRACE_RETENTION_MS)),
        sql`${tallyImportItems.trace} is not null`
      )
    );
  await db
    .delete(tallyImportItems)
    .where(lt(tallyImportItems.createdAt, new Date(now.getTime() - ITEMS_RETENTION_MS)));
}

export interface ItemsPage {
  items: {
    submissionId: string;
    name: string | null;
    email: string | null;
    outcome: string;
    filledColumns: string[];
    errorMessage: string | null;
    runId: string | null;
    hasTrace: boolean;
  }[];
  counts: Record<"all" | "created" | "completed" | "ignored" | "error" | "unknown", number>;
  total: number;
  offset: number;
  limit: number;
  hasMore: boolean;
}

export async function listImportItems(
  importId: string,
  opts: { outcome?: string | null; offset?: number; limit?: number }
): Promise<ItemsPage> {
  const limit = Math.min(Math.max(opts.limit ?? ITEMS_PAGE_SIZE, 1), ITEMS_PAGE_SIZE);
  const offset = Math.max(opts.offset ?? 0, 0);
  const grouped = await db
    .select({ outcome: tallyImportItems.outcome, n: sql<number>`count(*)::int` })
    .from(tallyImportItems)
    .where(eq(tallyImportItems.importId, importId))
    .groupBy(tallyImportItems.outcome);
  const counts = { all: 0, created: 0, completed: 0, ignored: 0, error: 0, unknown: 0 };
  for (const g of grouped) {
    counts.all += g.n;
    if (g.outcome in counts) counts[g.outcome as keyof typeof counts] += g.n;
  }
  const filter = opts.outcome && opts.outcome in counts && opts.outcome !== "all" ? opts.outcome : null;
  const where = filter
    ? and(eq(tallyImportItems.importId, importId), eq(tallyImportItems.outcome, filter))
    : eq(tallyImportItems.importId, importId);
  const rows = await db
    .select({
      submissionId: tallyImportItems.submissionId,
      name: tallyImportItems.name,
      email: tallyImportItems.email,
      outcome: tallyImportItems.outcome,
      filledColumns: tallyImportItems.filledColumns,
      errorMessage: tallyImportItems.errorMessage,
      runId: tallyImportItems.runId,
      hasTrace: sql<boolean>`${tallyImportItems.trace} is not null`,
    })
    .from(tallyImportItems)
    .where(where)
    .orderBy(asc(tallyImportItems.position))
    .limit(limit + 1)
    .offset(offset);
  const total = filter ? counts[filter as keyof typeof counts] : counts.all;
  return { items: rows.slice(0, limit), counts, total, offset, limit, hasMore: rows.length > limit };
}

export async function getItemTrace(importId: string, submissionId: string) {
  const [row] = await db
    .select({ trace: tallyImportItems.trace, truncated: tallyImportItems.traceTruncated })
    .from(tallyImportItems)
    .where(and(eq(tallyImportItems.importId, importId), eq(tallyImportItems.submissionId, submissionId)))
    .limit(1);
  return row ?? null;
}
