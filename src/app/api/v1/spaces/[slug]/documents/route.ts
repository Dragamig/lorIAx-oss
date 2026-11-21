import { db } from "@/lib/db";
import { documents, spaces } from "@/lib/db/schema";
import { eq, and, gt, asc, isNull } from "drizzle-orm";
import { authenticateApiRequest, requireScope } from "@/lib/api/auth-api";
import { apiSuccess, apiError } from "@/lib/api/response";
import { checkSpaceReadAccess, getSpacePermission } from "@/lib/auth/check-access";
import { canViewByClassification } from "@/lib/auth/rbac";
import type { ClassificationLevel } from "@/types";

/**
 * GET /api/v1/spaces/:slug/documents — List documents in a space.
 *
 * Deux contrôles distincts, et il en fallait bien deux (audit du 2026-08-19,
 * constat AZ-14) : la route confinait l'espace à l'organisation de la clé
 * d'API, puis servait l'arborescence complète sans jamais demander si le
 * porteur de la clé avait le moindre droit sur cet espace. Un compte de
 * l'organisation qui se fabriquait une clé `documents:read` lisait donc les
 * titres et la hiérarchie de tous les espaces du tenant, `secret` compris.
 *
 * Le scope de clé reste vérifié en amont : il dit ce que la clé a le droit de
 * faire, jamais sur quoi. Le droit d'objet est une question séparée.
 */
export async function GET(
  request: Request,
  { params }: { params: Promise<{ slug: string }> }
) {
  const { slug } = await params;
  const auth = await authenticateApiRequest(request);
  if ("error" in auth) return auth.error;

  const scopeErr = requireScope(auth.user, "documents:read");
  if (scopeErr) return scopeErr;

  // Find space — confiné à l'organisation de la clé API (anti-fuite cross-tenant :
  // un slug d'une autre org ne doit jamais être résolu).
  const [space] = await db
    .select({ id: spaces.id, name: spaces.name })
    .from(spaces)
    .where(and(eq(spaces.slug, slug), eq(spaces.organizationId, auth.user.orgId)))
    .limit(1);

  if (!space) {
    return apiError("Espace introuvable", 404);
  }

  // Droit d'objet. `checkSpaceReadAccess` résout l'organisation de la requête
  // par `getRequestOrgId`, c'est-à-dire par l'en-tête de sous-domaine, alors
  // que l'espace vient d'être résolu sur `auth.user.orgId`. Les deux sources
  // ne divergent pas : `authenticateApiRequest` lit le MÊME en-tête et le
  // soumet au MÊME `resolveRequestOrg`, avec la même appartenance exigée. Et
  // même si elles divergeaient un jour, l'ordre choisi ici rend l'écart
  // inoffensif : l'espace n'existe déjà plus (404) hors de l'organisation de
  // la clé, et le helper ne peut alors que refuser en plus, jamais accorder.
  // L'organisation retenue est donc celle de la clé, jamais une organisation
  // que l'appelant déclarerait.
  const canRead = await checkSpaceReadAccess(auth.user, space.id);
  if (!canRead) {
    return apiError("Accès refusé", 403);
  }

  const { searchParams } = new URL(request.url);
  const cursor = searchParams.get("cursor");
  const limit = Math.min(parseInt(searchParams.get("limit") || "50"), 100);
  const parentId = searchParams.get("parentId") || null;

  const conditions = [eq(documents.spaceId, space.id)];

  if (parentId) {
    conditions.push(eq(documents.parentId, parentId));
  } else {
    conditions.push(isNull(documents.parentId));
  }

  if (cursor) {
    conditions.push(gt(documents.id, cursor));
  }

  const results = await db
    .select({
      id: documents.id,
      title: documents.title,
      slug: documents.slug,
      icon: documents.icon,
      isFolder: documents.isFolder,
      visibility: documents.visibility,
      parentId: documents.parentId,
      position: documents.position,
      classification: documents.classification,
      createdBy: documents.createdBy,
      createdAt: documents.createdAt,
      updatedAt: documents.updatedAt,
    })
    .from(documents)
    .where(and(...conditions))
    .orderBy(asc(documents.position), asc(documents.id))
    .limit(limit + 1);

  // Un titre est souvent la donnée sensible elle-même : seuls les documents que la
  // classification permet de lire sont listés (la pagination reste calée sur la page brute).
  const spacePerm = await getSpacePermission(auth.user.id, space.id);
  const hasMore = results.length > limit;
  const page = hasMore ? results.slice(0, limit) : results;
  const data = page
    .filter((d) =>
      canViewByClassification(d.classification as ClassificationLevel, {
        isAuthenticated: true,
        isSpaceMember: !!spacePerm,
        isSpaceAdmin: spacePerm === "admin",
        isDocumentAuthor: d.createdBy === auth.user.id,
        userGlobalRole: auth.user.globalRole,
      })
    )
    .map(({ classification: _c, createdBy: _a, ...rest }) => rest);

  const nextCursor = hasMore ? page[page.length - 1]?.id ?? null : null;

  return apiSuccess(data, { cursor: nextCursor, hasMore });
}
