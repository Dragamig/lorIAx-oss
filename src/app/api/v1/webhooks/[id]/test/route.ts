import { db } from "@/lib/db";
import { webhooks } from "@/lib/db/schema";
import { eq, and } from "drizzle-orm";
import { authenticateApiRequest, requireScope } from "@/lib/api/auth-api";
import { apiSuccess, apiError } from "@/lib/api/response";
import { dispatchWebhookEvent } from "@/lib/webhooks/dispatch";

/**
 * POST /api/v1/webhooks/:id/test — Send a test ping event.
 */
export async function POST(
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

  // Send a test event (document.created with test data)
  await dispatchWebhookEvent(
    "document.created",
    {
      documentId: "test-" + Date.now(),
      spaceId: webhook.spaceId,
      title: "Test webhook — LorIAx",
      test: true,
    },
    auth.user.id,
    // Organisation de l'événement : celle de la clé d'API qui déclenche le test.
    auth.user.orgId
  );

  return apiSuccess({ sent: true });
}
