import { db } from "@/lib/db";
import { webhooks, spaces } from "@/lib/db/schema";
import { and, eq } from "drizzle-orm";
import { authenticateApiRequest, requireScope } from "@/lib/api/auth-api";
import { apiSuccess, apiError } from "@/lib/api/response";
import { checkSpaceReadAccess } from "@/lib/auth/check-access";
import { z } from "zod";
import { randomBytes } from "crypto";
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
 * Construit le schéma de création à chaque appel plutôt qu'au chargement du
 * module : `WEBHOOK_ALLOW_PRIVATE_TARGETS` doit être relue à chaque requête,
 * pas figée une fois pour toutes au démarrage (cf. commentaire dans
 * `dispatch.ts`). Absente, `externalUrlSchema()` garde son comportement par
 * défaut : refus des adresses privées.
 */
function buildCreateSchema() {
  return z.object({
    url: externalUrlSchema(2048, {
      allowPrivateTargets: process.env.WEBHOOK_ALLOW_PRIVATE_TARGETS === "true",
    }),
    events: z.array(z.enum(WEBHOOK_EVENTS as unknown as [string, ...string[]])).min(1),
    spaceId: z.string().uuid().optional(),
  });
}

/**
 * GET /api/v1/webhooks — List user's webhooks.
 */
export async function GET(request: Request) {
  const auth = await authenticateApiRequest(request);
  if ("error" in auth) return auth.error;

  const scopeErr = requireScope(auth.user, "webhooks");
  if (scopeErr) return scopeErr;

  const results = await db
    .select({
      id: webhooks.id,
      url: webhooks.url,
      events: webhooks.events,
      spaceId: webhooks.spaceId,
      active: webhooks.active,
      failureCount: webhooks.failureCount,
      createdAt: webhooks.createdAt,
      updatedAt: webhooks.updatedAt,
    })
    .from(webhooks)
    .where(
      and(
        eq(webhooks.userId, auth.user.id),
        // Cf. `[id]/route.ts` : le cloisonnement est par utilisateur ET par
        // organisation, un compte multi-organisations ne doit pas voir ici les
        // webhooks qu'il a créés dans une autre.
        eq(webhooks.organizationId, auth.user.orgId)
      )
    )
    .orderBy(webhooks.createdAt);

  return apiSuccess(results);
}

/**
 * POST /api/v1/webhooks — Create a webhook.
 */
export async function POST(request: Request) {
  const auth = await authenticateApiRequest(request);
  if ("error" in auth) return auth.error;

  const scopeErr = requireScope(auth.user, "webhooks");
  if (scopeErr) return scopeErr;

  const body = await request.json();
  const parsed = buildCreateSchema().safeParse(body);
  if (!parsed.success) {
    return apiError("Données invalides", 400);
  }

  // Limit: 20 webhooks per user
  const existing = await db
    .select({ id: webhooks.id })
    .from(webhooks)
    .where(
      and(
        eq(webhooks.userId, auth.user.id),
        eq(webhooks.organizationId, auth.user.orgId)
      )
    );

  if (existing.length >= 20) {
    return apiError("Limite de 20 webhooks atteinte", 400);
  }

  // Si un espace est ciblé, il doit appartenir à l'org de la clé API
  // (anti-fuite : pas de webhook exfiltrant les événements d'un autre tenant).
  if (parsed.data.spaceId) {
    const [space] = await db
      .select({ id: spaces.id })
      .from(spaces)
      .where(and(eq(spaces.id, parsed.data.spaceId), eq(spaces.organizationId, auth.user.orgId)))
      .limit(1);
    if (!space) return apiError("Espace introuvable", 404);

    // Un webhook d'espace est un abonnement en lecture continue : il livre à
    // l'URL de son créateur le titre de chaque document créé, modifié ou
    // supprimé dans cet espace. Le contrôle s'arrêtait à l'organisation, si
    // bien qu'un abonnement à un espace interdit produisait exactement la
    // fuite d'AZ-14, en différé et sans nouvelle requête. On exige donc le
    // même droit de lecture que pour lister l'arborescence de cet espace.
    const canRead = await checkSpaceReadAccess(auth.user, parsed.data.spaceId);
    if (!canRead) return apiError("Accès refusé", 403);
  }

  const secret = randomBytes(32).toString("hex");

  const [created] = await db
    .insert(webhooks)
    .values({
      userId: auth.user.id,
      url: parsed.data.url,
      events: parsed.data.events,
      spaceId: parsed.data.spaceId || null,
      // Toujours l'organisation de la clé d'API. Le schéma de création
      // n'expose aucun champ d'organisation : un webhook sans espace est donc
      // rattaché à l'organisation de son créateur, et rien ne permet d'en
      // déclarer une autre depuis le corps de la requête.
      organizationId: auth.user.orgId,
      secret,
    })
    .returning();

  return apiSuccess(
    {
      ...created,
      secret, // Shown once at creation
    },
    undefined,
    201
  );
}
