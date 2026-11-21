import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { userDatabaseAutomations } from "@/lib/db/schema";
import { eq, asc } from "drizzle-orm";
import { requireOrgScoped, OrgScopeError } from "@/lib/auth/require-org-scoped";
import { canManageAutomations } from "@/lib/auth/rbac";
import { getSetting } from "@/lib/settings/system-settings";
import { validateActionConfig } from "@/lib/automations/actions/registry";
import { sanitizeWebhookTriggerConfig, redactWebhookTriggerConfig } from "@/lib/automations/webhook-inbound";
import { validateValueChangedConfig } from "@/lib/automations/value-changed";
import { z } from "zod";

type RouteParams = { params: Promise<{ databaseId: string }> };

const triggerSchema = z.enum([
  "row_created", "row_updated", "row_deleted", "cron", "date_reached", "value_changed",
  "webhook_inbound",
]);
// Périmètre unifié avec le registre d'actions (source unique de vérité) :
// toutes les actions câblées dans l'executor sont autorisées, y compris
// notify_user/create_document/create_task. Contexte base-lié (pas
// `autonomous`) : create_row/update_row restent aussi permises.
const actionSchema = z.enum([
  "webhook", "send_email", "ai", "create_row", "update_row",
  "notify_user", "create_document", "create_task",
]);

const createSchema = z.object({
  name: z.string().min(1).max(255),
  triggerType: triggerSchema,
  triggerConfig: z.record(z.string(), z.any()).optional(),
  actionType: actionSchema,
  actionConfig: z.record(z.string(), z.any()).optional(),
  enabled: z.boolean().optional(),
});

export async function GET(_request: Request, { params }: RouteParams) {
  const { databaseId } = await params;
  let ctx;
  try {
    ctx = await requireOrgScoped({ resource: { type: "database", id: databaseId }, minPermission: "viewer" });
  } catch (e) {
    if (e instanceof OrgScopeError) return e.response;
    throw e;
  }

  const list = await db
    .select()
    .from(userDatabaseAutomations)
    .where(eq(userDatabaseAutomations.databaseId, databaseId))
    .orderBy(asc(userDatabaseAutomations.createdAt));

  // Jeton, secret et dernier corps reçu : réservés à qui peut gérer les automatisations.
  const canManage = canManageAutomations(ctx.user.globalRole, ctx.user.capabilities);
  return NextResponse.json(canManage ? list : list.map(redactWebhookTriggerConfig));
}

export async function POST(request: Request, { params }: RouteParams) {
  const { databaseId } = await params;
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

  // Garde rôle : seuls admin / super_admin / automation_manager peuvent créer
  // des automatisations. Le rôle editor ne suffit plus depuis v1.39.0.
  if (!canManageAutomations(ctx.user.globalRole, ctx.user.capabilities)) {
    return NextResponse.json(
      { error: "Vous n'avez pas le rôle requis pour créer une automatisation" },
      { status: 403 }
    );
  }

  // Toggle global : si désactivé, refuser la création (cohérent avec executor).
  const automationsCfg = await getSetting<{ enabled?: boolean }>("automations");
  if (automationsCfg && automationsCfg.enabled === false) {
    return NextResponse.json(
      { error: "Les automatisations sont désactivées globalement par l'administrateur" },
      { status: 403 }
    );
  }

  const body = await request.json();
  const parsed = createSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0].message }, { status: 400 });
  }

  // Validation de la config d'action selon son type — même invariant que le
  // PATCH (source unique : validateActionConfig). Inclut l'anti-SSRF webhook
  // (R4, l'URL est aussi re-vérifiée à l'exécution) et les bornes de taille.
  const cfgErr = validateActionConfig(
    parsed.data.actionType,
    (parsed.data.actionConfig ?? {}) as Record<string, unknown>
  );
  if (cfgErr) {
    return NextResponse.json({ error: cfgErr }, { status: 400 });
  }

  let triggerConfig = (parsed.data.triggerConfig ?? {}) as Record<string, unknown>;
  if (parsed.data.triggerType === "value_changed") {
    const trigErr = validateValueChangedConfig(triggerConfig);
    if (trigErr) return NextResponse.json({ error: trigErr }, { status: 400 });
  }
  // Webhook entrant : jeton/secret toujours générés côté serveur.
  if (parsed.data.triggerType === "webhook_inbound") {
    triggerConfig = sanitizeWebhookTriggerConfig(triggerConfig);
  }

  const [created] = await db
    .insert(userDatabaseAutomations)
    .values({
      databaseId,
      name: parsed.data.name,
      triggerType: parsed.data.triggerType,
      triggerConfig,
      actionType: parsed.data.actionType,
      actionConfig: parsed.data.actionConfig ?? {},
      enabled: parsed.data.enabled ?? true,
      createdBy: ctx.user.id,
    })
    .returning();

  return NextResponse.json(created, { status: 201 });
}
