/**
 * Runtime des automatisations Espace Bases — Phase 5.
 *
 * Deux entrées principales :
 *   - `dispatchTrigger()` : appelé depuis les routes /api/databases/[id]/rows
 *     POST/PATCH/DELETE pour activer les automations row_*.
 *   - `executeAutomation()` : exécute une automation donnée (utilisé par
 *     dispatchTrigger et par le cron pour les automations type "cron").
 *
 * Toutes les exécutions sont enregistrées dans automation_runs.
 *
 * Quotas (R5 du spec) :
 *   - Max 1 exécution / automation / minute (vérifié via last_run_at)
 *   - Max 100 exécutions / org / heure (vérifié via COUNT en fenêtre glissante)
 */
import { randomUUID } from "node:crypto";
import { db } from "@/lib/db";
import { snapshotTriggerContext } from "@/lib/automations/replay-context";
import { eq, and, or, gte, count, desc, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import {
  userDatabaseAutomations,
  userDatabaseAutomationRuns,
  userDatabaseRows,
  userDatabases,
  spaces,
} from "@/lib/db/schema";
import { validateExternalUrl } from "@/lib/security/url-validator";
import { isDateRowDue, parseCellDateMs } from "@/lib/automations/date-trigger";
import { isCronDue } from "@/lib/automations/cron";
import { shouldFireValueChanged, type ValueChangedConfig } from "@/lib/automations/value-changed";
import { getSetting } from "@/lib/settings/system-settings";
import {
  type AutomationGraph,
  synthesizeGraphFromAction,
  findEntryNode,
  nextNodeIds,
  evaluateCondition,
} from "@/lib/automations/automation-graph";
import { getAction } from "@/lib/automations/actions/registry";
import type { AutomationRow, ExecutionContext } from "@/lib/automations/actions/types";
import { capTrace, describeError, redact, resolveInputs, TRIGGER_STEP_ID, type TraceStep } from "@/lib/automations/trace";

export type TriggerEvent = "row_created" | "row_updated" | "row_deleted";

/**
 * Options d'exécution. Utilisées par le tick « date atteinte » qui déclenche
 * une automation par ligne échue : on désactive alors le quota par-automation
 * (1/min — sinon seule la 1re ligne d'un tick passerait) et la mise à jour de
 * lastRunAt (le tick gère lui-même ce curseur de fenêtre). Le quota org/heure
 * reste appliqué pour borner les bases à grand volume.
 */
export type RunSource = "trigger" | "test" | "replay" | "import";

interface ExecuteOptions {
  skipPerAutomationQuota?: boolean;
  skipLastRunUpdate?: boolean;
  /**
   * Import de masse (Tally) : le plafond horaire d'organisation ne s'applique pas,
   * l'appelant porte son propre plafond par import et son débit borné.
   */
  skipOrgQuota?: boolean;
  /** Origine du run consigné (défaut « trigger »). */
  source?: RunSource;
  /** Test réel partiel : arrêt après ce nœud (inclus). */
  untilNodeId?: string;
}

interface TriggerContext {
  databaseId: string;
  rowId: string;
  cells: Record<string, unknown>;
}

const ORG_HOURLY_QUOTA = 100;
const PER_AUTOMATION_MIN_INTERVAL_MS = 60_000;

/**
 * Appelé lors d'un changement de ligne pour activer les automations
 * row_created/row_updated/row_deleted de la database.
 *
 * Fire-and-forget : on ne bloque pas la requête HTTP utilisateur en attendant
 * les webhooks externes. Les erreurs sont loggées dans la table runs.
 */
async function automationsGloballyEnabled(): Promise<boolean> {
  const cfg = await getSetting<{ enabled?: boolean }>("automations");
  // Par défaut activé : seul un toggle explicit à false coupe le runtime.
  return cfg?.enabled !== false;
}

export async function dispatchTrigger(event: TriggerEvent, ctx: TriggerContext): Promise<void> {
  if (!(await automationsGloballyEnabled())) return;

  const automations = await db
    .select()
    .from(userDatabaseAutomations)
    .where(
      and(
        eq(userDatabaseAutomations.databaseId, ctx.databaseId),
        eq(userDatabaseAutomations.triggerType, event),
        eq(userDatabaseAutomations.enabled, true)
      )
    );

  if (automations.length === 0) return;

  // Lance toutes en parallèle, sans await — on ne fait pas attendre la
  // requête HTTP. Les erreurs sont absorbées par catch dans executeAutomation.
  for (const a of automations) {
    void executeAutomation(a as AutomationRow, { event, ...ctx }).catch(() => {
      // Tout est déjà loggé dans la table runs, rien à faire ici
    });
  }
}

/**
 * Contexte d'exécution générique d'un workflow (défini dans actions/types.ts).
 * Ré-exporté ici pour rétro-compat des imports existants. `ExecutionPayload`
 * reste un alias interne pour limiter le diff dans le corps de l'executor.
 */
export type { ExecutionContext };
type ExecutionPayload = ExecutionContext;

/**
 * Déclencheur « changement de valeur » (C2). Appelé depuis le PATCH des lignes
 * avec le diff avant/après. Pour chaque automation `value_changed` activée de la
 * database, on évalue sa config (colonne surveillée + condition optionnelle) ;
 * si la colonne a réellement changé (et que la condition passe), on exécute.
 *
 * Fire-and-forget comme `dispatchTrigger` : on ne bloque pas la requête HTTP.
 */
export async function dispatchValueChanged(ctx: {
  databaseId: string;
  rowId: string;
  before: Record<string, unknown>;
  after: Record<string, unknown>;
}): Promise<void> {
  if (!(await automationsGloballyEnabled())) return;

  const automations = await db
    .select()
    .from(userDatabaseAutomations)
    .where(
      and(
        eq(userDatabaseAutomations.databaseId, ctx.databaseId),
        eq(userDatabaseAutomations.triggerType, "value_changed"),
        eq(userDatabaseAutomations.enabled, true)
      )
    );

  if (automations.length === 0) return;

  for (const a of automations) {
    const config = (a.triggerConfig ?? {}) as ValueChangedConfig;
    if (!shouldFireValueChanged(ctx.before, ctx.after, config)) continue;
    void executeAutomation(a as AutomationRow, {
      event: "value_changed",
      databaseId: ctx.databaseId,
      rowId: ctx.rowId,
      cells: ctx.after,
    }).catch(() => {
      // Tout est déjà loggé dans la table runs, rien à faire ici
    });
  }
}

/** Runs comptés dans le quota horaire d'organisation : tout sauf les imports. */
export function orgQuotaSourceFilter() {
  return sql`${userDatabaseAutomationRuns.source} <> 'import'`;
}

/**
 * Exécute une automation donnée. Vérifie les quotas, exécute l'action,
 * enregistre un run, met à jour last_run_at.
 */
export async function executeAutomation(
  automation: AutomationRow,
  payload: ExecutionPayload,
  opts: ExecuteOptions = {}
): Promise<{
  status: "success" | "error" | "skipped" | "partial";
  durationMs: number;
  error?: string;
  steps?: unknown;
  /** Trace détaillée par étape (rédigée, plafonnée), à persister au lot suivant. */
  trace?: TraceStep[];
  traceTruncated?: boolean;
  /** Id du run inséré dans automation_runs. */
  runId?: string;
}> {
  const startedAt = Date.now();
  const source: RunSource = opts.source ?? "trigger";
  // Contexte de déclencheur figé AVANT la marche (qui enrichit `variables`),
  // rédigé : sert au rejeu.
  const replay = snapshotTriggerContext(payload);
  const log = (
    status: "success" | "error" | "skipped" | "partial",
    durationMs: number,
    errorMessage: string | null,
    body: ExecutionPayload | Record<string, unknown>,
    extra: { steps?: TraceStep[]; traceTruncated?: boolean } = {}
  ) =>
    logRun(automation.id, status, durationMs, errorMessage, { ...body, replay }, { source, ...extra });

  // Pré-validation de l'URL webhook AVANT tout accès BDD (anti-SSRF R4)
  // Évite aussi de consommer le quota org sur une URL refusée. Uniquement pour
  // les automatisations linéaires : pour un graphe, chaque nœud webhook revalide
  // son URL à l'exécution (validateExternalUrl + assertPublicHostname).
  if (!automation.graph && automation.actionType === "webhook") {
    const cfg = (automation.actionConfig ?? {}) as { url?: string };
    if (!cfg.url) {
      const message = "URL du webhook manquante";
      const runId = await log("error", 0, message, payload);
      return { status: "error", durationMs: 0, error: message, runId };
    }
    const urlErr = validateExternalUrl(cfg.url);
    if (urlErr) {
      const message = `URL refusée : ${urlErr}`;
      const runId = await log("error", 0, message, payload);
      return { status: "error", durationMs: 0, error: message, runId };
    }
  }

  // Quota R5 — 1 / minute par automation
  if (
    !opts.skipPerAutomationQuota &&
    automation.lastRunAt &&
    Date.now() - automation.lastRunAt.getTime() < PER_AUTOMATION_MIN_INTERVAL_MS
  ) {
    const runId = await log("skipped", 0, "Quota par automation dépassé (1/min)", payload);
    return { status: "skipped", durationMs: 0, error: "rate-limited", runId };
  }

  // Quota R5 — 100 / heure par org. Résout l'org via databaseId OU spaceId :
  // sinon les workflows autonomes (databaseId null) échapperaient au quota.
  const orgId = await getOrgIdForAutomation(automation);
  if (orgId && !opts.skipOrgQuota) {
    const hourAgo = new Date(Date.now() - 3_600_000);
    // Org d'une automation = org de sa base (via spaces) OU de son espace direct.
    // Doubles left-joins aliasés pour couvrir les deux familles d'automations.
    const dbSpace = alias(spaces, "db_space");
    const directSpace = alias(spaces, "direct_space");
    const [{ value }] = await db
      .select({ value: count() })
      .from(userDatabaseAutomationRuns)
      .innerJoin(
        userDatabaseAutomations,
        eq(userDatabaseAutomations.id, userDatabaseAutomationRuns.automationId)
      )
      .leftJoin(userDatabases, eq(userDatabases.id, userDatabaseAutomations.databaseId))
      .leftJoin(dbSpace, eq(dbSpace.id, userDatabases.spaceId))
      .leftJoin(directSpace, eq(directSpace.id, userDatabaseAutomations.spaceId))
      .where(
        and(
          or(
            eq(dbSpace.organizationId, orgId),
            eq(directSpace.organizationId, orgId)
          ),
          gte(userDatabaseAutomationRuns.triggeredAt, hourAgo),
          // Les imports (Tally) ont leur plafond dédié et s'exécutent hors quota
          // d'organisation : ils ne doivent pas bloquer le reste de l'organisation.
          orgQuotaSourceFilter()
        )
      );
    if (value >= ORG_HOURLY_QUOTA) {
      const runId = await log("skipped", 0, "Quota org dépassé (100/heure)", payload);
      return { status: "skipped", durationMs: 0, error: "org-rate-limited", runId };
    }
  }

  try {
    const walked = await walkGraph(automation, payload, { mode: "real", untilNodeId: opts.untilNodeId });
    if (walked.error) {
      // Stop-on-error : la trace partielle des nœuds déjà exécutés est conservée.
      const durationMs = Date.now() - startedAt;
      const runId = await log(
        "error",
        durationMs,
        walked.error.message,
        { ...payload, nodes: walked.nodes },
        { steps: walked.trace, traceTruncated: walked.traceTruncated }
      );
      return {
        status: "error", durationMs, error: walked.error.message, runId,
        steps: walked.nodes, trace: walked.trace, traceTruncated: walked.traceTruncated,
      };
    }
    const actionResult = { ...walked.merged, nodes: walked.nodes };
    const durationMs = Date.now() - startedAt;
    // Le résultat d'action (ex. sortie IA + clé document, et la trace `nodes[]`
    // par nœud du graphe) est fusionné dans le payload du run pour être
    // consultable dans l'historique des exécutions. La trace détaillée `trace`
    // est exposée dans la valeur de retour (persistance au lot suivant).
    const partial = walked.softErrors.length > 0;
    const runId = await log(partial ? "partial" : "success", durationMs, partial ? walked.softErrors[0] : null, { ...payload, ...actionResult }, {
      steps: walked.trace, traceTruncated: walked.traceTruncated,
    });
    if (!opts.skipLastRunUpdate) {
      await db
        .update(userDatabaseAutomations)
        .set({ lastRunAt: new Date(), updatedAt: new Date() })
        .where(eq(userDatabaseAutomations.id, automation.id));
    }
    return {
      status: partial ? "partial" : "success", durationMs, runId,
      ...(partial ? { error: walked.softErrors[0] } : {}),
      steps: walked.nodes, trace: walked.trace, traceTruncated: walked.traceTruncated,
    };
  } catch (err) {
    const durationMs = Date.now() - startedAt;
    const message = err instanceof Error ? err.message : String(err);
    const runId = await log("error", durationMs, message, payload);
    return { status: "error", durationMs, error: message, runId };
  }
}

export type ExecutionMode = "real" | "simulate";

interface WalkOptions {
  mode: ExecutionMode;
  /** Arrêt après ce nœud (inclus) : les suivants sont tracés « skipped ». */
  untilNodeId?: string;
}

interface WalkResult {
  merged: Record<string, unknown>;
  /** Trace historique `nodes[]` (consignée dans le payload du run). */
  nodes: Array<Record<string, unknown>>;
  /** Trace détaillée par étape (entrées, sortie, erreur, durée), rédigée et plafonnée. */
  trace: TraceStep[];
  traceTruncated: boolean;
  error?: Error;
  /** Messages des erreurs d'étapes `continueOnError` (le run finit « partial »). */
  softErrors: string[];
}

/**
 * Marche du graphe d'actions (C5.2a). Si l'automatisation n'a pas de `graph`,
 * on synthétise un graphe à un seul nœud depuis (actionType, actionConfig) →
 * comportement linéaire historique inchangé.
 *
 * Traversée depuis l'unique nœud d'entrée : un nœud `action` exécute son action
 * et suit son arête sortante ; un nœud `condition` évalue son test sur les
 * cellules du payload et suit la branche true/false retenue. Stop-on-error : si
 * un nœud action échoue, la marche s'arrête et l'erreur est rendue avec la
 * trace partielle. Les nœuds non atteints (branche non prise, après une erreur
 * ou après `untilNodeId`) sont tracés « skipped ».
 *
 * En mode « simulate », chaque action utilise sa `simulate` (aucune écriture ni
 * appel externe) ; les lectures (`readOnly`) restent réelles.
 */
async function walkGraph(
  automation: AutomationRow,
  payload: ExecutionPayload,
  opts: WalkOptions
): Promise<WalkResult> {
  const graph: AutomationGraph =
    (automation.graph as AutomationGraph | null) ??
    synthesizeGraphFromAction(
      automation.actionType,
      automation.actionConfig as Record<string, unknown> | null
    );

  const entry = findEntryNode(graph);
  if (!entry) throw new Error("Graphe d'automatisation sans nœud d'entrée");

  const cells = payload.cells ?? {};
  const nodeResults: Array<Record<string, unknown>> = [];
  const steps: TraceStep[] = [];
  // Échantillon reçu par le déclencheur (cellules ou corps), rédigé et tronqué.
  const received: Record<string, unknown> = {};
  if (payload.rowId) received.rowId = payload.rowId;
  if (payload.cells && Object.keys(payload.cells).length > 0) received.cells = payload.cells;
  const body = payload.variables?.body;
  if (body !== undefined) received.body = body;
  steps.push({
    nodeId: TRIGGER_STEP_ID, kind: "trigger", status: "success", durationMs: 0,
    output: redact(received),
  });
  const merged: Record<string, unknown> = {};
  const visited = new Set<string>();
  let error: Error | undefined;
  // Erreurs d'étapes `continueOnError` : tracées, le graphe continue.
  const softErrors: string[] = [];

  // Variables inter-étapes : un nœud action peut stocker son résultat sous un
  // nom (node.storeAs), réutilisable par les nœuds suivants via
  // {{variables.<nom>...}}. On expose l'objet (mutable) dans le payload pour que
  // l'interpolation des actions suivantes le voie.
  const variables: Record<string, unknown> = { ...(payload.variables ?? {}) };
  payload.variables = variables;

  let currentId: string | undefined = entry.id;
  while (currentId) {
    if (visited.has(currentId)) break; // garde-fou (graphe validé acyclique)
    visited.add(currentId);
    const node = graph.nodes.find((n) => n.id === currentId);
    if (!node) break;
    const stepStart = Date.now();

    if (node.kind === "condition") {
      if (!node.condition) {
        const err = new Error(`Nœud condition incomplet : ${node.id}`);
        steps.push({
          nodeId: node.id, kind: "condition", status: "error",
          durationMs: Date.now() - stepStart, error: describeError(err),
        });
        error = err;
        break;
      }
      const result = evaluateCondition(node.condition, cells, variables);
      const branch = result ? "true" : "false";
      nodeResults.push({ id: node.id, kind: "condition", status: "success", branch });
      steps.push({
        nodeId: node.id, kind: "condition", status: "success",
        durationMs: Date.now() - stepStart,
        inputs: redact(node.condition), output: { branch },
      });
      if (node.id === opts.untilNodeId) break;
      currentId = nextNodeIds(graph, node.id, branch)[0];
      continue;
    }

    const def = node.actionType ? getAction(node.actionType) : undefined;
    // Entrées résolues AVANT l'exécution (les variables des étapes précédentes sont à jour).
    const inputs = resolveInputs(node.actionConfig ?? {}, payload);
    try {
      if (!node.actionType) throw new Error(`Nœud action sans actionType : ${node.id}`);
      // Lookup registre : type inconnu → no-op (comportement historique du
      // switch qui retombait sur un return implicite).
      const simulated = opts.mode === "simulate" && !def?.readOnly;
      const run = def ? (simulated ? def.simulate : def.execute) : undefined;
      const res = run
        ? await run((node.actionConfig ?? {}) as Record<string, unknown>, automation, payload)
        : undefined;
      if (res) Object.assign(merged, res);
      // Stocke le résultat sous la variable nommée pour les étapes suivantes.
      if (node.storeAs && res) variables[node.storeAs] = res;
      nodeResults.push({ id: node.id, kind: "action", actionType: node.actionType, status: "success" });
      steps.push({
        nodeId: node.id, kind: "action", actionType: node.actionType,
        status: simulated ? "simulated" : "success",
        durationMs: Date.now() - stepStart, inputs, output: redact(res ?? null),
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      nodeResults.push({ id: node.id, kind: "action", actionType: node.actionType, status: "error", error: message });
      steps.push({
        nodeId: node.id, kind: "action", actionType: node.actionType, status: "error",
        durationMs: Date.now() - stepStart, inputs, error: describeError(err),
      });
      if (node.continueOnError === true) {
        softErrors.push(message);
        // Sortie de l'étape = null pour les suivantes.
        if (node.storeAs) variables[node.storeAs] = null;
      } else {
        error = err instanceof Error ? err : new Error(message);
        break;
      }
    }
    if (node.id === opts.untilNodeId) break;
    currentId = nextNodeIds(graph, node.id)[0];
  }

  // Nœuds non exécutés (branche non prise, après erreur / untilNodeId).
  for (const node of graph.nodes) {
    if (visited.has(node.id) && steps.some((s) => s.nodeId === node.id)) continue;
    steps.push({
      nodeId: node.id, kind: node.kind, actionType: node.actionType,
      status: "skipped", durationMs: 0,
    });
  }

  const capped = capTrace(steps);
  return {
    merged, nodes: nodeResults, trace: capped.steps, traceTruncated: capped.truncated, error, softErrors,
  };
}

export interface AutomationTestInput {
  automation: AutomationRow;
  /** « simulate » : aucune écriture ni appel externe. « real » : exécution réelle. */
  mode: ExecutionMode;
  /** Contexte de déclencheur fourni par l'appelant (ligne choisie, corps webhook, valeurs saisies). */
  sample?: TriggerSample;
  /** Exécute le graphe jusqu'à ce nœud inclus puis s'arrête. */
  untilNodeId?: string;
  /** Utilisateur qui lance le test (alimente `{{user.*}}`). */
  actor?: { id?: string; email?: string; name?: string };
}

/** Contexte de déclencheur fourni à la main : mêmes champs que celui du moteur (cells, variables.body…). */
export type TriggerSample = Pick<
  ExecutionContext,
  "event" | "databaseId" | "rowId" | "cells" | "variables" | "spaceId" | "documentId"
>;

export interface AutomationTestResult {
  status: "success" | "error" | "partial";
  durationMs: number;
  steps: TraceStep[];
  traceTruncated: boolean;
  error?: string;
}

/** Contexte d'exécution d'un test : identité de l'automatisme, échantillon, acteur. */
export function buildTestPayload(
  automation: AutomationRow,
  sample?: TriggerSample,
  actor?: AutomationTestInput["actor"]
): ExecutionContext {
  return {
    event: (automation.triggerType as ExecutionContext["event"]) ?? "manual",
    databaseId: automation.databaseId ?? undefined,
    spaceId: automation.spaceId ?? undefined,
    ...(actor ? { user: actor } : {}),
    ...(sample ?? {}),
    variables: { ...(sample?.variables ?? {}) },
  };
}

/**
 * Entrée des routes de test du builder. N'écrit ni run, ni quota, ni `lastRunAt` :
 * le test peut viser un automatisme désactivé ou en production sans effet de bord
 * (en mode « simulate »). Le contrôle d'accès des cibles (base, espace) s'applique
 * dans les deux modes.
 */
export async function runAutomationTest(input: AutomationTestInput): Promise<AutomationTestResult> {
  const startedAt = Date.now();
  const { automation, mode, sample, untilNodeId, actor } = input;
  const payload = buildTestPayload(automation, sample, actor);
  try {
    const res = await walkGraph(automation, payload, { mode, untilNodeId });
    return {
      status: res.error ? "error" : res.softErrors.length > 0 ? "partial" : "success",
      durationMs: Date.now() - startedAt,
      steps: res.trace,
      traceTruncated: res.traceTruncated,
      error: res.error?.message ?? res.softErrors[0],
    };
  } catch (err) {
    return {
      status: "error",
      durationMs: Date.now() - startedAt,
      steps: [],
      traceTruncated: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

async function logRun(
  automationId: string,
  status: "success" | "error" | "skipped" | "partial",
  durationMs: number,
  errorMessage: string | null,
  payload: ExecutionPayload | Record<string, unknown>,
  extra: { source?: RunSource; steps?: TraceStep[]; traceTruncated?: boolean } = {}
): Promise<string> {
  const id = randomUUID();
  await db.insert(userDatabaseAutomationRuns).values({
    id,
    automationId,
    status,
    durationMs,
    errorMessage,
    payload: payload as unknown,
    steps: extra.steps ?? null,
    traceTruncated: extra.traceTruncated ?? false,
    source: extra.source ?? "trigger",
  });
  return id;
}

/**
 * Org propriétaire d'une automation, résolue via sa base (databaseId → space →
 * org) ou via son espace direct (spaceId → org) pour les workflows autonomes.
 * Retourne null si aucune cible n'est résoluble (ne devrait pas arriver vu
 * l'invariant databaseId OU spaceId).
 */
export async function getOrgIdForAutomation(automation: {
  databaseId?: string | null;
  spaceId?: string | null;
}): Promise<string | null> {
  if (automation.databaseId) {
    const [row] = await db
      .select({ organizationId: spaces.organizationId })
      .from(userDatabases)
      .innerJoin(spaces, eq(spaces.id, userDatabases.spaceId))
      .where(eq(userDatabases.id, automation.databaseId))
      .limit(1);
    if (row?.organizationId) return row.organizationId;
  }
  if (automation.spaceId) {
    const [row] = await db
      .select({ organizationId: spaces.organizationId })
      .from(spaces)
      .where(eq(spaces.id, automation.spaceId))
      .limit(1);
    return row?.organizationId ?? null;
  }
  return null;
}

/**
 * Liste les N dernières exécutions d'une automation (paginé).
 * Le siloing est validé côté route, ici on ne fait que lire.
 */
export async function listAutomationRuns(automationId: string, limit = 50) {
  return db
    .select({
      id: userDatabaseAutomationRuns.id,
      automationId: userDatabaseAutomationRuns.automationId,
      triggeredAt: userDatabaseAutomationRuns.triggeredAt,
      status: userDatabaseAutomationRuns.status,
      durationMs: userDatabaseAutomationRuns.durationMs,
      errorMessage: userDatabaseAutomationRuns.errorMessage,
      source: userDatabaseAutomationRuns.source,
      traceTruncated: userDatabaseAutomationRuns.traceTruncated,
    })
    .from(userDatabaseAutomationRuns)
    .where(eq(userDatabaseAutomationRuns.automationId, automationId))
    .orderBy(desc(userDatabaseAutomationRuns.triggeredAt))
    .limit(limit);
}

/**
 * Tick cron — appelé toutes les minutes. Trouve les automations type "cron"
 * dont la prochaine exécution prévue est dans le passé.
 *
 * Supporte une vraie expression cron (triggerConfig.cron, cf. `isCronDue` dans
 * `@/lib/automations/cron`), avec repli sur triggerConfig.intervalMin (entier
 * en minutes) pour la rétro-compat des automatisations créées avant l'ajout
 * de l'expression cron.
 *
 * Verrou anti-doublon multi-pod (R5) via pg_try_advisory_lock sur l'id
 * d'automation hashé. Si lock pas obtenu, un autre pod traite déjà.
 */
export async function tickCron(now = new Date()): Promise<{ ran: number; skipped: number }> {
  if (!(await automationsGloballyEnabled())) {
    return { ran: 0, skipped: 0 };
  }

  const candidates = await db
    .select()
    .from(userDatabaseAutomations)
    .where(
      and(
        eq(userDatabaseAutomations.triggerType, "cron"),
        eq(userDatabaseAutomations.enabled, true)
      )
    );

  let ran = 0;
  let skipped = 0;

  for (const a of candidates) {
    const cfg = (a.triggerConfig ?? {}) as { cron?: string; intervalMin?: number };
    const due = cfg.cron
      ? isCronDue(cfg.cron, a.lastRunAt, now)
      : !a.lastRunAt || now.getTime() - a.lastRunAt.getTime() >= (cfg.intervalMin ?? 60) * 60_000;
    if (!due) {
      skipped += 1;
      continue;
    }

    // Verrou Postgres advisory — hash UUID → bigint
    const lockId = uuidToBigint(a.id);
    const lockResult = await db.execute<{ acquired: boolean }>(
      sql`SELECT pg_try_advisory_lock(${lockId.toString()}::bigint) AS acquired`
    );
    const acquired = lockResult.rows?.[0]?.acquired ?? false;
    if (!acquired) {
      skipped += 1;
      continue;
    }

    try {
      await executeAutomation(a as AutomationRow, { event: "cron" });
      ran += 1;
    } finally {
      await db.execute(sql`SELECT pg_advisory_unlock(${lockId.toString()}::bigint)`);
    }
  }

  return { ran, skipped };
}

const DATE_TICK_FALLBACK_MS = 60_000;

/**
 * Tick « date atteinte » — appelé toutes les minutes en parallèle de tickCron.
 *
 * Pour chaque automation `date_reached` active, lit triggerConfig
 * `{ columnId, offsetDays?, atHour? }`, parcourt les lignes de la base et
 * déclenche l'action pour celles dont `date(cellule) + offsetDays` franchit la
 * fenêtre (lastRunAt, now]. `lastRunAt` sert de curseur de fenêtre (avancé à
 * `now` en fin de tick, qu'il y ait eu des lignes ou non), d'où le bypass du
 * quota par-automation et de la mise à jour de lastRunAt côté executeAutomation.
 *
 * Au tout premier passage (lastRunAt null), seules les échéances de la dernière
 * minute déclenchent — on ne rejoue pas l'historique des dates passées.
 *
 * Verrou advisory Postgres par automation (anti-doublon multi-pod), comme tickCron.
 */
export async function tickDateAutomations(
  now = new Date()
): Promise<{ ran: number; rows: number }> {
  if (!(await automationsGloballyEnabled())) {
    return { ran: 0, rows: 0 };
  }

  const automations = await db
    .select()
    .from(userDatabaseAutomations)
    .where(
      and(
        eq(userDatabaseAutomations.triggerType, "date_reached"),
        eq(userDatabaseAutomations.enabled, true)
      )
    );

  const nowMs = now.getTime();
  let ran = 0;
  let rowsFired = 0;

  for (const a of automations) {
    const cfg = (a.triggerConfig ?? {}) as {
      columnId?: string;
      offsetDays?: number;
      atHour?: number;
    };
    if (!cfg.columnId) continue;
    // Le déclencheur « date atteinte » est par nature base-lié : sans base, pas
    // de lignes à scruter (les workflows autonomes utilisent le trigger manuel).
    if (!a.databaseId) continue;

    const lockId = uuidToBigint(a.id);
    const lockResult = await db.execute<{ acquired: boolean }>(
      sql`SELECT pg_try_advisory_lock(${lockId.toString()}::bigint) AS acquired`
    );
    if (!(lockResult.rows as { acquired: boolean }[])[0]?.acquired) continue;

    try {
      const offsetMs = (cfg.offsetDays ?? 0) * 86_400_000;
      const prevCheckMs = a.lastRunAt ? a.lastRunAt.getTime() : nowMs - DATE_TICK_FALLBACK_MS;

      const rows = await db
        .select()
        .from(userDatabaseRows)
        .where(eq(userDatabaseRows.databaseId, a.databaseId));

      for (const row of rows) {
        const cells = (row.cells ?? {}) as Record<string, unknown>;
        const baseMs = parseCellDateMs(cells[cfg.columnId], cfg.atHour);
        if (baseMs === null) continue;
        if (!isDateRowDue(baseMs + offsetMs, prevCheckMs, nowMs)) continue;

        await executeAutomation(
          a as AutomationRow,
          { event: "date_reached", databaseId: a.databaseId, rowId: row.id, cells },
          { skipPerAutomationQuota: true, skipLastRunUpdate: true }
        );
        rowsFired += 1;
      }

      // Avance le curseur de fenêtre, qu'il y ait eu des lignes échues ou non.
      await db
        .update(userDatabaseAutomations)
        .set({ lastRunAt: now, updatedAt: now })
        .where(eq(userDatabaseAutomations.id, a.id));
      ran += 1;
    } finally {
      await db.execute(sql`SELECT pg_advisory_unlock(${lockId.toString()}::bigint)`);
    }
  }

  return { ran, rows: rowsFired };
}

/** Hash déterministe UUID → bigint (pour pg_advisory_lock). */
export function uuidToBigint(uuid: string): bigint {
  const hex = uuid.replace(/-/g, "").slice(0, 16);
  // Postgres bigint = signé 64 bits, on prend 16 hex (= 8 octets) qui peut
  // dépasser 2^63 ; on masque le bit de signe.
  const n = BigInt("0x" + hex);
  const SIGN_MASK = (BigInt(1) << BigInt(63)) - BigInt(1);
  return n & SIGN_MASK;
}
