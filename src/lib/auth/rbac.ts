import type { PermissionLevel, UserRole, ClassificationLevel, UserCapability } from "@/types";

const ROLE_HIERARCHY: Record<UserRole, number> = {
  super_admin: 4,
  admin: 3,
  editor: 2,
  facility_manager: 2, // rôle parallèle à editor : pas d'accès admin général
  automation_manager: 2, // rôle parallèle : peut gérer les automatisations sans être admin
  template_doc_editor: 2, // rôle parallèle : gère les modèles de documents globaux
  template_graphic_editor: 2, // rôle parallèle : gère les modèles graphiques (Studio) globaux
  viewer: 1,
};

/** Catégorie réservée aux modèles graphiques (Studio / design-canvas). */
export const DESIGN_TEMPLATE_CATEGORY = "design";

const PERMISSION_HIERARCHY: Record<PermissionLevel, number> = {
  admin: 3,
  editor: 2,
  viewer: 1,
};

export function hasGlobalRole(
  userRole: UserRole,
  requiredRole: UserRole
): boolean {
  if (!(userRole in ROLE_HIERARCHY)) return false;
  if (!(requiredRole in ROLE_HIERARCHY)) return false;
  return ROLE_HIERARCHY[userRole] >= ROLE_HIERARCHY[requiredRole];
}

/** Vérifie la présence d'un badge de capacité (portée organisation). */
/**
 * Franchissement de la frontière d'organisation.
 *
 * Audit du 2026-08-19, constat AZ-06, arbitrage du mainteneur du 2026-08-20 :
 * `users.globalRole` est une colonne d'instance, pas une colonne de tenant.
 * Tant que `admin` valait dispense d'appartenance, être admin d'une
 * organisation revenait à être admin de toutes. Le franchissement est donc
 * réservé à `super_admin`, qui administre l'instance ; `admin` est un rôle
 * borné aux organisations dont l'utilisateur est réellement membre.
 *
 * À employer partout où le rôle décide de TRAVERSER une organisation. Pour
 * garder une route d'administration à l'intérieur de l'organisation courante,
 * continuer d'utiliser `hasGlobalRole(role, "admin")` : ce n'est pas la même
 * question.
 */
export function canCrossOrgBoundary(userRole: UserRole): boolean {
  return userRole === "super_admin";
}

/**
 * Message des refus dus au seul rôle, quand la ressource existe bel et bien
 * dans l'organisation courante et que seule l'administration d'instance y a
 * droit. Volontairement explicite : l'arbitrage du 2026-08-20 écarte la
 * refonte des écrans d'administration, mais demande que le refus se lise.
 *
 * Ne JAMAIS l'employer pour un dépareillement d'organisation, qui reste un 404
 * muet : dire « réservé à l'administration d'instance » y révélerait
 * l'existence d'une ressource d'un autre tenant.
 */
export const INSTANCE_ADMIN_ONLY_MESSAGE =
  "Action réservée à l'administration d'instance";

export function hasCapability(
  capabilities: UserCapability[] | null | undefined,
  cap: UserCapability
): boolean {
  return Array.isArray(capabilities) && capabilities.includes(cap);
}

/**
 * Salles de réunion : socle admin/super_admin OU badge facility_manager.
 * Le badge permet de déléguer sans donner les droits admin globaux.
 */
export function canManageMeetingRooms(
  userRole: UserRole,
  capabilities: UserCapability[] = []
): boolean {
  return (
    userRole === "super_admin" ||
    userRole === "admin" ||
    hasCapability(capabilities, "facility_manager")
  );
}

/**
 * Automatisations : socle admin/super_admin OU badge automation_manager.
 * Le badge permet de déléguer sans donner les droits admin globaux.
 */
export function canManageAutomations(
  userRole: UserRole,
  capabilities: UserCapability[] = []
): boolean {
  return (
    userRole === "super_admin" ||
    userRole === "admin" ||
    hasCapability(capabilities, "automation_manager")
  );
}

/**
 * Modèles globaux : socle admin/super_admin OU badge selon la catégorie.
 * - `template_graphic_editor` : catégorie « design » (Studio) uniquement.
 * - `template_doc_editor` : toutes les autres catégories (modèles de documents).
 * Les badges permettent de déléguer la curation sans droits admin globaux.
 */
export function canManageTemplateCategory(
  userRole: UserRole,
  capabilities: UserCapability[] = [],
  category?: string | null
): boolean {
  if (userRole === "super_admin" || userRole === "admin") return true;
  if (hasCapability(capabilities, "template_graphic_editor") && category === DESIGN_TEMPLATE_CATEGORY) {
    return true;
  }
  if (hasCapability(capabilities, "template_doc_editor") && category !== DESIGN_TEMPLATE_CATEGORY) {
    return true;
  }
  return false;
}

/**
 * Accès à la section Administration (`/admin`) : socle admin/super_admin OU un
 * badge disposant d'une surface admin dédiée.
 * - `facility_manager` → onglet Salles.
 * - `template_doc_editor` / `template_graphic_editor` → onglet Modèles.
 * `automation_manager` n'ouvre PAS la section admin (les automatisations se
 * gèrent par base de données, hors `/admin`).
 */
export function canAccessAdminArea(
  userRole: UserRole,
  capabilities: UserCapability[] = []
): boolean {
  return (
    userRole === "super_admin" ||
    userRole === "admin" ||
    hasCapability(capabilities, "facility_manager") ||
    hasCapability(capabilities, "template_doc_editor") ||
    hasCapability(capabilities, "template_graphic_editor")
  );
}

export function hasPermissionLevel(
  userLevel: PermissionLevel,
  requiredLevel: PermissionLevel
): boolean {
  if (!(userLevel in PERMISSION_HIERARCHY)) return false;
  if (!(requiredLevel in PERMISSION_HIERARCHY)) return false;
  return PERMISSION_HIERARCHY[userLevel] >= PERMISSION_HIERARCHY[requiredLevel];
}

export function canEditDocument(
  userGlobalRole: UserRole,
  spacePermission?: PermissionLevel | null,
  documentPermission?: PermissionLevel | null
): boolean {
  // Super admin et admin globaux ont toujours acces
  if (hasGlobalRole(userGlobalRole, "admin")) return true;

  // Permission document > permission espace > role global
  if (documentPermission) {
    return hasPermissionLevel(documentPermission, "editor");
  }

  if (spacePermission) {
    return hasPermissionLevel(spacePermission, "editor");
  }

  return userGlobalRole === "editor";
}

export function canViewDocument(
  userGlobalRole: UserRole,
  spacePermission?: PermissionLevel | null,
  documentPermission?: PermissionLevel | null
): boolean {
  if (hasGlobalRole(userGlobalRole, "admin")) return true;

  if (documentPermission) {
    return hasPermissionLevel(documentPermission, "viewer");
  }

  if (spacePermission) {
    return hasPermissionLevel(spacePermission, "viewer");
  }

  return false;
}

export function canAdminSpace(
  userGlobalRole: UserRole,
  spacePermission?: PermissionLevel | null
): boolean {
  if (hasGlobalRole(userGlobalRole, "admin")) return true;
  if (spacePermission) return spacePermission === "admin";
  return false;
}

/**
 * Vérifie si un utilisateur peut voir un document en fonction de sa classification.
 *
 * | Classification | Qui peut voir |
 * |---|---|
 * | public | Tout le monde (y compris via lien externe) |
 * | internal | Tout utilisateur authentifié de l'organisation |
 * | confidential | Membres de l'espace avec permission explicite |
 * | secret | Auteur + admins de l'espace uniquement |
 */
export function canViewByClassification(
  classification: ClassificationLevel,
  options: {
    isAuthenticated: boolean;
    isSpaceMember: boolean;
    isSpaceAdmin: boolean;
    isDocumentAuthor: boolean;
    userGlobalRole: UserRole;
  }
): boolean {
  const { isAuthenticated, isSpaceMember, isSpaceAdmin, isDocumentAuthor, userGlobalRole } = options;

  // Les admins globaux ont toujours accès
  if (hasGlobalRole(userGlobalRole, "admin")) return true;

  switch (classification) {
    case "public":
      return true; // accessible à tous (même non authentifiés via lien public)

    case "internal":
      return isAuthenticated;

    case "confidential":
      return isSpaceMember;

    case "secret":
      return isDocumentAuthor || isSpaceAdmin;

    default:
      return false;
  }
}
