import { db } from "@/lib/db";
import { webhooks, webhookDeliveries } from "@/lib/db/schema";
import { eq, and, desc } from "drizzle-orm";
import { authenticateApiRequest, requireScope } from "@/lib/api/auth-api";
import { apiSuccess, apiError } from "@/lib/api/response";
import { z } from "zod";
import { externalUrlSchema } from "@/lib/security/url-schema";

const WEBHOOK_EVENTS = [
  "document.created",
  "document.updated",
  "document.deleted",
  "comment.created",
  "comment.resolved",
  "space.member_added",
  "space.member_removed",
  "mention.created",
] as const;

/**
 * Construit le schéma de mise à jour à chaque appel plutôt qu'au chargement
 * du module : `WEBHOOK_ALLOW_PRIVATE_TARGETS` doit être relue à chaque
 * requête (cf. commentaire dans `dispatch.ts` et `route.ts` du même dossier).
 * Absente, `externalUrlSchema()` garde son comportement par défaut : refus
 * des adresses privées.
 */
function buildUpdateSchema() {
  return z.object({
    url: externalUrlSchema(2048, {
      allowPrivateTargets: process.env.WEBHOOK_ALLOW_PRIVATE_TARGETS === "true",
    }).optional(),
    events: z.array(z.enum(WEBHOOK_EVENTS as unknown as [string, ...string[]])).min(1).optional(),
    active: z.boolean().optional(),
  });
}

/**
 * GET /api/v1/webhooks/:id — Get webhook details + recent deliveries.
 */
export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const auth = await authenticateApiRequest(request);
  if ("error" in auth) return auth.error;

  const scopeErr = requireScope(auth.user, "webhooks");
  if (scopeErr) return scopeErr;

  const [webhook] = await db
    .select()
    .from(webhooks)
    .where(
      and(
        eq(webhooks.id, id),
        eq(webhooks.userId, auth.user.id),
        // Cloisonnement par organisation : un même compte peut être membre de
        // plusieurs organisations, le seul `userId` laisserait voir depuis
        // l'une les webhooks créés dans l'autre (constat du lot 6).
        eq(webhooks.organizationId, auth.user.orgId)
      )
    )
    .limit(1);

  if (!webhook) return apiError("Webhook introuvable", 404);

  const { secret: _secret, ...webhookData } = webhook;

  // Recent deliveries
  const deliveries = await db
    .select({
      id: webhookDeliveries.id,
      eventType: webhookDeliveries.eventType,
      statusCode: webhookDeliveries.statusCode,
      attempts: webhookDeliveries.attempts,
      deliveredAt: webhookDeliveries.deliveredAt,
      createdAt: webhookDeliveries.createdAt,
    })
    .from(webhookDeliveries)
    .where(eq(webhookDeliveries.webhookId, id))
    .orderBy(desc(webhookDeliveries.createdAt))
    .limit(20);

  return apiSuccess({
    ...webhookData,
    deliveries,
  });
}

/**
 * PATCH /api/v1/webhooks/:id — Update a webhook.
 */
export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const auth = await authenticateApiRequest(request);
  if ("error" in auth) return auth.error;

  const scopeErr = requireScope(auth.user, "webhooks");
  if (scopeErr) return scopeErr;

  const body = await request.json();
  const parsed = buildUpdateSchema().safeParse(body);
  if (!parsed.success) return apiError("Données invalides", 400);

  const updateData: Record<string, unknown> = { updatedAt: new Date() };
  if (parsed.data.url !== undefined) updateData.url = parsed.data.url;
  if (parsed.data.events !== undefined) updateData.events = parsed.data.events;
  if (parsed.data.active !== undefined) {
    updateData.active = parsed.data.active;
    if (parsed.data.active) updateData.failureCount = 0; // Reset on reactivation
  }

  const [updated] = await db
    .update(webhooks)
    .set(updateData)
    .where(
      and(
        eq(webhooks.id, id),
        eq(webhooks.userId, auth.user.id),
        // Cloisonnement par organisation : un même compte peut être membre de
        // plusieurs organisations, le seul `userId` laisserait voir depuis
        // l'une les webhooks créés dans l'autre (constat du lot 6).
        eq(webhooks.organizationId, auth.user.orgId)
      )
    )
    .returning();

  if (!updated) return apiError("Webhook introuvable", 404);

  return apiSuccess(updated);
}

/**
 * DELETE /api/v1/webhooks/:id — Delete a webhook.
 */
export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const auth = await authenticateApiRequest(request);
  if ("error" in auth) return auth.error;

  const scopeErr = requireScope(auth.user, "webhooks");
  if (scopeErr) return scopeErr;

  const [deleted] = await db
    .delete(webhooks)
    .where(
      and(
        eq(webhooks.id, id),
        eq(webhooks.userId, auth.user.id),
        // Cloisonnement par organisation : un même compte peut être membre de
        // plusieurs organisations, le seul `userId` laisserait voir depuis
        // l'une les webhooks créés dans l'autre (constat du lot 6).
        eq(webhooks.organizationId, auth.user.orgId)
      )
    )
    .returning({ id: webhooks.id });

  if (!deleted) return apiError("Webhook introuvable", 404);

  return apiSuccess({ deleted: true });
}
