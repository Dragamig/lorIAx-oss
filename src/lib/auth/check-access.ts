import { db } from "@/lib/db";
import {
  documents,
  spaces,
  spacePermissions,
  documentPermissions,
  teamMembers,
  organizationMembers,
} from "@/lib/db/schema";
import { eq, and, or, ne, inArray } from "drizzle-orm";
import {
  canViewDocument,
  canEditDocument,
  canViewByClassification,
  canAdminSpace,
  hasGlobalRole,
  canCrossOrgBoundary,
} from "@/lib/auth/rbac";
import { users } from "@/lib/db/schema";
import { getRequestOrgId } from "@/lib/org/get-request-org";
import { hasOrgMembershipRow } from "@/lib/org/resolve-request-org";
import type {
  SessionUser,
  PermissionLevel,
  ClassificationLevel,
  UserRole,
} from "@/types";

// Pas de cache sur getSpacePermission() : un retrait d'appartenance (espace,
// équipe, organisation) doit être effectif à l'appel suivant. Un cache de 5 s
// par processus ne pouvait pas être invalidé de façon fiable (une vingtaine
// d'écritures, rôle global, propriétaire, cascades) et chaque requête n'appelle
// la fonction qu'une ou deux fois.

/** Ordre des niveaux de permission, du plus faible au plus fort. */
const PERMISSION_ORDER: Record<string, number> = {
  admin: 3,
  editor: 2,
  viewer: 1,
};

/** Retient le plus fort de deux niveaux de permission (null = aucun niveau). */
function bestPermissionLevel(
  a: PermissionLevel | null,
  b: PermissionLevel | null
): PermissionLevel | null {
  if (!a) return b;
  if (!b) return a;
  return (PERMISSION_ORDER[b] ?? 0) > (PERMISSION_ORDER[a] ?? 0) ? b : a;
}

/**
 * Retrieve the user's permission level on a space.
 * Returns the permission level or null if no explicit permission.
 */
export async function getSpacePermission(
  userId: string,
  spaceId: string
): Promise<PermissionLevel | null> {
  // L'espace est chargé AVANT toute décision de rôle : sans lui, la dispense
  // du rôle global ne pourrait pas être bornée à l'organisation de l'espace
  // (audit AZ-06). Même ordre que `src/lib/collab/auth-ws.ts`, qui fait
  // l'organisation d'abord et la dispense ensuite.
  const [space] = await db
    .select({
      ownerUserId: spaces.ownerUserId,
      ownerTeamId: spaces.ownerTeamId,
      type: spaces.type,
      classification: spaces.classification,
      organizationId: spaces.organizationId,
    })
    .from(spaces)
    .where(eq(spaces.id, spaceId))
    .limit(1);
  if (!space) {
    return null;
  }

  // Dispense du rôle global, bornée à l'organisation propriétaire de l'espace.
  //
  // Audit du 2026-08-19, constat AZ-06 : cette fonction rendait "admin" sur
  // TOUT espace de TOUTE organisation dès que le rôle global valait `admin`,
  // et le mettait en cache. Les routes qui l'appellent seule, avec un
  // `spaceId` fourni par le client, franchissaient donc la frontière de
  // tenant sans rien d'autre.
  //
  // Le rôle reste ce qui administre une organisation, il cesse d'être ce qui
  // en fait sortir : `super_admin` (administration d'instance) garde la
  // dispense inconditionnelle, `admin` ne l'obtient que dans une organisation
  // dont il est réellement membre.
  //
  // Deux questions distinctes, confondues jusqu'à la revue adversariale du lot
  // 6 (2026-08-20) :
  //
  // - « cet utilisateur a-t-il accès à cette organisation ? » : oui de droit
  //   sur l'organisation partagée par défaut, tenant mutualisé ouvert à tout
  //   compte authentifié. Règle historique du produit, inchangée, portée par
  //   `isOrgMember` et par `resolveRequestOrg` ;
  // - « son rôle global lui donne-t-il l'ADMINISTRATION de cette
  //   organisation ? » : c'est la question posée ICI, et elle exige une vraie
  //   ligne `organization_members`, y compris sur l'organisation par défaut.
  //
  // Borner la dispense avec `isOrgMember` ne bornait rien sur le tenant
  // mutualisé, qui porte les vraies données de production : un `admin` d'un
  // tenant ISOLÉ y obtenait l'administration de tous les espaces,
  // classification `secret` comprise, par le seul domaine racine. D'où
  // `hasOrgMembershipRow`, sans le raccourci d'ouverture.
  const [user] = await db
    .select({ globalRole: users.globalRole })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);
  if (user) {
    const role = user.globalRole as UserRole;
    if (canCrossOrgBoundary(role)) {
      return "admin";
    }
    if (
      hasGlobalRole(role, "admin") &&
      (await hasOrgMembershipRow(userId, space.organizationId))
    ) {
      return "admin";
    }
  }

  // Space owner has implicit admin permission (sans entrée spacePermissions)
  if (space.ownerUserId === userId) {
    return "admin";
  }

  // Lignes explicites de `space_permissions`, dans les deux formes que le
  // schéma autorise : la ligne nominative (`user_id`) et la ligne accordée à
  // une équipe (`team_id`). Les deux étaient historiquement lues par
  // `getAccessibleSpaceIds` et par `GET /api/spaces`, la référence d'affichage
  // du produit, mais `getSpacePermission` ignorait la seconde : un espace
  // partagé à une équipe s'affichait dans la liste puis répondait 403 sur
  // toutes les routes branchées ici. On retient le MEILLEUR niveau des deux.
  const [perm] = await db
    .select({ level: spacePermissions.level })
    .from(spacePermissions)
    .where(
      and(
        eq(spacePermissions.spaceId, spaceId),
        eq(spacePermissions.userId, userId)
      )
    )
    .limit(1);
  let result: PermissionLevel | null = (perm?.level as PermissionLevel) ?? null;

  // `admin` est le niveau maximal : inutile d'interroger les équipes.
  if (result !== "admin") {
    const userTeams = await db
      .select({ teamId: teamMembers.teamId })
      .from(teamMembers)
      .where(eq(teamMembers.userId, userId));
    const teamIds = userTeams.map((t) => t.teamId);

    if (teamIds.length > 0) {
      const teamPerms = await db
        .select({ level: spacePermissions.level })
        .from(spacePermissions)
        .where(
          and(
            eq(spacePermissions.spaceId, spaceId),
            inArray(spacePermissions.teamId, teamIds)
          )
        );

      for (const p of teamPerms) {
        result = bestPermissionLevel(result, p.level as PermissionLevel);
      }
    }
  }

  // Une ligne explicite est honorée telle quelle.
  //
  // Cette fonction annulait auparavant la permission explicite (elle rendait
  // `null`) quand l'espace avait une équipe propriétaire et que l'utilisateur
  // n'en était pas membre. Ni `getAccessibleSpaceIds`, ni `GET /api/spaces`,
  // ni le calendrier n'appliquaient cette annulation : un partage nominatif
  // vers une personne extérieure à l'équipe propriétaire était donc listé mais
  // inutilisable. L'annulation est retirée : une ligne `space_permissions` est
  // un octroi délibéré d'un administrateur d'espace, elle doit être honorée.
  // La fonction s'aligne ainsi sur la référence d'affichage du produit.
  if (result) {
    return result;
  }

  // Aucune ligne explicite : replis d'appartenance (équipe propriétaire, espace
  // d'organisation). Sans eux, les espaces créés sans ligne de permission
  // (à commencer par l'espace « Général » de chaque organisation) restent
  // inaccessibles à tous leurs membres légitimes.
  const implicit = await resolveImplicitSpacePermission(userId, space);
  return implicit;
}

/** Espace tel que chargé par getSpacePermission pour évaluer les replis. */
interface SpaceAccessRow {
  ownerTeamId: string | null;
  type: string;
  classification: string;
  organizationId: string;
}

/**
 * Replis d'appartenance, évalués uniquement quand aucune ligne
 * `space_permissions` ne concerne l'utilisateur.
 *
 * Ils reproduisent les chemins d'accès que le produit applique déjà ailleurs
 * (voir `GET /api/spaces` et `src/lib/calendar/permissions.ts`) :
 *
 * 1. Espace possédé par une équipe : tout membre de cette équipe travaille
 *    dans l'espace de son équipe, donc `editor`, et `admin` pour les
 *    responsables d'équipe (`team_members.role === "admin"`).
 * 2. Espace de type `organization` : ces espaces sont partagés à toute
 *    l'organisation (seul un admin global peut en créer), et le produit y
 *    autorise la création de documents et de bases. `viewer` casserait donc
 *    autant que l'absence de repli : on rend `editor`, et `admin` aux
 *    `owner`/`admin` de l'organisation, qui administrent déjà celle-ci.
 *
 * Deux garde-fous :
 * - un espace classé `secret` ne devient jamais accessible par un repli, il
 *   reste réservé au propriétaire, aux détenteurs d'une ligne explicite et aux
 *   admins globaux (même règle que le filtrage de `GET /api/spaces`) ;
 * - le repli « organisation » croise `organization_members` avec
 *   `spaces.organizationId`, jamais l'organisation de la requête : un membre
 *   d'une AUTRE organisation n'obtient rien.
 */
async function resolveImplicitSpacePermission(
  userId: string,
  space: SpaceAccessRow
): Promise<PermissionLevel | null> {
  // Les espaces secrets n'ont pas de repli : appartenance explicite seulement.
  if (space.classification === "secret") return null;

  if (space.ownerTeamId) {
    const [member] = await db
      .select({ role: teamMembers.role })
      .from(teamMembers)
      .where(
        and(
          eq(teamMembers.teamId, space.ownerTeamId),
          eq(teamMembers.userId, userId)
        )
      )
      .limit(1);

    if (member) return member.role === "admin" ? "admin" : "editor";
  }

  if (space.type === "organization") {
    const [orgMember] = await db
      .select({ role: organizationMembers.role })
      .from(organizationMembers)
      .where(
        and(
          eq(organizationMembers.organizationId, space.organizationId),
          eq(organizationMembers.userId, userId)
        )
      )
      .limit(1);

    if (orgMember) {
      return orgMember.role === "owner" || orgMember.role === "admin"
        ? "admin"
        : "editor";
    }
  }

  return null;
}

/**
 * Retrieve the user's permission level on a document.
 * Returns the permission level or null if no explicit permission.
 */
export async function getDocumentPermission(
  userId: string,
  documentId: string
): Promise<PermissionLevel | null> {
  const [perm] = await db
    .select({ level: documentPermissions.level })
    .from(documentPermissions)
    .where(
      and(
        eq(documentPermissions.documentId, documentId),
        eq(documentPermissions.userId, userId)
      )
    )
    .limit(1);
  return (perm?.level as PermissionLevel) ?? null;
}

/**
 * Check if a user can view a specific document.
 * Also considers space ownership (owner always has access) and classification.
 */
export async function checkDocumentViewAccess(
  user: SessionUser,
  docSpaceId: string,
  docId: string
): Promise<boolean> {
  // Check space ownership + appartenance organisationnelle
  const [space] = await db
    .select({
      ownerUserId: spaces.ownerUserId,
      organizationId: spaces.organizationId,
    })
    .from(spaces)
    .where(eq(spaces.id, docSpaceId))
    .limit(1);

  if (!space) return false;

  // Cloisonnement multi-tenant : l'espace doit appartenir à l'organisation
  // courante, résolue depuis le sous-domaine. Depuis le correctif AZ-06, un
  // `admin` global n'obtient cette organisation que s'il en est membre : un
  // admin de l'org A ne voit donc pas les documents de l'org B. Seul
  // `super_admin`, qui administre l'instance, traverse encore les tenants.
  const orgId = await getRequestOrgId(user);
  if (!orgId || space.organizationId !== orgId) return false;

  if (space.ownerUserId === user.id) return true;

  const spacePerm = await getSpacePermission(user.id, docSpaceId);
  const docPerm = await getDocumentPermission(user.id, docId);

  // Vérification RBAC classique
  const canView = canViewDocument(user.globalRole, spacePerm, docPerm);
  if (!canView) return false;

  // Vérification classification
  const [doc] = await db
    .select({ classification: documents.classification, createdBy: documents.createdBy })
    .from(documents)
    .where(eq(documents.id, docId))
    .limit(1);

  if (!doc) return false;

  return canViewByClassification(doc.classification as ClassificationLevel, {
    isAuthenticated: true,
    isSpaceMember: !!spacePerm,
    isSpaceAdmin: spacePerm === "admin",
    isDocumentAuthor: doc.createdBy === user.id,
    userGlobalRole: user.globalRole,
  });
}

/**
 * Check if a user is allowed to lower the classification level of a document.
 *
 * Declassifying widens the set of readers: it is restricted to the population that
 * may read a `secret` document (author, space admins) plus the space owner and
 * global admins. Org scoping is already enforced by checkDocumentEditAccess/ViewAccess,
 * which callers run first.
 */
export async function checkDocumentDeclassifyAccess(
  user: SessionUser,
  docSpaceId: string,
  docId: string
): Promise<boolean> {
  if (isGlobalAdmin(user)) return true;

  const [space] = await db
    .select({ ownerUserId: spaces.ownerUserId })
    .from(spaces)
    .where(eq(spaces.id, docSpaceId))
    .limit(1);
  if (space?.ownerUserId === user.id) return true;

  const [doc] = await db
    .select({ createdBy: documents.createdBy })
    .from(documents)
    .where(eq(documents.id, docId))
    .limit(1);
  if (doc?.createdBy === user.id) return true;

  const spacePerm = await getSpacePermission(user.id, docSpaceId);
  return spacePerm === "admin";
}

/**
 * Check if a user can edit a specific document.
 * Also considers space ownership (owner always has access).
 */
export async function checkDocumentEditAccess(
  user: SessionUser,
  docSpaceId: string,
  docId: string
): Promise<boolean> {
  // Check space ownership + appartenance organisationnelle
  const [space] = await db
    .select({
      ownerUserId: spaces.ownerUserId,
      organizationId: spaces.organizationId,
    })
    .from(spaces)
    .where(eq(spaces.id, docSpaceId))
    .limit(1);

  if (!space) return false;

  // Cloisonnement multi-tenant (cf. checkDocumentViewAccess) : borné à
  // l'organisation courante, `super_admin` excepté.
  const orgId = await getRequestOrgId(user);
  if (!orgId || space.organizationId !== orgId) return false;

  if (space.ownerUserId === user.id) return true;

  const spacePerm = await getSpacePermission(user.id, docSpaceId);
  const docPerm = await getDocumentPermission(user.id, docId);

  return canEditDocument(user.globalRole, spacePerm, docPerm);
}

/**
 * Vérifie qu'un utilisateur peut écrire dans un espace **de l'organisation
 * courante** (résolue depuis le sous-domaine).
 *
 * Complète getSpacePermission, qui n'applique aucun filtre d'organisation et
 * renvoie "admin" à tout admin global : sans ce cloisonnement, un admin de
 * l'org A pourrait écrire dans un espace de l'org B (destination d'une copie ou
 * d'un déplacement de document, par exemple).
 */
export async function checkSpaceWriteAccess(
  user: SessionUser,
  spaceId: string,
  opts?: { orgId?: string }
): Promise<boolean> {
  const [space] = await db
    .select({
      ownerUserId: spaces.ownerUserId,
      organizationId: spaces.organizationId,
    })
    .from(spaces)
    .where(eq(spaces.id, spaceId))
    .limit(1);

  if (!space) return false;

  // `opts.orgId` : organisation imposée par l'appelant (chemin public, où la
  // requête n'est pas celle de l'utilisateur évalué). Défaut : sous-domaine.
  const orgId = opts?.orgId ?? (await getRequestOrgId(user));
  if (!orgId || space.organizationId !== orgId) return false;

  if (space.ownerUserId === user.id) return true;

  const spacePerm = await getSpacePermission(user.id, spaceId);
  if (!spacePerm || spacePerm === "viewer") return false;

  return true;
}

/**
 * Sous-ensemble de `spaceIds` où l'utilisateur peut écrire dans `orgId`, en un
 * nombre constant de requêtes (spaces, équipes, permissions, appartenance).
 * Équivalent exact de `checkSpaceWriteAccess` appelé espace par espace : même
 * organisation, propriétaire, dispense du rôle global (bornée par une vraie
 * ligne d'appartenance sauf `super_admin`), meilleure ligne explicite
 * (utilisateur ou équipe) différente de `viewer`, puis replis implicites
 * (équipe propriétaire, espace d'organisation) hors classification `secret`.
 */
export async function getWritableSpaceIds(
  user: SessionUser,
  orgId: string,
  spaceIds: string[]
): Promise<string[]> {
  if (spaceIds.length === 0) return [];
  const rows = await db
    .select({
      id: spaces.id,
      ownerUserId: spaces.ownerUserId,
      ownerTeamId: spaces.ownerTeamId,
      type: spaces.type,
      classification: spaces.classification,
    })
    .from(spaces)
    .where(and(inArray(spaces.id, spaceIds), eq(spaces.organizationId, orgId)));
  if (rows.length === 0) return [];

  const role = user.globalRole as UserRole;
  if (canCrossOrgBoundary(role)) return rows.map((r) => r.id);
  if (hasGlobalRole(role, "admin") && (await hasOrgMembershipRow(user.id, orgId))) {
    return rows.map((r) => r.id);
  }

  const teams = await db
    .select({ teamId: teamMembers.teamId, role: teamMembers.role })
    .from(teamMembers)
    .where(eq(teamMembers.userId, user.id));
  const teamIds = teams.map((t) => t.teamId);
  const teamRole = new Map(teams.map((t) => [t.teamId, t.role]));

  const perms = await db
    .select({ spaceId: spacePermissions.spaceId, level: spacePermissions.level })
    .from(spacePermissions)
    .where(
      and(
        inArray(
          spacePermissions.spaceId,
          rows.map((r) => r.id)
        ),
        or(
          eq(spacePermissions.userId, user.id),
          teamIds.length > 0 ? inArray(spacePermissions.teamId, teamIds) : undefined
        )
      )
    );
  const best = new Map<string, PermissionLevel>();
  for (const p of perms) {
    best.set(p.spaceId, bestPermissionLevel(best.get(p.spaceId) ?? null, p.level as PermissionLevel)!);
  }

  const needOrgRole = rows.some((r) => r.type === "organization" && !best.has(r.id));
  let orgRole: string | null = null;
  if (needOrgRole) {
    const [m] = await db
      .select({ role: organizationMembers.role })
      .from(organizationMembers)
      .where(and(eq(organizationMembers.organizationId, orgId), eq(organizationMembers.userId, user.id)))
      .limit(1);
    orgRole = m?.role ?? null;
  }

  const out: string[] = [];
  for (const r of rows) {
    if (r.ownerUserId === user.id) {
      out.push(r.id);
      continue;
    }
    const level = best.get(r.id);
    if (level) {
      if (level !== "viewer") out.push(r.id);
      continue;
    }
    if (r.classification === "secret") continue;
    if (r.ownerTeamId && teamRole.has(r.ownerTeamId)) {
      out.push(r.id);
      continue;
    }
    if (r.type === "organization" && orgRole) out.push(r.id);
  }
  return out;
}

/**
 * Vérifie qu'un utilisateur peut lire dans un espace **de l'organisation
 * courante** (résolue depuis le sous-domaine). Pendant en lecture de
 * checkSpaceWriteAccess : le niveau `viewer` suffit.
 *
 * Comme pour l'écriture, getSpacePermission seul ne suffit pas : il n'applique
 * aucun filtre d'organisation et renvoie "admin" à tout admin global, si bien
 * qu'un admin de l'org A pourrait lire les fichiers d'un espace de l'org B.
 */
export async function checkSpaceReadAccess(
  user: SessionUser,
  spaceId: string,
  opts?: { orgId?: string }
): Promise<boolean> {
  const [space] = await db
    .select({
      ownerUserId: spaces.ownerUserId,
      organizationId: spaces.organizationId,
    })
    .from(spaces)
    .where(eq(spaces.id, spaceId))
    .limit(1);

  if (!space) return false;

  // `opts.orgId` : organisation imposée par l'appelant (chemin public, où la
  // requête n'est pas celle de l'utilisateur évalué). Défaut : sous-domaine.
  const orgId = opts?.orgId ?? (await getRequestOrgId(user));
  if (!orgId || space.organizationId !== orgId) return false;

  if (space.ownerUserId === user.id) return true;

  const spacePerm = await getSpacePermission(user.id, spaceId);
  return !!spacePerm;
}

/**
 * Liste des IDs d'espaces accessibles à l'utilisateur **dans l'organisation
 * courante** (résolue depuis le sous-domaine), avec au moins le niveau viewer.
 *
 * Contrat (cloisonnement multi-tenant) :
 * - La liste retournée est **autoritative et complète** : les appelants doivent
 *   TOUJOURS l'appliquer comme filtre (`inArray(space_id, ids)`), y compris
 *   quand elle est vide. Une liste vide signifie « aucun espace accessible »,
 *   **jamais** « pas de filtre / tous les espaces » (l'ancien sentinelle `[]`
 *   pour admin était une fuite cross-org).
 * - Admin global : tous les espaces de l'org courante (pas d'accès cross-org).
 * - Org introuvable / non membre : liste vide (fail-closed).
 * - Mêmes chemins d'accès que getSpacePermission : propriétaire, ligne
 *   explicite (utilisateur ou équipe), équipe propriétaire, espace de type
 *   `organization`. Les espaces classés `secret` restent hors des replis.
 *   Cette équivalence est vraie depuis que `getSpacePermission` lit lui aussi
 *   les lignes accordées à une équipe (il ne connaissait que `user_id`, ce qui
 *   faisait lister des espaces qui répondaient ensuite 403).
 */
export async function getAccessibleSpaceIds(
  user: SessionUser
): Promise<string[]> {
  const orgId = await getRequestOrgId(user);
  if (!orgId) return [];

  // Admin global : tous les espaces de l'organisation courante.
  if (user.globalRole === "admin" || user.globalRole === "super_admin") {
    const all = await db
      .select({ id: spaces.id })
      .from(spaces)
      .where(eq(spaces.organizationId, orgId));
    return all.map((s) => s.id);
  }

  // Espaces possédés par l'utilisateur (dans l'org courante).
  const ownedSpaces = await db
    .select({ id: spaces.id })
    .from(spaces)
    .where(
      and(eq(spaces.ownerUserId, user.id), eq(spaces.organizationId, orgId))
    );

  // Équipes de l'utilisateur : servent aux permissions d'équipe ET aux espaces
  // possédés par une équipe (ces derniers n'ont pas de ligne de permission).
  const userTeams = await db
    .select({ teamId: teamMembers.teamId })
    .from(teamMembers)
    .where(eq(teamMembers.userId, user.id));
  const teamIds = userTeams.map((t) => t.teamId);

  // Espaces avec permission explicite, personnelle ou d'équipe (org courante).
  const permSpaces = await db
    .select({ spaceId: spacePermissions.spaceId })
    .from(spacePermissions)
    .innerJoin(spaces, eq(spaces.id, spacePermissions.spaceId))
    .where(
      and(
        eq(spaces.organizationId, orgId),
        or(
          eq(spacePermissions.userId, user.id),
          teamIds.length > 0
            ? inArray(spacePermissions.teamId, teamIds)
            : undefined
        )
      )
    );

  // Espaces accessibles sans ligne de permission : espaces d'organisation
  // (partagés à tous les membres) et espaces de mes équipes. Les espaces
  // secrets en sont exclus, ils exigent une appartenance explicite.
  const implicitSpaces = await db
    .select({ id: spaces.id })
    .from(spaces)
    .where(
      and(
        eq(spaces.organizationId, orgId),
        ne(spaces.classification, "secret"),
        or(
          eq(spaces.type, "organization"),
          teamIds.length > 0
            ? inArray(spaces.ownerTeamId, teamIds)
            : undefined
        )
      )
    );

  const ids = new Set<string>();
  for (const s of ownedSpaces) ids.add(s.id);
  for (const p of permSpaces) ids.add(p.spaceId);
  for (const s of implicitSpaces) ids.add(s.id);

  return Array.from(ids);
}

/**
 * Returns true if user is admin or super_admin (full access).
 */
export function isGlobalAdmin(user: SessionUser): boolean {
  return user.globalRole === "admin" || user.globalRole === "super_admin";
}

/**
 * Check if a user can view a space based on its classification.
 * Secret spaces are only visible to space admins, owners and global admins.
 *
 * ATTENTION : aucun appelant au 2026-08-20. Cette fonction n'applique AUCUN
 * filtre d'organisation et rend `true` à tout admin global, y compris hors de
 * son organisation. Ne pas la rebrancher telle quelle : passer par
 * `checkSpaceReadAccess`, qui fait le contrôle d'organisation.
 */
export async function canViewSpace(
  user: SessionUser,
  spaceId: string,
  spaceClassification: ClassificationLevel,
  ownerUserId: string | null
): Promise<boolean> {
  if (isGlobalAdmin(user)) return true;
  if (ownerUserId === user.id) return true;

  if (spaceClassification === "secret") {
    const spacePerm = await getSpacePermission(user.id, spaceId);
    return canAdminSpace(user.globalRole, spacePerm);
  }

  return true;
}
