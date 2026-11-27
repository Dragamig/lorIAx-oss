import { and, eq, or } from "drizzle-orm";
import { db } from "@/lib/db";
import {
  media,
  mediaVersions,
  mediaUsages,
  publicShares,
  documents,
  spaces,
  users,
  organizationMembers,
  type Media,
} from "@/lib/db/schema";
import { checkSpaceReadAccess, checkSpaceWriteAccess } from "@/lib/auth/check-access";
import { getRequestOrgId } from "@/lib/org/get-request-org";
import { isOrgMember } from "@/lib/org/resolve-request-org";
import type { SessionUser } from "@/types";

/**
 * Résolveur d'accès unique par média. Refus par défaut, règles évaluées dans
 * cet ordre (spec Médiathèque, section 6) :
 *
 * 1. le média appartient à l'organisation de la requête (aucun passe-droit
 *    admin global) ;
 * 2. média en corbeille : visible seulement de ceux qui peuvent l'écrire ;
 * 3. `space_id` renseigné : droits de l'espace (jamais le document hôte) ;
 * 4. `space_id` nul : auteur du téléversement ou admin/owner de l'organisation ;
 * 5. lien public : voir {@link resolvePublicMediaAccess}.
 *
 * Aucun appel à la permission d'espace brute : elle n'applique pas de filtre
 * d'organisation et renvoie "admin" à tout admin global.
 */

export type MediaAccessRow = Pick<
  Media,
  "id" | "organizationId" | "spaceId" | "uploadedBy" | "deletedAt" | "origin" | "mimeType"
>;
export type MediaAccessMode = "read" | "write";
export type MediaAccessResult =
  | { allowed: true }
  | { allowed: false; reason: "org" | "trash" | "space" | "orphan" };

const ACCESS_COLUMNS = {
  id: media.id,
  organizationId: media.organizationId,
  spaceId: media.spaceId,
  uploadedBy: media.uploadedBy,
  deletedAt: media.deletedAt,
  origin: media.origin,
  mimeType: media.mimeType,
};

/** Admin ou owner de l'organisation (appartenance réelle, sans passe-droit global). */
export async function isOrgAdminOrOwner(userId: string, orgId: string): Promise<boolean> {
  const [membership] = await db
    .select({ role: organizationMembers.role })
    .from(organizationMembers)
    .where(
      and(eq(organizationMembers.organizationId, orgId), eq(organizationMembers.userId, userId))
    )
    .limit(1);
  return !!membership && (membership.role === "admin" || membership.role === "owner");
}

/** Règle 4 : auteur du téléversement ou admin/owner de l'organisation. */
async function canAccessOrphan(user: SessionUser, row: MediaAccessRow): Promise<boolean> {
  if (user.id === row.uploadedBy) return true;
  return isOrgAdminOrOwner(user.id, row.organizationId);
}

export async function resolveMediaAccess(
  user: SessionUser,
  row: MediaAccessRow,
  mode: MediaAccessMode,
  opts?: { orgId?: string }
): Promise<MediaAccessResult> {
  // Règle 1 : organisation de la requête, ou organisation imposée (chemin
  // public : celle du document, jamais celle du sous-domaine appelé).
  const orgId = opts?.orgId ?? (await getRequestOrgId(user));
  if (!orgId || row.organizationId !== orgId) return { allowed: false, reason: "org" };

  // Règle 2 : la corbeille se juge sur le droit d'écriture, quel que soit le mode.
  if (row.deletedAt) {
    const canWrite = row.spaceId
      ? await checkSpaceWriteAccess(user, row.spaceId, { orgId })
      : await canAccessOrphan(user, row);
    return canWrite ? { allowed: true } : { allowed: false, reason: "trash" };
  }

  // Règle 3
  if (row.spaceId) {
    const ok =
      mode === "write"
        ? await checkSpaceWriteAccess(user, row.spaceId, { orgId })
        : await checkSpaceReadAccess(user, row.spaceId, { orgId });
    return ok ? { allowed: true } : { allowed: false, reason: "space" };
  }

  // Règle 4
  return (await canAccessOrphan(user, row))
    ? { allowed: true }
    : { allowed: false, reason: "orphan" };
}

export async function getMediaForAccess(id: string): Promise<MediaAccessRow | null> {
  const [row] = await db.select(ACCESS_COLUMNS).from(media).where(eq(media.id, id)).limit(1);
  return row ?? null;
}

export async function getMediaByStorageKey(key: string): Promise<MediaAccessRow | null> {
  const [row] = await db
    .select(ACCESS_COLUMNS)
    .from(media)
    .where(eq(media.storageKey, key))
    .limit(1);
  if (row) return row;
  // Ancienne version (objet ou miniature) : mêmes droits que le média parent.
  const [viaVersion] = await db
    .select(ACCESS_COLUMNS)
    .from(mediaVersions)
    .innerJoin(media, eq(media.id, mediaVersions.mediaId))
    .where(or(eq(mediaVersions.storageKey, key), eq(mediaVersions.thumbnailKey, key)))
    .limit(1);
  return viaVersion ?? null;
}

/**
 * Règle 5 : exception ciblée au refus par défaut. Évaluée à chaque requête,
 * sans cache. Toute condition manquante vaut refus.
 */
export async function resolvePublicMediaAccess(
  token: string,
  mediaId: string,
  now: Date = new Date()
): Promise<{ allowed: true; row: Media } | { allowed: false }> {
  const deny = { allowed: false } as const;

  const [share] = await db
    .select({
      documentId: publicShares.documentId,
      createdBy: publicShares.createdBy,
      expiresAt: publicShares.expiresAt,
      revokedAt: publicShares.revokedAt,
    })
    .from(publicShares)
    .where(eq(publicShares.token, token))
    .limit(1);
  if (!share || share.revokedAt) return deny;
  if (share.expiresAt && share.expiresAt.getTime() <= now.getTime()) return deny;

  const [usage] = await db
    .select({ id: mediaUsages.id })
    .from(mediaUsages)
    .where(
      and(
        eq(mediaUsages.mediaId, mediaId),
        eq(mediaUsages.targetType, "document"),
        eq(mediaUsages.targetId, share.documentId)
      )
    )
    .limit(1);
  if (!usage) return deny;

  const [row] = await db.select().from(media).where(eq(media.id, mediaId)).limit(1);
  if (!row || row.deletedAt) return deny;

  // Organisation du média = organisation du document (document -> espace).
  const [doc] = await db
    .select({ spaceId: documents.spaceId })
    .from(documents)
    .where(eq(documents.id, share.documentId))
    .limit(1);
  if (!doc) return deny;
  const [space] = await db
    .select({ organizationId: spaces.organizationId })
    .from(spaces)
    .where(eq(spaces.id, doc.spaceId))
    .limit(1);
  if (!space || space.organizationId !== row.organizationId) return deny;

  // Le créateur du partage doit encore pouvoir lire le média (règles 1 à 4),
  // sans contournement admin : appartenance réelle exigée, y compris pour un
  // rôle global qui franchirait la frontière d'organisation.
  const [creator] = await db
    .select({ id: users.id, globalRole: users.globalRole })
    .from(users)
    .where(eq(users.id, share.createdBy))
    .limit(1);
  if (!creator) return deny;
  if (!(await isOrgMember(creator.id, row.organizationId))) return deny;

  const creatorUser = {
    id: creator.id,
    email: "",
    name: "",
    globalRole: creator.globalRole,
    capabilities: [],
  } as unknown as SessionUser;
  const verdict = await resolveMediaAccess(creatorUser, row, "read", {
    orgId: space.organizationId,
  });
  if (!verdict.allowed) return deny;

  return { allowed: true, row };
}

/** Ligne complète (clés de stockage, nom, taille) pour la lecture en flux. */
export async function getMediaFull(id: string): Promise<Media | null> {
  const [row] = await db.select().from(media).where(eq(media.id, id)).limit(1);
  return row ?? null;
}
