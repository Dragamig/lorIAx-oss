import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { userDatabaseAutomations } from "@/lib/db/schema";
import { eq, and, isNull, asc } from "drizzle-orm";
import { requireOrgScoped, OrgScopeError } from "@/lib/auth/require-org-scoped";
import { canManageAutomations } from "@/lib/auth/rbac";
import { getSetting } from "@/lib/settings/system-settings";
import { validateActionConfig } from "@/lib/automations/actions/registry";
import { sanitizeWebhookTriggerConfig, redactWebhookTriggerConfig } from "@/lib/automations/webhook-inbound";
import { activationRequiresTallyForm } from "@/lib/automations/tally-activation-guard";
import { tallyFormRequiredResponse } from "@/lib/automations/tally-activation-response";
import { validateMediaTriggerConfig } from "@/lib/media/events";
import { z } from "zod";

/**
 * Routes CRUD des workflows AUTONOMES (W1) — déclencheur bouton, scoping par
 * `spaceId` (et non `databaseId`). Séparées des routes base-liées
 * `/api/databases/[id]/automations` pour ne pas fragiliser ces dernières.
 *
 * Gardes identiques : `canManageAutomations` (CRUD), kill-switch global, et
 * validation des actions via le registre — qui REJETTE les actions
 * `requiresDatabase` (create_row/update_row), sans cible hors base.
 */

// Déclencheurs supportés par les workflows autonomes : bouton manuel et
// webhook entrant (Spec 1 §5). `cron` reste hors scope de cette API pour
// l'instant.
const triggerSchema = z.enum(["manual", "webhook_inbound", "media_uploaded"]);
// Actions compatibles workflow autonome (les actions base-liées sont rejetées
// par validateActionConfig({ autonomous: true })).
const actionSchema = z.enum([
  "webhook",
  "send_email",
  "ai",
  "create_document",
  "create_task",
]);

const createSchema = z.object({
  spaceId: z.string().uuid(),
  name: z.string().min(1).max(255),
  triggerType: triggerSchema.optional(),
  triggerConfig: z.record(z.string(), z.any()).optional(),
  actionType: actionSchema,
  actionConfig: z.record(z.string(), z.any()).optional(),
  enabled: z.boolean().optional(),
});

export async function GET(request: Request) {
  const spaceId = new URL(request.url).searchParams.get("spaceId");
  if (!spaceId) {
    return NextResponse.json({ error: "spaceId requis" }, { status: 400 });
  }
  let ctx;
  try {
    ctx = await requireOrgScoped({ resource: { type: "space", id: spaceId }, minPermission: "viewer" });
  } catch (e) {
    if (e instanceof OrgScopeError) return e.response;
    throw e;
  }

  // Workflows autonomes de l'espace : databaseId null, spaceId = espace courant.
  const list = await db
    .select()
    .from(userDatabaseAutomations)
    .where(
      and(
        eq(userDatabaseAutomations.spaceId, spaceId),
        isNull(userDatabaseAutomations.databaseId)
      )
    )
    .orderBy(asc(userDatabaseAutomations.createdAt));

  // Jeton, secret et dernier corps reçu : réservés à qui peut gérer les automatisations.
  const canManage = canManageAutomations(ctx.user.globalRole, ctx.user.capabilities);
  return NextResponse.json(canManage ? list : list.map(redactWebhookTriggerConfig));
}

export async function POST(request: Request) {
  const body = await request.json();
  const parsed = createSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0].message }, { status: 400 });
  }

  let ctx;
  try {
    ctx = await requireOrgScoped({
      resource: { type: "space", id: parsed.data.spaceId },
      minPermission: "editor",
    });
  } catch (e) {
    if (e instanceof OrgScopeError) return e.response;
    throw e;
  }

  // Garde rôle : seuls admin / super_admin / automation_manager configurent.
  if (!canManageAutomations(ctx.user.globalRole, ctx.user.capabilities)) {
    return NextResponse.json(
      { error: "Vous n'avez pas le rôle requis pour créer un workflow" },
      { status: 403 }
    );
  }

  // Kill-switch global, cohérent avec les routes base-liées.
  const automationsCfg = await getSetting<{ enabled?: boolean }>("automations");
  if (automationsCfg && automationsCfg.enabled === false) {
    return NextResponse.json(
      { error: "Les automatisations sont désactivées globalement par l'administrateur" },
      { status: 403 }
    );
  }

  // Validation de l'action via le registre (mutualisée) — rejette les actions
  // base-liées (requiresDatabase) en contexte autonome.
  const cfgErr = validateActionConfig(
    parsed.data.actionType,
    (parsed.data.actionConfig ?? {}) as Record<string, unknown>,
    { autonomous: true }
  );
  if (cfgErr) {
    return NextResponse.json({ error: cfgErr }, { status: 400 });
  }

  const triggerType = parsed.data.triggerType ?? "manual";
  let triggerConfig = parsed.data.triggerConfig ?? {};
  // Webhook entrant : le token/secret sont TOUJOURS régénérés côté serveur
  // (entropie garantie ≥128 bits) — tout token/secret fourni par le client
  // est ignoré, sinon un créateur authentifié pourrait imposer un token
  // faible/devinable et exposer un webhook public à un tiers non authentifié.
  if (triggerType === "webhook_inbound") {
    triggerConfig = sanitizeWebhookTriggerConfig(triggerConfig);
  }

  if (triggerType === "media_uploaded") {
    const checked = await validateMediaTriggerConfig(triggerConfig, { userId: ctx.user.id, orgId: ctx.orgId });
    if (!checked.ok) return NextResponse.json({ error: checked.error }, { status: 400 });
    triggerConfig = checked.config;
  }

  if (activationRequiresTallyForm(null, { enabled: parsed.data.enabled ?? true, triggerType: triggerType, triggerConfig })) {
    return tallyFormRequiredResponse();
  }

  const [created] = await db
    .insert(userDatabaseAutomations)
    .values({
      databaseId: null,
      spaceId: parsed.data.spaceId,
      name: parsed.data.name,
      triggerType,
      triggerConfig,
      actionType: parsed.data.actionType,
      actionConfig: parsed.data.actionConfig ?? {},
      enabled: parsed.data.enabled ?? true,
      createdBy: ctx.user.id,
    })
    .returning();

  return NextResponse.json(created, { status: 201 });
}
