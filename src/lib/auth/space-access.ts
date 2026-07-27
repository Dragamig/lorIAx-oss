/**
 * Regle de decision, pure et testable, pour l'acces au contenu d'un espace.
 *
 * Cette regle est sensible a l'ordre de ses branches : la permission explicite doit
 * etre evaluee AVANT la coupure `secret`, et l'appartenance implicite (espace
 * d'organisation, equipe proprietaire) APRES. Intervertir deux lignes ouvrirait tous
 * les espaces `secret` d'organisation sans que rien ne le signale, d'ou l'extraction
 * hors de toute requete SQL et la couverture de tests dediee
 * (`src/__tests__/auth/space-access.test.ts`).
 *
 * Les faits sont collectes par `checkSpaceViewAccess` dans `@/lib/auth/check-access`.
 */

import { hasGlobalRole } from "@/lib/auth/rbac";
import type { UserRole, SpaceType, ClassificationLevel } from "@/types";

/**
 * Trois surfaces, trois regles de visibilite deja en vigueur dans le depot.
 *
 * - `app` : reprend la liste `GET /api/spaces` (proprietaire, permission explicite
 *   directe ou d'equipe, equipe proprietaire, espace d'organisation).
 * - `member` : n'accepte que le lien explicite (proprietaire ou permission). Utilise
 *   la ou le contenu servi n'est pas rattachable a un document, donc pas filtrable
 *   par classification : les bases de donnees, qui ne portent qu'un `spaceId`.
 * - `publicApi` : reprend l'index `GET /api/v1/spaces` (proprietaire ou permission
 *   directe, aucune permission d'equipe, aucun espace d'organisation, espaces
 *   `secret` exclus meme pour leur proprietaire).
 */
export type SpaceViewMode = "app" | "member" | "publicApi";

export interface SpaceViewFacts {
  userGlobalRole: UserRole;
  spaceType: SpaceType;
  spaceClassification: ClassificationLevel;
  /** L'utilisateur est le proprietaire nominal de l'espace (`spaces.owner_user_id`). */
  isSpaceOwner: boolean;
  /** Une ligne `space_permissions` designe l'utilisateur directement. */
  hasDirectPermission: boolean;
  /** Une ligne `space_permissions` designe une equipe dont l'utilisateur est membre. */
  hasTeamPermission: boolean;
  /** L'utilisateur est membre de l'equipe qui possede l'espace, sans permission dessus. */
  isOwningTeamMember: boolean;
  /**
   * L'espace appartient a l'organisation de la requete courante (`x-org-slug`).
   * Ne conditionne que les branches implicites : la propriete et les permissions
   * explicites sont deja etanches entre locataires.
   */
  isRequestOrganization: boolean;
}

/**
 * Peut-on lire le contenu d'un espace (arborescence, activite, etiquettes, bases) ?
 */
export function canViewSpaceContents(
  facts: SpaceViewFacts,
  mode: SpaceViewMode
): boolean {
  const isAdmin = hasGlobalRole(facts.userGlobalRole, "admin");

  if (mode === "publicApi") {
    // L'index v1 masque les espaces `secret` a tout non-admin, y compris a leur
    // proprietaire : la route detail ne peut pas etre plus permissive que lui.
    if (isAdmin) return true;
    if (facts.spaceClassification === "secret") return false;
    return facts.isSpaceOwner || facts.hasDirectPermission;
  }

  if (isAdmin) return true;
  if (facts.isSpaceOwner) return true;

  // Lien explicite : evalue avant la coupure `secret`, un membre nomme d'un espace
  // `secret` doit continuer a le voir.
  if (facts.hasDirectPermission || facts.hasTeamPermission) return true;

  if (mode === "member") return false;

  // A partir d'ici, seules restent les appartenances implicites. Un espace `secret`
  // ne s'atteint jamais ainsi.
  if (facts.spaceClassification === "secret") return false;

  // Les branches implicites sont bornees a l'organisation de la requete, sans quoi
  // les espaces d'organisation d'un locataire B seraient lisibles depuis A.
  if (!facts.isRequestOrganization) return false;

  if (facts.spaceType === "organization") return true;
  if (facts.isOwningTeamMember) return true;

  return false;
}
