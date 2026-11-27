import { OrgScopeError, requireOrgScoped } from "@/lib/auth/require-org-scoped";

/**
 * Droit d'édition sur un espace, jugé par le même contrôle que les routes
 * d'API (`requireOrgScoped` avec `minPermission: "editor"`, donc
 * `getSpacePermission` dans l'organisation courante). Sert aux pages serveur
 * pour masquer les actions que l'API refuserait, sans recopier la règle côté
 * client. Toute autre erreur que le refus d'accès est propagée.
 */
export async function canEditSpace(spaceId: string): Promise<boolean> {
  try {
    await requireOrgScoped({ resource: { type: "space", id: spaceId }, minPermission: "editor" });
    return true;
  } catch (e) {
    if (e instanceof OrgScopeError) return false;
    throw e;
  }
}
