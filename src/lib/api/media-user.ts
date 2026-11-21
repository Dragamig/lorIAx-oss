import type { SessionUser } from "@/types";
import { requireScope, type ApiUser } from "./auth-api";
import type { apiError } from "./response";

/**
 * Transforme l'utilisateur d'une requête v1 (clé d'API ou session) en
 * utilisateur de session pour les fonctions de la médiathèque.
 *
 * Aucune élévation : id, rôle global et capacités sont ceux du propriétaire
 * de la clé, relus par `resolveApiKey` (clé révoquée ou expirée déjà refusée
 * en amont). L'organisation reste celle de la clé (`ApiUser.orgId`), que
 * l'appelant passe explicitement aux fonctions de la médiathèque.
 */
export async function apiUserToSessionUser(user: ApiUser): Promise<SessionUser> {
  return {
    id: user.id,
    email: user.email,
    name: user.name,
    globalRole: user.globalRole,
    capabilities: [...user.capabilities],
  };
}

/** Réponse 403 si la clé n'a pas la portée ; `scopes: null` (session) passe. */
export function requireMediaScope(
  user: ApiUser,
  scope: "media:read" | "media:write",
): ReturnType<typeof apiError> | null {
  return requireScope(user, scope);
}
