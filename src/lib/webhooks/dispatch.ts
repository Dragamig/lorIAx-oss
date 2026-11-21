import { createHmac, randomUUID } from "crypto";
import { db } from "@/lib/db";
import logger from "@/lib/logger";
import { webhooks, webhookDeliveries, users, spaces } from "@/lib/db/schema";
import { eq, and, sql } from "drizzle-orm";
import { safeExternalFetch } from "@/lib/security/outbound-fetch";

const MAX_FAILURES = 10;
const RETRY_DELAYS = [10_000, 60_000, 300_000]; // 10s, 60s, 5min

export type WebhookEventType =
  | "document.created"
  | "document.updated"
  | "document.deleted"
  | "comment.created"
  | "comment.resolved"
  | "space.member_added"
  | "space.member_removed"
  | "mention.created"
  | "share.created"
  | "share.revoked";

interface WebhookPayload {
  id: string;
  event: WebhookEventType;
  timestamp: string;
  actor: { id: string; email: string; name: string };
  data: Record<string, unknown>;
}

/**
 * Sign a payload with HMAC-SHA256.
 */
function signPayload(payload: string, secret: string): string {
  return createHmac("sha256", secret).update(payload).digest("hex");
}

/**
 * Organisation propriétaire d'un espace, ou `null` si l'espace n'existe pas.
 *
 * Fourni ici pour que les émetteurs d'événements puissent calculer, en une
 * ligne et sur leur propre ligne d'appel, l'organisation qu'ils passent à
 * `dispatchWebhookEvent`. La décision reste lisible chez l'appelant (ADR-079) :
 * ce n'est pas le module de diffusion qui devine la portée d'un événement.
 */
export async function organizationIdOfSpace(
  spaceId: string
): Promise<string | null> {
  const [space] = await db
    .select({ organizationId: spaces.organizationId })
    .from(spaces)
    .where(eq(spaces.id, spaceId))
    .limit(1);

  return space?.organizationId ?? null;
}

/**
 * Dispatch a webhook event to all matching active webhooks.
 * Non-blocking — errors are caught and logged.
 *
 * `organizationId` est l'organisation de l'événement diffusé. Paramètre
 * explicite et obligatoire : la portée se lit sur la ligne d'appel, et un
 * mésusage se voit en revue (patron du lot 6, cf. `src/lib/meet/rooms.ts` et
 * `src/lib/video/space-access.ts`). Une organisation absente vaut « on n'émet
 * rien » : jamais un repli permissif qui rediffuserait à toute l'instance.
 */
export async function dispatchWebhookEvent(
  eventType: WebhookEventType,
  data: Record<string, unknown>,
  actorUserId: string,
  organizationId: string | null
): Promise<void> {
  // Fire and forget
  doDispatch(eventType, data, actorUserId, organizationId).catch((err) => {
    logger.error({ err }, "[webhook] Dispatch error");
  });
}

async function doDispatch(
  eventType: WebhookEventType,
  data: Record<string, unknown>,
  actorUserId: string,
  organizationId: string | null
): Promise<void> {
  // Pas d'organisation identifiée : on n'émet rien. Sans cette porte, la
  // sélection ci-dessous deviendrait non bornée et rediffuserait l'événement
  // aux webhooks de tous les tenants (constat du lot 6).
  if (!organizationId) {
    logger.warn(
      { eventType },
      "[webhook] Événement sans organisation, diffusion abandonnée"
    );
    return;
  }

  // Get actor info
  const [actor] = await db
    .select({ id: users.id, email: users.email, name: users.name })
    .from(users)
    .where(eq(users.id, actorUserId))
    .limit(1);

  if (!actor) return;

  // Find matching active webhooks
  const spaceId = data.spaceId as string | undefined;

  // Le cloisonnement par organisation est une clause de requête, pas un test
  // après coup : les lignes des autres tenants ne remontent jamais en mémoire.
  //
  // Les webhooks antérieurs au multi-tenant ne sont PAS concernés : la
  // migration 0014 (`0014_org_backfill_notnull.sql`) les a tous rattachés à
  // l'organisation `default`. La colonne est restée nullable, donc une ligne
  // sans organisation reste représentable pour une insertion postérieure ;
  // celle-là serait exclue de fait, ce qui est la direction sûre.
  const activeWebhooks = await db
    .select()
    .from(webhooks)
    .where(
      and(
        eq(webhooks.active, true),
        sql`${webhooks.failureCount} < ${MAX_FAILURES}`,
        eq(webhooks.organizationId, organizationId)
      )
    );

  // Filter by event type and optionally by spaceId
  const matching = activeWebhooks.filter((wh) => {
    const events = (wh.events as string[]) || [];
    if (!events.includes(eventType)) return false;
    // Un webhook déclaré sur un espace ne reçoit que les événements de cet
    // espace. Un événement sans espace ne le concerne donc pas non plus.
    if (wh.spaceId && wh.spaceId !== spaceId) return false;
    return true;
  });

  if (matching.length === 0) return;

  const payload: WebhookPayload = {
    id: randomUUID(),
    event: eventType,
    timestamp: new Date().toISOString(),
    actor: { id: actor.id, email: actor.email, name: actor.name },
    data,
  };

  // Deliver to each webhook
  for (const wh of matching) {
    deliverWebhook(wh, payload);
  }
}

async function deliverWebhook(
  webhook: typeof webhooks.$inferSelect,
  payload: WebhookPayload,
  attempt = 1
): Promise<void> {
  const payloadStr = JSON.stringify(payload);
  const signature = signPayload(payloadStr, webhook.secret);

  let statusCode: number | null = null;
  let responseBody: string | null = null;

  try {
    // L'URL est contrôlée à l'écriture, mais elle a pu être posée avant ce
    // contrôle, et un nom public peut résoudre vers l'intérieur au moment de
    // l'appel. On revalide donc à l'émission, redirections comprises
    // (audit du 2026-08-19, constat INJ-07).
    //
    // `WEBHOOK_ALLOW_PRIVATE_TARGETS` : exception pour les instances
    // auto-hébergées dont les webhooks visent volontairement un service
    // interne (ex: http://n8n:5678). Lue ici, à l'émission, plutôt qu'au
    // chargement du module : une valeur figée au démarrage ne se
    // reconfigure pas sans redéploiement, et complique les tests. Absente,
    // le comportement ne change pas (refus des adresses privées).
    const allowPrivateTargets = process.env.WEBHOOK_ALLOW_PRIVATE_TARGETS === "true";
    const response = await safeExternalFetch(webhook.url, {
      timeoutMs: 10_000,
      allowPrivateTargets,
      init: {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-LorIAx-Signature": `sha256=${signature}`,
          "X-LorIAx-Event": payload.event,
          "X-LorIAx-Delivery": payload.id,
          "User-Agent": "LorIAx-Webhook/1.0",
        },
        body: payloadStr,
      },
    });

    statusCode = response.status;
    responseBody = await response.text().catch(() => null);

    if (response.ok) {
      // Success — reset failure count
      await db
        .update(webhooks)
        .set({ failureCount: 0 })
        .where(eq(webhooks.id, webhook.id));

      await db.insert(webhookDeliveries).values({
        webhookId: webhook.id,
        eventType: payload.event,
        payload,
        statusCode,
        responseBody,
        attempts: attempt,
        deliveredAt: new Date(),
      });
      return;
    }
  } catch (err: unknown) {
    responseBody = (err instanceof Error ? err.message : null) || "Connection error";
  }

  // Failure — increment failure count
  const newFailureCount = (webhook.failureCount || 0) + 1;
  const shouldDeactivate = newFailureCount >= MAX_FAILURES;

  await db
    .update(webhooks)
    .set({
      failureCount: newFailureCount,
      ...(shouldDeactivate ? { active: false } : {}),
    })
    .where(eq(webhooks.id, webhook.id));

  // Record delivery attempt
  const retryDelay = RETRY_DELAYS[attempt - 1];
  const nextRetryAt = retryDelay && !shouldDeactivate
    ? new Date(Date.now() + retryDelay)
    : null;

  await db.insert(webhookDeliveries).values({
    webhookId: webhook.id,
    eventType: payload.event,
    payload,
    statusCode,
    responseBody,
    attempts: attempt,
    nextRetryAt,
  });

  // Retry if possible
  if (nextRetryAt && attempt < RETRY_DELAYS.length + 1) {
    setTimeout(() => {
      deliverWebhook(webhook, payload, attempt + 1);
    }, retryDelay);
  }
}
