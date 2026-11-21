import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { userDatabaseAutomations } from "@/lib/db/schema";
import { eq, and } from "drizzle-orm";
import { requireOrgScoped, OrgScopeError } from "@/lib/auth/require-org-scoped";
import { canManageAutomations } from "@/lib/auth/rbac";
import { getSetting } from "@/lib/settings/system-settings";
import { validateGraph, type AutomationGraph } from "@/lib/automations/automation-graph";
import { validateActionConfig } from "@/lib/automations/actions/registry";
import { resolvePatchedTriggerConfig } from "@/lib/automations/webhook-inbound";
import { validateValueChangedConfig } from "@/lib/automations/value-changed";
import { z } from "zod";

type RouteParams = { params: Promise<{ databaseId: string; automationId: string }> };

// `actionType` est volontairement absent : on n'autorise pas le changement
// du type d'action via PATCH. Tout ajout futur de ce champ DOIT être
// accompagné des contrôles SSRF/email correspondants ci-dessous.
// `triggerType` : périmètre identique au POST (déclencheurs base-liés
// et webhook_inbound). Modifiable via le panneau
// no-code du canevas (Task 8) ; n'affecte pas databaseId (édition non supportée).
const triggerSchema = z.enum([
  "row_created", "row_updated", "row_deleted", "cron", "date_reached", "value_changed",
  "webhook_inbound",
]);
const updateSchema = z.object({
  name: z.string().min(1).max(255).optional(),
  triggerType: triggerSchema.optional(),
  triggerConfig: z.record(z.string(), z.any()).optional(),
  actionConfig: z.record(z.string(), z.any()).optional(),
  // Graphe d'actions multi-nœuds (C5.2b). Validé en profondeur ci-dessous :
  // structure (validateGraph) + config de chaque nœud action (mêmes gardes
  // SSRF/email/IA/cells que actionConfig), sinon le graphe contournerait la
  // sécurité appliquée aux automatisations linéaires.
  graph: z.any().optional(),
  enabled: z.boolean().optional(),
  // Drapeau UI (jamais persisté) : régénération serveur du jeton/secret.
  regenerateWebhookToken: z.boolean().optional(),
});

export async function PATCH(request: Request, { params }: RouteParams) {
  const { databaseId, automationId } = await params;
  let ctx;
  try {
    ctx = await requireOrgScoped({
      resource: { type: "database", id: databaseId },
      minPermission: "editor",
    });
  } catch (e) {
    if (e instanceof OrgScopeError) return e.response;
    throw e;
  }

  // Même garde rôle qu'à la création (POST /automations) : un editor ne peut
  // pas réécrire l'URL d'un webhook créé par un automation_manager/admin et
  // ainsi contourner les validations SSRF / la politique de l'org.
  if (!canManageAutomations(ctx.user.globalRole, ctx.user.capabilities)) {
    return NextResponse.json(
      { error: "Vous n'avez pas le rôle requis pour modifier une automatisation" },
      { status: 403 }
    );
  }

  // Garde-fou : l'automation doit appartenir à cette database
  const [existing] = await db
    .select()
    .from(userDatabaseAutomations)
    .where(
      and(
        eq(userDatabaseAutomations.id, automationId),
        eq(userDatabaseAutomations.databaseId, databaseId)
      )
    )
    .limit(1);
  if (!existing) {
    return NextResponse.json({ error: "Introuvable" }, { status: 404 });
  }

  const body = await request.json();
  const parsed = updateSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0].message }, { status: 400 });
  }

  // Kill-switch global : si désactivé, refuser la modification (cohérent avec POST).
  // Sans ce contrôle, un automation_manager pouvait pivoter l'URL webhook ou
  // le destinataire d'un send_email pendant la coupure annoncée par l'admin.
  const automationsCfg = await getSetting<{ enabled?: boolean }>("automations");
  if (automationsCfg && automationsCfg.enabled === false) {
    return NextResponse.json(
      { error: "Les automatisations sont désactivées globalement par l'administrateur" },
      { status: 403 }
    );
  }

  // Si on patche actionConfig, revalider selon le type d'action existant.
  if (parsed.data.actionConfig) {
    const cfg = parsed.data.actionConfig as Record<string, unknown>;
    const err = validateActionConfig(existing.actionType, cfg);
    if (err) {
      return NextResponse.json({ error: err }, { status: 400 });
    }
  }

  // Déclencheur « changement de valeur » : `is_me` refusé (pas d'utilisateur courant).
  // Seulement si le PATCH touche au déclencheur : désactiver une automatisation
  // existante dont la config stockée contient is_me reste possible.
  if (
    (parsed.data.triggerType !== undefined || parsed.data.triggerConfig !== undefined) &&
    (parsed.data.triggerType ?? existing.triggerType) === "value_changed"
  ) {
    const trigErr = validateValueChangedConfig(parsed.data.triggerConfig ?? existing.triggerConfig);
    if (trigErr) return NextResponse.json({ error: trigErr }, { status: 400 });
  }

  // Si on patche le graphe (C5.2b) : structure + config de chaque nœud action.
  if (parsed.data.graph !== undefined) {
    const graph = parsed.data.graph as AutomationGraph;
    const structure = validateGraph(graph);
    if (!structure.ok) {
      return NextResponse.json(
        { error: `Graphe invalide : ${structure.error}` },
        { status: 400 }
      );
    }
    for (const node of graph.nodes) {
      if (node.kind === "action" && node.actionType) {
        const err = validateActionConfig(
          node.actionType,
          (node.actionConfig ?? {}) as Record<string, unknown>
        );
        if (err) {
          return NextResponse.json(
            { error: `Nœud « ${node.id} » : ${err}` },
            { status: 400 }
          );
        }
      }
    }
  }

  const { regenerateWebhookToken, ...patch } = parsed.data;
  const patchedConfig = resolvePatchedTriggerConfig({
    currentTriggerType: existing.triggerType,
    currentConfig: existing.triggerConfig,
    nextTriggerType: patch.triggerType,
    clientConfig: patch.triggerConfig,
    regenerate: regenerateWebhookToken,
  });
  const updateData: typeof patch = { ...patch };
  if (patchedConfig !== undefined) updateData.triggerConfig = patchedConfig;

  const [updated] = await db
    .update(userDatabaseAutomations)
    .set({ ...updateData, updatedAt: new Date() })
    .where(eq(userDatabaseAutomations.id, automationId))
    .returning();

  if (!updated) {
    return NextResponse.json({ error: 'Update failed' }, { status: 500 });
  }

  return NextResponse.json(updated);
}

export async function DELETE(_request: Request, { params }: RouteParams) {
  const { databaseId, automationId } = await params;
  let ctx;
  try {
    ctx = await requireOrgScoped({
      resource: { type: "database", id: databaseId },
      minPermission: "editor",
    });
  } catch (e) {
    if (e instanceof OrgScopeError) return e.response;
    throw e;
  }

  if (!canManageAutomations(ctx.user.globalRole, ctx.user.capabilities)) {
    return NextResponse.json(
      { error: "Vous n'avez pas le rôle requis pour supprimer une automatisation" },
      { status: 403 }
    );
  }

  const [existing] = await db
    .select()
    .from(userDatabaseAutomations)
    .where(
      and(
        eq(userDatabaseAutomations.id, automationId),
        eq(userDatabaseAutomations.databaseId, databaseId)
      )
    )
    .limit(1);
  if (!existing) {
    return NextResponse.json({ error: "Introuvable" }, { status: 404 });
  }

  await db.delete(userDatabaseAutomations).where(eq(userDatabaseAutomations.id, automationId));

  return NextResponse.json({ ok: true });
}
