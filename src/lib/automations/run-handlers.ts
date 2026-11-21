/**
 * Logique commune aux routes de test, de détail et de rejeu des deux familles
 * d'automatismes (base-liée et autonome). L'authentification, le cloisonnement
 * d'organisation et le droit de gestion sont à la charge de la route appelante,
 * qui ne délègue qu'une fois l'automatisme résolu et l'accès vérifié.
 */
import { NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/lib/db";
import { userDatabaseAutomationRuns, userDatabaseRows } from "@/lib/db/schema";
import { getSetting } from "@/lib/settings/system-settings";
import { checkRateLimitAsync } from "@/lib/rate-limit";
import {
  buildTestPayload,
  getOrgIdForAutomation,
  executeAutomation,
  runAutomationTest,
  type TriggerSample,
} from "@/lib/automations/executor";
import { buildWebhookPayload } from "@/lib/automations/webhook-inbound";
import { replayContextFromPayload } from "@/lib/automations/replay-context";
import type { AutomationRow } from "@/lib/automations/actions/types";

/** Test simulé : sans écriture, mais il lit des lignes et sollicite le moteur. */
const SIMULATION_LIMIT = { maxRequests: 30, windowMs: 60_000 };

/**
 * Rejeu : effets réels, et la suppression de l'original le rend invisible au
 * quota d'organisation (le compte reste constant). Trois plafonds explicites
 * ferment la boucle : par acteur et automatisme, par automatisme, par organisation.
 */
const REPLAY_ACTOR_LIMIT = { maxRequests: 6, windowMs: 60_000 };
const REPLAY_AUTOMATION_LIMIT = { maxRequests: 30, windowMs: 3_600_000 };
const REPLAY_ORG_LIMIT = { maxRequests: 100, windowMs: 3_600_000 };

const testSchema = z.object({
  mode: z.enum(["simulate", "real"]),
  untilNodeId: z.string().min(1).max(200).optional(),
  sample: z.discriminatedUnion("kind", [
    z.object({ kind: z.literal("lastReceived") }),
    z.object({ kind: z.literal("row"), rowId: z.string().uuid() }),
    z.object({
      kind: z.literal("values"),
      cells: z.record(z.string(), z.unknown()).optional(),
      body: z.unknown().optional(),
    }),
  ]),
});

type Actor = { id: string; email?: string | null; name?: string | null };

const notFound = () => NextResponse.json({ error: "Introuvable" }, { status: 404 });

async function resolveSample(
  automation: AutomationRow,
  sample: z.infer<typeof testSchema>["sample"]
): Promise<{ sample: TriggerSample } | { error: NextResponse }> {
  if (sample.kind === "values") {
    return {
      sample: {
        ...(sample.cells ? { cells: sample.cells } : {}),
        ...(sample.body !== undefined ? buildWebhookPayload(sample.body) : {}),
      },
    };
  }
  if (sample.kind === "lastReceived") {
    const last = ((automation.triggerConfig ?? {}) as { lastReceived?: { body?: unknown } })
      .lastReceived;
    if (!last || last.body === undefined || last.body === null) {
      return {
        error: NextResponse.json({ error: "Aucun corps reçu à rejouer" }, { status: 409 }),
      };
    }
    return { sample: buildWebhookPayload(last.body) };
  }
  // row : la ligne doit appartenir à la base de l'automatisme.
  if (!automation.databaseId) {
    return { error: NextResponse.json({ error: "Cet automatisme n'est lié à aucune base" }, { status: 400 }) };
  }
  const [row] = await db
    .select({ id: userDatabaseRows.id, cells: userDatabaseRows.cells })
    .from(userDatabaseRows)
    .where(
      and(
        eq(userDatabaseRows.id, sample.rowId),
        eq(userDatabaseRows.databaseId, automation.databaseId)
      )
    )
    .limit(1);
  if (!row) return { error: notFound() };
  return {
    sample: {
      rowId: row.id,
      cells: (row.cells ?? {}) as Record<string, unknown>,
    },
  };
}

/** POST …/test : exécution simulée (rien en base) ou réelle (run `source: test`). */
export async function handleAutomationTest(
  request: Request,
  automation: AutomationRow,
  actor: Actor
): Promise<NextResponse> {
  const raw = await request.json().catch(() => null);
  const parsed = testSchema.safeParse(raw);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0].message }, { status: 400 });
  }
  const { mode, untilNodeId } = parsed.data;

  if (mode === "real") {
    const cfg = await getSetting<{ enabled?: boolean }>("automations");
    if (cfg && cfg.enabled === false) {
      return NextResponse.json(
        { error: "Les automatisations sont désactivées globalement par l'administrateur" },
        { status: 403 }
      );
    }
  } else {
    const limit = await checkRateLimitAsync(`automation-test-sim:${actor.id}`, SIMULATION_LIMIT);
    if (!limit.success) {
      return NextResponse.json({ error: "Trop de tests, réessayez dans un instant" }, { status: 429 });
    }
  }

  const resolved = await resolveSample(automation, parsed.data.sample);
  if ("error" in resolved) return resolved.error;
  const user = { id: actor.id, email: actor.email ?? undefined, name: actor.name ?? undefined };

  if (mode === "simulate") {
    const result = await runAutomationTest({
      automation, mode, sample: resolved.sample, untilNodeId, actor: user,
    });
    return NextResponse.json({ mode, ...result });
  }

  // Réel : mêmes quotas qu'une exécution normale, mais lastRunAt reste intact et
  // l'automatisme peut être désactivé. Un run `source: test` est persisté.
  const result = await executeAutomation(
    automation,
    buildTestPayload(automation, resolved.sample, user),
    { source: "test", skipLastRunUpdate: true, untilNodeId }
  );
  if (result.status === "skipped") {
    return NextResponse.json({ error: "Quota d'exécutions atteint", runId: result.runId }, { status: 429 });
  }
  return NextResponse.json({
    mode,
    status: result.status,
    durationMs: result.durationMs,
    steps: result.trace ?? [],
    traceTruncated: result.traceTruncated ?? false,
    error: result.error,
    runId: result.runId,
  });
}

/** GET …/runs/[runId] : détail d'un run avec sa trace. */
export async function handleRunDetail(automationId: string, runId: string): Promise<NextResponse> {
  const [run] = await db
    .select()
    .from(userDatabaseAutomationRuns)
    .where(
      and(
        eq(userDatabaseAutomationRuns.id, runId),
        eq(userDatabaseAutomationRuns.automationId, automationId)
      )
    )
    .limit(1);
  if (!run) return notFound();
  return NextResponse.json(publicRun(run));
}

/** Vue publique d'un run : jamais le `payload` brut (corps webhook, cellules, e-mail). */
export function publicRun(run: {
  id: string;
  automationId: string;
  triggeredAt: Date;
  status: string;
  durationMs: number | null;
  errorMessage: string | null;
  steps: unknown;
  traceTruncated: boolean;
  source: string;
}) {
  return {
    id: run.id,
    automationId: run.automationId,
    triggeredAt: run.triggeredAt,
    status: run.status,
    durationMs: run.durationMs,
    errorMessage: run.errorMessage,
    steps: run.steps,
    traceTruncated: run.traceTruncated,
    source: run.source,
  };
}

/**
 * POST …/runs/[runId]/replay : réexécute réellement avec le contexte du run,
 * persiste un run `source: replay`, puis supprime l'original. L'original n'est
 * supprimé qu'une fois le nouveau run inséré et réellement exécuté.
 */
export async function handleRunReplay(
  automation: AutomationRow,
  runId: string,
  actorId: string
): Promise<NextResponse> {
  const [run] = await db
    .select({ id: userDatabaseAutomationRuns.id, payload: userDatabaseAutomationRuns.payload })
    .from(userDatabaseAutomationRuns)
    .where(
      and(
        eq(userDatabaseAutomationRuns.id, runId),
        eq(userDatabaseAutomationRuns.automationId, automation.id)
      )
    )
    .limit(1);
  if (!run) return notFound();

  const context = replayContextFromPayload(run.payload);
  if (!context) {
    return NextResponse.json({ error: "Ce run ne conserve pas de contexte rejouable" }, { status: 409 });
  }

  const cfg = await getSetting<{ enabled?: boolean }>("automations");
  if (cfg && cfg.enabled === false) {
    return NextResponse.json(
      { error: "Les automatisations sont désactivées globalement par l'administrateur" },
      { status: 403 }
    );
  }

  const orgId = await getOrgIdForAutomation(automation);
  const checks = [
    await checkRateLimitAsync(`automation-replay:${actorId}:${automation.id}`, REPLAY_ACTOR_LIMIT),
    await checkRateLimitAsync(`automation-replay-auto:${automation.id}`, REPLAY_AUTOMATION_LIMIT),
    orgId
      ? await checkRateLimitAsync(`automation-replay-org:${orgId}`, REPLAY_ORG_LIMIT)
      : { success: true },
  ];
  if (checks.some((c) => !c.success)) {
    return NextResponse.json({ error: "Trop de rejeux, réessayez dans un instant" }, { status: 429 });
  }

  const result = await executeAutomation(automation, context, {
    source: "replay",
    skipPerAutomationQuota: true,
    skipLastRunUpdate: true,
  });

  if (!result.runId) {
    return NextResponse.json({ error: "Rejeu impossible", detail: result.error }, { status: 500 });
  }
  if (result.status === "skipped") {
    // Rien n'a été exécuté : on retire la trace du refus et on garde l'original.
    await db
      .delete(userDatabaseAutomationRuns)
      .where(eq(userDatabaseAutomationRuns.id, result.runId));
    return NextResponse.json({ error: "Quota d'exécutions atteint" }, { status: 429 });
  }

  await db
    .delete(userDatabaseAutomationRuns)
    .where(
      and(
        eq(userDatabaseAutomationRuns.id, run.id),
        eq(userDatabaseAutomationRuns.automationId, automation.id)
      )
    );

  const [created] = await db
    .select()
    .from(userDatabaseAutomationRuns)
    .where(eq(userDatabaseAutomationRuns.id, result.runId))
    .limit(1);
  return NextResponse.json(
    created ? publicRun(created) : { id: result.runId, status: result.status }
  );
}
