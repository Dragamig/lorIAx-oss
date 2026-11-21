import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { aiProviders } from "@/lib/db/schema";
import { and, eq, isNull, or } from "drizzle-orm";
import { canCrossOrgBoundary, INSTANCE_ADMIN_ONLY_MESSAGE } from "@/lib/auth/rbac";
import { getRequestOrgId } from "@/lib/org/get-request-org";
import type { UserRole } from "@/types";

/**
 * Cloisonnement des fournisseurs d'IA (audit AZ-06, lot 6).
 *
 * `ai_providers` porte une colonne `organization_id` qu'aucun verbe
 * d'administration ne lisait ni n'écrivait : le GET rendait la configuration
 * de tous les tenants, et le PATCH acceptait un identifiant nu, donc un admin
 * de l'organisation A repointait `apiBaseUrl` du fournisseur par défaut vers
 * son propre point d'écoute et captait toute l'inférence de l'instance, clé
 * d'API en en-tête comprise.
 *
 * Deux portées coexistent dans la table :
 * - `organization_id` renseigné : fournisseur du tenant, lu et écrit par ses
 *   administrateurs, invisible aux autres (404 sur dépareillement, jamais 403,
 *   pour ne pas révéler l'existence d'une ressource d'un autre tenant) ;
 * - `organization_id` NULL : fournisseur de portée instance. Conformément au
 *   corollaire de l'ADR-079, il n'y a rien à filtrer dessus, donc son écriture
 *   se règle par le rôle : `super_admin` seul, message explicite en 403. Il
 *   reste lisible par les administrateurs d'organisation, faute de quoi les
 *   écrans d'assignation de modèle deviendraient vides sur une instance
 *   auto-hébergée dont les fournisseurs sont antérieurs au cloisonnement.
 */

/** Filtre de lecture : les fournisseurs de l'org courante et ceux d'instance. */
export function visibleProvidersFilter(orgId: string) {
  return or(eq(aiProviders.organizationId, orgId), isNull(aiProviders.organizationId));
}

export type ProviderScope =
  | { ok: true; provider: { id: string; organizationId: string | null }; orgId: string }
  | { ok: false; response: NextResponse };

const notFound = () =>
  NextResponse.json({ error: "Fournisseur introuvable" }, { status: 404 });

/** Résout l'organisation de la requête, `null` = aucun accès (fail-closed). */
export async function requireRequestOrg(user: {
  id: string;
  globalRole: string;
}): Promise<{ ok: true; orgId: string } | { ok: false; response: NextResponse }> {
  const orgId = await getRequestOrgId(user);
  if (!orgId) {
    return {
      ok: false,
      response: NextResponse.json({ error: "Organisation introuvable" }, { status: 404 }),
    };
  }
  return { ok: true, orgId };
}

/**
 * Charge un fournisseur et confronte sa portée à la requête.
 *
 * @param write `true` pour une écriture : un fournisseur d'instance y exige
 *   `super_admin`, alors qu'il reste lisible par un admin d'organisation.
 */
export async function resolveProviderScope(
  user: { id: string; globalRole: string },
  id: string,
  write: boolean
): Promise<ProviderScope> {
  const org = await requireRequestOrg(user);
  if (!org.ok) return org;

  const [provider] = await db
    .select({ id: aiProviders.id, organizationId: aiProviders.organizationId })
    .from(aiProviders)
    .where(eq(aiProviders.id, id))
    .limit(1);

  if (!provider) return { ok: false, response: notFound() };

  if (provider.organizationId === null) {
    // Portée instance : décidée par le rôle, pas par une clause `where`.
    if (!canCrossOrgBoundary(user.globalRole as UserRole)) {
      if (write) {
        return {
          ok: false,
          response: NextResponse.json(
            { error: INSTANCE_ADMIN_ONLY_MESSAGE },
            { status: 403 }
          ),
        };
      }
    }
    return { ok: true, provider, orgId: org.orgId };
  }

  if (provider.organizationId !== org.orgId) {
    return { ok: false, response: notFound() };
  }

  return { ok: true, provider, orgId: org.orgId };
}

/** Portée d'un `isDefault` exclusif : l'organisation, ou l'instance. */
export function defaultScopeFilter(organizationId: string | null) {
  return organizationId === null
    ? and(eq(aiProviders.isDefault, true), isNull(aiProviders.organizationId))
    : and(eq(aiProviders.isDefault, true), eq(aiProviders.organizationId, organizationId));
}
