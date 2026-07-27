import type { PermissionLevel, UserRole, ClassificationLevel } from "@/types";

const ROLE_HIERARCHY: Record<UserRole, number> = {
  super_admin: 4,
  admin: 3,
  editor: 2,
  viewer: 1,
};

const PERMISSION_HIERARCHY: Record<PermissionLevel, number> = {
  admin: 3,
  editor: 2,
  viewer: 1,
};

export function hasGlobalRole(
  userRole: UserRole,
  requiredRole: UserRole
): boolean {
  return ROLE_HIERARCHY[userRole] >= ROLE_HIERARCHY[requiredRole];
}

export function hasPermissionLevel(
  userLevel: PermissionLevel,
  requiredLevel: PermissionLevel
): boolean {
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

  // Fallback ferme : sans permission explicite (document ou espace), on refuse.
  // Le role global "editor" est la valeur par defaut du schema Drizzle, s'en servir
  // ici donnerait a tout compte fraichement inscrit le droit d'editer et de supprimer
  // n'importe quel document. L'acces legitime passe par une permission d'espace ou de
  // document, la propriete de l'espace (voir checkDocumentEditAccess), ou un role
  // global admin / super_admin traite plus haut.
  return false;
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

  // Fallback ferme : aucun role global en dessous d'admin n'ouvre l'acces sans permission.
  return false;
}

export function canAdminSpace(
  userGlobalRole: UserRole,
  spacePermission?: PermissionLevel | null
): boolean {
  if (hasGlobalRole(userGlobalRole, "admin")) return true;
  if (spacePermission) return spacePermission === "admin";
  // Fallback ferme : administrer un espace exige la permission d'espace "admin".
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
