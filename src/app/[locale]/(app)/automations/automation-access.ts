import { canManageAutomations } from "@/lib/auth/rbac";
import type { PermissionLevel, UserCapability, UserRole } from "@/types";

/**
 * Droit de gérer les automatisations d'un espace depuis l'écran Automatisations.
 *
 * Reprend exactement les deux gardes des routes de gestion (création,
 * modification, activation, suppression, test, rejeu, import Tally) :
 * `requireOrgScoped({ minPermission: "editor" })` puis `canManageAutomations`
 * (`src/lib/auth/rbac.ts`), seul juge du rôle requis.
 */
export function canManageSpaceAutomations(
  user: { globalRole: UserRole; capabilities?: UserCapability[] | null },
  spacePermission: PermissionLevel | null
): boolean {
  if (!spacePermission || spacePermission === "viewer") return false;
  return canManageAutomations(user.globalRole, user.capabilities ?? []);
}

/** Raison affichée sur les actions de gestion indisponibles. */
export const MANAGE_AUTOMATIONS_REQUIRED =
  "Réservé aux administrateurs et aux gestionnaires d'automatisations. Demandez ce rôle à l'administrateur de votre organisation.";
