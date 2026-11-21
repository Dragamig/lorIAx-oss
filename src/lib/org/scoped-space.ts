import { db } from "@/lib/db";
import { spaces } from "@/lib/db/schema";
import { and, eq } from "drizzle-orm";
import { getRequestOrgId } from "@/lib/org/get-request-org";

type SessionUserLike = { id: string; globalRole: string };

/**
 * Résout un espace par slug en le confinant à l'organisation de la requête
 * courante (header `x-org-slug` → orgId).
 *
 * Retourne `null` si l'org n'est pas résolue (utilisateur non membre d'une org
 * isolée, slug inconnu/inactif) ou si l'espace n'appartient pas à cette org.
 * Fail-closed : un slug d'espace forgé depuis une autre organisation ne résout
 * jamais — l'appelant renvoie 404. Empêche toute fuite cross-tenant.
 */
export async function getSpaceBySlugForRequest(
  slug: string,
  user: SessionUserLike
) {
  const orgId = await getRequestOrgId(user);
  if (!orgId) return null;

  const [space] = await db
    .select()
    .from(spaces)
    .where(and(eq(spaces.slug, slug), eq(spaces.organizationId, orgId)))
    .limit(1);

  return space || null;
}
