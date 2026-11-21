import { resolveApiKey, hasScope, type ApiKeyScope } from "@/lib/auth/api-key";
import { getSessionUser } from "@/lib/auth/get-user";
import { checkRateLimitAsync } from "@/lib/rate-limit";
import { resolveRequestOrg } from "@/lib/org/resolve-request-org";
import { canCrossOrgBoundary } from "@/lib/auth/rbac";
import { getHooks } from "@/lib/modules/hooks";
import { apiError } from "./response";
import type { UserRole, UserCapability } from "@/types";

export interface ApiUser {
  id: string;
  email: string;
  name: string;
  globalRole: UserRole;
  capabilities: UserCapability[];
  scopes: ApiKeyScope[] | null; // null = session auth (all scopes)
  keyId?: string;
  /**
   * Organisation courante résolue depuis le sous-domaine (`x-org-slug`).
   * Toutes les ressources d'une route v1 DOIVENT être filtrées par cet `orgId`.
   */
  orgId: string;
  /** true si l'org courante est l'organisation partagée par défaut (`app`). */
  isDefaultOrg: boolean;
}

/**
 * Authenticate an API v1 request.
 * Supports both API key (Authorization: Bearer lrx_...) and session auth.
 */
export async function authenticateApiRequest(
  request: Request
): Promise<{ user: ApiUser } | { error: ReturnType<typeof apiError> }> {
  const authHeader = request.headers.get("authorization");

  // Identité de base, résolue depuis la clé API ou la session.
  let base: Omit<ApiUser, "orgId" | "isDefaultOrg">;

  // API key auth
  if (authHeader?.startsWith("Bearer lrx_")) {
    const key = authHeader.substring(7);

    // Point de contrôle unique de la fonctionnalité de plan `api_access` pour
    // toutes les routes v1 accédées par clé d'API. Licence absente ou invalide :
    // refus, comme `requireFeature`. La session (interface) n'est pas concernée.
    if (!(await getHooks().entitlements.hasFeature("api_access"))) {
      return {
        error: apiError(
          "La fonctionnalité « api_access » n'est pas disponible dans votre plan",
          403
        ),
      };
    }

    const resolved = await resolveApiKey(key);

    if (!resolved) {
      return { error: apiError("Clé API invalide ou expirée", 401) };
    }

    // Rate limit per API key. Compteur PARTAGÉ : indexé sur l'identifiant de
    // clé, il doit valoir 100/min pour la clé, pas 100/min par réplique (AZ-26).
    const rl = await checkRateLimitAsync(
      `api:${resolved.keyId}`,
      { maxRequests: 100, windowMs: 60_000 }
    );
    if (!rl.success) {
      return { error: apiError("Limite de requêtes dépassée", 429) };
    }

    base = {
      id: resolved.userId,
      email: resolved.email,
      name: resolved.name,
      globalRole: resolved.globalRole as UserRole,
      capabilities: (resolved.capabilities ?? []) as UserCapability[],
      scopes: resolved.scopes,
      keyId: resolved.keyId,
    };
  } else {
    // Session auth fallback
    const sessionUser = await getSessionUser();
    if (!sessionUser) {
      return { error: apiError("Non autorisé", 401) };
    }

    base = {
      id: sessionUser.id,
      email: sessionUser.email!,
      name: sessionUser.name!,
      globalRole: sessionUser.globalRole,
      capabilities: sessionUser.capabilities ?? [],
      scopes: null, // Session = all scopes
    };
  }

  // Résolution de l'organisation courante depuis le sous-domaine (x-org-slug).
  // Appartenance vérifiée pour les organisations isolées : un utilisateur ne
  // peut pas atteindre les données d'une org dont il n'est pas membre, même
  // avec une clé API valide, et même s'il est `admin` global (audit AZ-06).
  // 404 (jamais 403) pour ne pas leak l'existence.
  const slug = request.headers.get("x-org-slug");
  const org = await resolveRequestOrg(slug, {
    id: base.id,
    canCrossOrg: canCrossOrgBoundary(base.globalRole),
  });
  if (!org) {
    return { error: apiError("Introuvable", 404) };
  }

  return {
    user: { ...base, orgId: org.orgId, isDefaultOrg: org.isDefaultOrg },
  };
}

/**
 * Check if the authenticated user has a required scope.
 * Session users always pass (scopes = null).
 */
export function requireScope(
  user: ApiUser,
  scope: ApiKeyScope
): ReturnType<typeof apiError> | null {
  if (user.scopes === null) return null; // Session auth
  if (hasScope(user.scopes, scope)) return null;
  return apiError(`Scope manquant : ${scope}`, 403);
}
