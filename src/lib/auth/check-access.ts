import { db } from "@/lib/db";
import {
  documents,
  spaces,
  spacePermissions,
  documentPermissions,
  teamMembers,
} from "@/lib/db/schema";
import { eq, and, or, inArray } from "drizzle-orm";
import {
  canViewDocument,
  canEditDocument,
  canViewByClassification,
  canAdminSpace,
  hasGlobalRole,
  hasPermissionLevel,
} from "@/lib/auth/rbac";
import { users } from "@/lib/db/schema";
import { canViewSpaceContents, type SpaceViewMode } from "@/lib/auth/space-access";
import type {
  SessionUser,
  PermissionLevel,
  ClassificationLevel,
  SpaceType,
} from "@/types";

// ─── Cache LRU pour getSpacePermission() ────────────────────────────────────
const PERM_CACHE_TTL = 5_000; // 5 secondes
const PERM_CACHE_MAX = 1000;

interface CacheEntry {
  value: PermissionLevel | null;
  expiresAt: number;
}

const permCache = new Map<string, CacheEntry>();

function getCachedPerm(key: string): PermissionLevel | null | undefined {
  const entry = permCache.get(key);
  if (!entry) return undefined;
  if (Date.now() > entry.expiresAt) {
    permCache.delete(key);
    return undefined;
  }
  return entry.value;
}

function setCachedPerm(key: string, value: PermissionLevel | null): void {
  // Éviction LRU simple : supprimer la plus ancienne entrée si max atteint
  if (permCache.size >= PERM_CACHE_MAX) {
    const firstKey = permCache.keys().next().value;
    if (firstKey) permCache.delete(firstKey);
  }
  permCache.set(key, { value, expiresAt: Date.now() + PERM_CACHE_TTL });
}

/** Invalider le cache de permissions pour un espace donné */
export function invalidateSpacePermCache(spaceId: string): void {
  for (const key of permCache.keys()) {
    if (key.endsWith(`:${spaceId}`)) permCache.delete(key);
  }
}

/**
 * Retrieve the user's permission level on a space.
 * Returns the permission level or null if no explicit permission.
 */
export async function getSpacePermission(
  userId: string,
  spaceId: string
): Promise<PermissionLevel | null> {
  const cacheKey = `${userId}:${spaceId}`;
  const cached = getCachedPerm(cacheKey);
  if (cached !== undefined) return cached;

  // Super admins have admin access to all spaces
  const [user] = await db
    .select({ globalRole: users.globalRole })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);
  if (user && hasGlobalRole(user.globalRole, "admin")) {
    setCachedPerm(cacheKey, "admin");
    return "admin";
  }

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
  const result = (perm?.level as PermissionLevel) ?? null;

  // If user has a space permission, verify team membership for team-owned spaces
  if (result) {
    const [space] = await db
      .select({ ownerTeamId: spaces.ownerTeamId })
      .from(spaces)
      .where(eq(spaces.id, spaceId))
      .limit(1);

    if (space?.ownerTeamId) {
      const [member] = await db
        .select({ teamId: teamMembers.teamId })
        .from(teamMembers)
        .where(
          and(
            eq(teamMembers.teamId, space.ownerTeamId),
            eq(teamMembers.userId, userId)
          )
        )
        .limit(1);

      if (!member) {
        setCachedPerm(cacheKey, null);
        return null;
      }
    }
  }

  setCachedPerm(cacheKey, result);
  return result;
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
  // Check space ownership
  const [space] = await db
    .select({ ownerUserId: spaces.ownerUserId })
    .from(spaces)
    .where(eq(spaces.id, docSpaceId))
    .limit(1);

  if (space?.ownerUserId === user.id) return true;

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
 * Check if a user can edit a specific document.
 * Also considers space ownership (owner always has access).
 */
export async function checkDocumentEditAccess(
  user: SessionUser,
  docSpaceId: string,
  docId: string
): Promise<boolean> {
  // Check space ownership
  const [space] = await db
    .select({ ownerUserId: spaces.ownerUserId })
    .from(spaces)
    .where(eq(spaces.id, docSpaceId))
    .limit(1);

  if (space?.ownerUserId === user.id) return true;

  const spacePerm = await getSpacePermission(user.id, docSpaceId);
  const docPerm = await getDocumentPermission(user.id, docId);

  return canEditDocument(user.globalRole, spacePerm, docPerm);
}

/**
 * Check if a user is allowed to lower the classification level of a document.
 *
 * Declassifying widens the set of readers, it is therefore restricted to the same
 * population that may read a `secret` document (see canViewByClassification) : the
 * document author and the space admins, plus the space owner and global admins.
 * Without this check, a user holding only an `editor` space permission could PATCH a
 * `secret` document down to `internal` and then read its content through the GET route.
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

// ─── Cache LRU pour getUserTeamIds() ────────────────────────────────────────
// L'appartenance aux equipes ne depend pas de l'espace vise : la barre laterale
// recharge l'arborescence a chaque changement d'espace, ce cache evite de rejouer
// la meme requete a chaque fois.
const teamCache = new Map<string, { value: string[]; expiresAt: number }>();

/** Invalider le cache d'appartenance aux equipes pour un utilisateur donne */
export function invalidateUserTeamCache(userId: string): void {
  teamCache.delete(userId);
}

/**
 * Team IDs the user belongs to.
 */
async function getUserTeamIds(userId: string): Promise<string[]> {
  const cached = teamCache.get(userId);
  if (cached && Date.now() <= cached.expiresAt) return cached.value;

  const rows = await db
    .select({ teamId: teamMembers.teamId })
    .from(teamMembers)
    .where(eq(teamMembers.userId, userId));
  const value = rows.map((r) => r.teamId);

  if (teamCache.size >= PERM_CACHE_MAX) {
    const firstKey = teamCache.keys().next().value;
    if (firstKey) teamCache.delete(firstKey);
  }
  teamCache.set(userId, { value, expiresAt: Date.now() + PERM_CACHE_TTL });
  return value;
}

/**
 * L'espace appartient-il a l'organisation de la requete courante ?
 *
 * `GET /api/spaces` borne sa liste a `eq(spaces.organizationId, orgId)`, ou `orgId`
 * est resolu depuis l'en-tete `x-org-slug` pose par le middleware. Sans cette borne,
 * les espaces d'organisation d'un locataire B redeviennent lisibles depuis A.
 *
 * L'import est dynamique : `next/headers` n'existe pas dans le serveur WebSocket
 * autonome, qui charge lui aussi ce module. En cas d'echec (hors contexte de requete,
 * organisation introuvable) on repond `false`, ce qui ferme les branches implicites
 * sans jamais bloquer un proprietaire ni un membre nomme.
 */
async function isRequestOrganization(spaceOrganizationId: string): Promise<boolean> {
  try {
    const { headers } = await import("next/headers");
    const { getOrgId, getOrgSlugFromHeaders } = await import("@/lib/org/get-org-id");
    const orgSlug = await getOrgSlugFromHeaders(headers);
    return (await getOrgId(orgSlug)) === spaceOrganizationId;
  } catch {
    return false;
  }
}

/**
 * Check if a user may read the content of a space (document tree, activity,
 * labels, databases attached to the space).
 *
 * Enveloppe de collecte : la decision elle-meme vit dans `canViewSpaceContents`
 * (`@/lib/auth/space-access`), pure et couverte par des tests, parce qu'elle est
 * sensible a l'ordre de ses branches. Voir `SpaceViewMode` pour le choix du mode.
 *
 * Without this check the per space routes were reachable by slug or id alone,
 * which turned any authenticated account into a reader of every space.
 */
export async function checkSpaceViewAccess(
  user: SessionUser,
  spaceId: string,
  mode: SpaceViewMode = "app"
): Promise<boolean> {
  const [space] = await db
    .select({
      type: spaces.type,
      classification: spaces.classification,
      ownerUserId: spaces.ownerUserId,
      ownerTeamId: spaces.ownerTeamId,
      organizationId: spaces.organizationId,
    })
    .from(spaces)
    .where(eq(spaces.id, spaceId))
    .limit(1);

  if (!space) return false;

  const teamIds = await getUserTeamIds(user.id);

  const perms = await db
    .select({ userId: spacePermissions.userId, teamId: spacePermissions.teamId })
    .from(spacePermissions)
    .where(
      and(
        eq(spacePermissions.spaceId, spaceId),
        teamIds.length > 0
          ? or(
              eq(spacePermissions.userId, user.id),
              inArray(spacePermissions.teamId, teamIds)
            )
          : eq(spacePermissions.userId, user.id)
      )
    );

  // L'organisation n'est resolue que si une branche implicite peut encore servir.
  const mayNeedOrg =
    mode === "app" && (space.type === "organization" || !!space.ownerTeamId);

  return canViewSpaceContents(
    {
      userGlobalRole: user.globalRole,
      spaceType: space.type as SpaceType,
      spaceClassification: (space.classification || "internal") as ClassificationLevel,
      isSpaceOwner: space.ownerUserId === user.id,
      hasDirectPermission: perms.some((p) => p.userId === user.id),
      hasTeamPermission: perms.some((p) => !!p.teamId && teamIds.includes(p.teamId)),
      isOwningTeamMember: !!space.ownerTeamId && teamIds.includes(space.ownerTeamId),
      isRequestOrganization: mayNeedOrg
        ? await isRequestOrganization(space.organizationId)
        : false,
    },
    mode
  );
}

/**
 * Predicat de visibilite par classification, a appliquer aux LISTES de documents
 * d'un espace (arborescence, activite, index v1).
 *
 * Ces listes n'exposent que des metadonnees, mais un titre est tres souvent la
 * donnee sensible elle-meme. Le predicat reprend exactement la moitie
 * « classification » de `checkDocumentViewAccess`, la moitie RBAC etant deja
 * assuree en amont par `checkSpaceViewAccess`.
 */
export async function buildDocumentVisibilityFilter(
  user: SessionUser,
  spaceId: string
): Promise<(doc: { classification: string | null; createdBy: string | null }) => boolean> {
  if (isGlobalAdmin(user)) return () => true;

  const [space] = await db
    .select({ ownerUserId: spaces.ownerUserId })
    .from(spaces)
    .where(eq(spaces.id, spaceId))
    .limit(1);

  // Meme court-circuit que checkDocumentViewAccess : le proprietaire voit tout.
  if (space?.ownerUserId === user.id) return () => true;

  const spacePerm = await getSpacePermission(user.id, spaceId);

  return (doc) =>
    canViewByClassification((doc.classification || "internal") as ClassificationLevel, {
      isAuthenticated: true,
      isSpaceMember: !!spacePerm,
      isSpaceAdmin: spacePerm === "admin",
      isDocumentAuthor: doc.createdBy === user.id,
      userGlobalRole: user.globalRole,
    });
}

/**
 * Check if a user may create or modify content inside a space.
 *
 * Same rule as the routes that already guarded themselves (`!perm || perm === "viewer"`),
 * plus space ownership, which `checkDocumentEditAccess` already grants at the document
 * level. Membership of a team that merely owns the space is not enough : writing needs
 * an explicit `editor` or `admin` permission.
 */
export async function checkSpaceEditAccess(
  user: SessionUser,
  spaceId: string
): Promise<boolean> {
  if (isGlobalAdmin(user)) return true;

  const [space] = await db
    .select({ ownerUserId: spaces.ownerUserId })
    .from(spaces)
    .where(eq(spaces.id, spaceId))
    .limit(1);

  if (!space) return false;
  if (space.ownerUserId === user.id) return true;

  const perm = await getSpacePermission(user.id, spaceId);
  return !!perm && hasPermissionLevel(perm, "editor");
}

/**
 * Get the list of space IDs the user has access to (at least viewer).
 * Includes spaces owned by the user + spaces with explicit permissions.
 */
export async function getAccessibleSpaceIds(
  user: SessionUser
): Promise<string[]> {
  // Admins have access to everything — return empty to signal "no filter"
  if (user.globalRole === "admin" || user.globalRole === "super_admin") {
    return [];
  }

  // Spaces owned by user
  const ownedSpaces = await db
    .select({ id: spaces.id })
    .from(spaces)
    .where(eq(spaces.ownerUserId, user.id));

  // Spaces with explicit permission
  const permSpaces = await db
    .select({ spaceId: spacePermissions.spaceId })
    .from(spacePermissions)
    .where(eq(spacePermissions.userId, user.id));

  const ids = new Set<string>();
  for (const s of ownedSpaces) ids.add(s.id);
  for (const p of permSpaces) ids.add(p.spaceId);

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
