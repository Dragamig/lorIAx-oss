import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { userDatabaseAutomations } from "@/lib/db/schema";
import { eq, and, isNull } from "drizzle-orm";
import { requireOrgScoped, OrgScopeError } from "@/lib/auth/require-org-scoped";
import { canManageAutomations } from "@/lib/auth/rbac";
import { getSetting } from "@/lib/settings/system-settings";
import { validateActionConfig } from "@/lib/automations/actions/registry";
import { validateGraph, type AutomationGraph } from "@/lib/automations/automation-graph";
import { resolvePatchedTriggerConfig } from "@/lib/automations/webhook-inbound";
import { activationRequiresTallyForm } from "@/lib/automations/tally-activation-guard";
import { tallyFormRequiredResponse } from "@/lib/automations/tally-activation-response";
import { validateMediaTriggerConfig } from "@/lib/media/events";
import { z } from "zod";

type RouteParams = { params: Promise<{ automationId: string }> };

// `actionType` volontairement absent : pas de changement de type via PATCH
// (cohérent avec les routes base-liées).
// `triggerType` : manual/webhook_inbound seulement — cron reste hors scope
// des workflows autonomes (cf. POST ci-dessus). Modifiable via le panneau
// no-code du canevas (Task 8).
const triggerSchema = z.enum(["manual", "webhook_inbound", "media_uploaded"]);
const updateSchema = z.object({
  name: z.string().min(1).max(255).optional(),
  triggerType: triggerSchema.optional(),
  triggerConfig: z.record(z.string(), z.any()).optional(),
  actionConfig: z.record(z.string(), z.any()).optional(),
  graph: z.any().optional(),
  enabled: z.boolean().optional(),
  // Drapeau UI (jamais persisté) : demande une régénération serveur du
  // token/secret webhook (bouton « Régénérer », Task 8). Le token n'est
  // JAMAIS accepté depuis le client — cf. sanitizeWebhookTriggerConfig.
  regenerateWebhookToken: z.boolean().optional(),
});

/**
 * Charge un workflow autonome (databaseId null) et vérifie l'accès à son espace.
 * Retourne soit `{ automation, ctx }`, soit `{ error }` (NextResponse) à renvoyer.
 */
async function loadAutonomous(automationId: string, minPermission: "editor") {
  const [automation] = await db
    .select()
    .from(userDatabaseAutomations)
    .where(
      and(
        eq(userDatabaseAutomations.id, automationId),
        isNull(userDatabaseAutomations.databaseId)
      )
    )
    .limit(1);
  if (!automation || !automation.spaceId) {
    return { error: NextResponse.json({ error: "Introuvable" }, { status: 404 }) };
  }
  try {
    const ctx = await requireOrgScoped({
      resource: { type: "space", id: automation.spaceId },
      minPermission,
    });
    return { automation, ctx };
  } catch (e) {
    if (e instanceof OrgScopeError) return { error: e.response };
    throw e;
  }
}

export async function PATCH(request: Request, { params }: RouteParams) {
  const { automationId } = await params;
  const loaded = await loadAutonomous(automationId, "editor");
  if ("error" in loaded) return loaded.error;
  const { automation, ctx } = loaded;

  if (!canManageAutomations(ctx.user.globalRole, ctx.user.capabilities)) {
    return NextResponse.json(
      { error: "Vous n'avez pas le rôle requis pour modifier un workflow" },
      { status: 403 }
    );
  }

  const body = await request.json();
  const parsed = updateSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0].message }, { status: 400 });
  }

  // Activation d'un automatisme Tally sans formulaire choisi : refusée.
  if (activationRequiresTallyForm(automation, parsed.data)) return tallyFormRequiredResponse();

  // Kill-switch global (cohérent avec POST/PATCH base-liés).
  const automationsCfg = await getSetting<{ enabled?: boolean }>("automations");
  if (automationsCfg && automationsCfg.enabled === false) {
    return NextResponse.json(
      { error: "Les automatisations sont désactivées globalement par l'administrateur" },
      { status: 403 }
    );
  }

  // Revalidation de la config selon le type d'action existant (registre, autonome).
  if (parsed.data.actionConfig) {
    const err = validateActionConfig(
      automation.actionType,
      parsed.data.actionConfig as Record<string, unknown>,
      { autonomous: true }
    );
    if (err) return NextResponse.json({ error: err }, { status: 400 });
  }

  // Graphe : structure + config de chaque nœud action (mêmes gardes, autonome).
  if (parsed.data.graph !== undefined) {
    const graph = parsed.data.graph as AutomationGraph;
    const structure = validateGraph(graph);
    if (!structure.ok) {
      return NextResponse.json({ error: `Graphe invalide : ${structure.error}` }, { status: 400 });
    }
    for (const node of graph.nodes) {
      if (node.kind === "action" && node.actionType) {
        const err = validateActionConfig(
          node.actionType,
          (node.actionConfig ?? {}) as Record<string, unknown>,
          { autonomous: true }
        );
        if (err) {
          return NextResponse.json({ error: `Nœud « ${node.id} » : ${err}` }, { status: 400 });
        }
      }
    }
  }

  // Webhook entrant : le client ne doit jamais pouvoir imposer un token/secret
  // via PATCH (même faille qu'à la création). On ignore tout token/secret
  // fourni. Le token est régénéré (entropie serveur garantie) lorsque :
  // - le déclencheur bascule vers webhook_inbound (il n'en avait pas encore),
  // - aucun token n'existe encore en base,
  // - le client demande explicitement une régénération (bouton « Régénérer »).
  // Sinon (édition non liée au webhook), le token/secret déjà en base sont conservés.
  const { regenerateWebhookToken, ...rest } = parsed.data;
  const updateData: typeof rest = { ...rest };
  const patchedConfig = resolvePatchedTriggerConfig({
    currentTriggerType: automation.triggerType,
    currentConfig: automation.triggerConfig,
    nextTriggerType: rest.triggerType,
    clientConfig: rest.triggerConfig,
    regenerate: regenerateWebhookToken,
  });
  if (patchedConfig !== undefined) updateData.triggerConfig = patchedConfig;

  // Déclencheur « média ajouté » : portée validée contre l'organisation et l'accès de l'acteur.
  const nextTriggerType = rest.triggerType ?? automation.triggerType;
  if (nextTriggerType === "media_uploaded" && (rest.triggerType !== undefined || rest.triggerConfig !== undefined)) {
    const checked = await validateMediaTriggerConfig(
      rest.triggerConfig ?? (rest.triggerType !== automation.triggerType ? {} : automation.triggerConfig),
      { userId: ctx.user.id, orgId: ctx.orgId }
    );
    if (!checked.ok) return NextResponse.json({ error: checked.error }, { status: 400 });
    updateData.triggerConfig = checked.config;
  }

  const [updated] = await db
    .update(userDatabaseAutomations)
    .set({ ...updateData, updatedAt: new Date() })
    .where(eq(userDatabaseAutomations.id, automationId))
    .returning();

  if (!updated) return NextResponse.json({ error: 'Automation not found' }, { status: 404 });

  return NextResponse.json(updated);
}

export async function DELETE(_request: Request, { params }: RouteParams) {
  const { automationId } = await params;
  const loaded = await loadAutonomous(automationId, "editor");
  if ("error" in loaded) return loaded.error;
  const { ctx } = loaded;

  if (!canManageAutomations(ctx.user.globalRole, ctx.user.capabilities)) {
    return NextResponse.json(
      { error: "Vous n'avez pas le rôle requis pour supprimer un workflow" },
      { status: 403 }
    );
  }

  await db.delete(userDatabaseAutomations).where(eq(userDatabaseAutomations.id, automationId));

  return NextResponse.json({ ok: true });
}
