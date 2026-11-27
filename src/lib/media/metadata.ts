import { and, asc, eq, inArray, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import {
  media,
  mediaFolders,
  mediaTagLinks,
  mediaTags,
  spaces,
  users,
  type Media,
} from "@/lib/db/schema";
import { logActivity } from "@/lib/activity";
import { checkSpaceWriteAccess } from "@/lib/auth/check-access";
import { getMediaFull, isOrgAdminOrOwner, resolveMediaAccess } from "@/lib/media/access";
import { getRetouchLinks, type MediaListItem, type RetouchLinks } from "@/lib/media/list";
import { mediaThumbnailUrl } from "@/lib/media/urls";
import { MEDIA_TAGS_MAX, ensureTags } from "@/lib/media/tags";
import type { SessionUser } from "@/types";

export type MetadataErrorStatus = 400 | 403 | 404;

export class MetadataError extends Error {
  status: MetadataErrorStatus;
  constructor(status: MetadataErrorStatus, message: string) {
    super(message);
    this.name = "MetadataError";
    this.status = status;
  }
}

export type MediaOrigin = Media["origin"];

export type MediaDetail = MediaListItem & RetouchLinks & {
  description: string | null;
  checksumSha256: string | null;
  pageCount: number | null;
  origin: MediaOrigin;
  documentId: string | null;
  deletedBy: string | null;
  publicShared: boolean;
  canChangeSpace: boolean;
  canErase: boolean;
};

export type MediaPatch = {
  title?: string | null;
  altText?: string | null;
  description?: string | null;
  filename?: string;
  folderId?: string | null;
  tags?: string[];
  spaceId?: string | null;
};

export const FILENAME_MAX = 255;
export const TEXT_MAX = 500;
export const DESCRIPTION_MAX = 5000;

/** Retire séparateurs de chemin, caractères de contrôle et points de tête. */
export function sanitizeFilename(raw: string): string {
  return raw
    .replace(/[\u0000-\u001f\u007f]/g, "")
    .replace(/[\\/]/g, "-")
    .trim()
    .replace(/^\.+/, "")
    .trim();
}

function extOf(name: string): string {
  const i = name.lastIndexOf(".");
  return i > 0 && i < name.length - 1 ? name.slice(i) : "";
}

/** Nom nettoyé ; l'extension d'origine est conservée si l'utilisateur la retire. */
export function resolveFilename(raw: unknown, current: string): string {
  if (typeof raw !== "string") throw new MetadataError(400, "Nom de fichier invalide");
  let name = sanitizeFilename(raw);
  if (name.length === 0) throw new MetadataError(400, "Nom de fichier requis");
  if (extOf(name) === "") {
    const ext = extOf(current);
    if (ext) name = `${name}${ext}`;
  }
  if (name.length > FILENAME_MAX) {
    throw new MetadataError(400, `Nom de fichier trop long (${FILENAME_MAX} caractères au plus)`);
  }
  return name;
}

function cleanText(raw: unknown, max: number, label: string): string | null {
  if (raw === null) return null;
  if (typeof raw !== "string") throw new MetadataError(400, `${label} invalide`);
  const v = raw.trim();
  if (v.length > max) throw new MetadataError(400, `${label} trop long (${max} caractères au plus)`);
  return v.length === 0 ? null : v;
}

async function loadDetail(user: SessionUser, orgId: string, row: Media): Promise<MediaDetail> {
  const [[extra], tagRows, isAdmin, writeVerdict, links] = await Promise.all([
    db
      .select({
        spaceName: spaces.name,
        uploaderName: users.name,
        usageCount: sql<number>`(select count(*)::int from media_usages mu where mu.media_id = ${media.id})`,
        publicShared: sql<boolean>`exists (select 1 from media_usages mu inner join public_shares ps on ps.document_id = mu.target_id where mu.media_id = ${media.id} and mu.target_type = 'document' and ps.revoked_at is null and (ps.expires_at is null or ps.expires_at > now()))`,
      })
      .from(media)
      .leftJoin(spaces, eq(spaces.id, media.spaceId))
      .leftJoin(users, eq(users.id, media.uploadedBy))
      .where(eq(media.id, row.id))
      .limit(1),
    db
      .select({ id: mediaTags.id, label: mediaTags.label })
      .from(mediaTagLinks)
      .innerJoin(mediaTags, eq(mediaTags.id, mediaTagLinks.tagId))
      .where(eq(mediaTagLinks.mediaId, row.id))
      .orderBy(asc(mediaTags.label)),
    isOrgAdminOrOwner(user.id, orgId),
    resolveMediaAccess(user, row, "write", { orgId }),
    getRetouchLinks(user, orgId, row),
  ]);
  return {
    ...links,
    id: row.id,
    filename: row.filename,
    title: row.title,
    altText: row.altText,
    kind: row.kind,
    mimeType: row.mimeType,
    sizeBytes: Number(row.sizeBytes),
    width: row.width,
    height: row.height,
    spaceId: row.spaceId,
    spaceName: extra?.spaceName ?? null,
    folderId: row.folderId,
    uploadedBy: row.uploadedBy,
    uploaderName: extra?.uploaderName ?? "",
    createdAt: row.createdAt.toISOString(),
    deletedAt: row.deletedAt ? row.deletedAt.toISOString() : null,
    purgeAt: null,
    url: `/api/media/${row.id}`,
    thumbnailUrl: row.thumbnailKey ? mediaThumbnailUrl(row) : null,
    currentVersion: row.currentVersion,
    usageCount: Number(extra?.usageCount ?? 0),
    tags: tagRows,
    canWrite: writeVerdict.allowed,
    description: row.description,
    checksumSha256: row.checksumSha256,
    pageCount: row.pageCount,
    origin: row.origin,
    documentId: row.documentId,
    deletedBy: row.deletedBy,
    publicShared: !!extra?.publicShared,
    canChangeSpace: isAdmin,
    canErase: isAdmin,
  };
}

/** `null` si le média n'existe pas ou n'est pas lisible (réponse identique). */
export async function getMediaDetail(
  user: SessionUser,
  orgId: string,
  id: string
): Promise<MediaDetail | null> {
  const row = await getMediaFull(id);
  if (!row) return null;
  const verdict = await resolveMediaAccess(user, row, "read", { orgId });
  if (!verdict.allowed) return null;
  return loadDetail(user, orgId, row);
}

export async function updateMedia(
  user: SessionUser,
  orgId: string,
  id: string,
  patch: MediaPatch
): Promise<MediaDetail> {
  const row = await getMediaFull(id);
  if (!row) throw new MetadataError(404, "Média introuvable");
  const read = await resolveMediaAccess(user, row, "read", { orgId });
  if (!read.allowed) throw new MetadataError(404, "Média introuvable");
  const write = await resolveMediaAccess(user, row, "write", { orgId });
  if (!write.allowed) throw new MetadataError(403, "Droits insuffisants pour modifier ce média");

  const set: Partial<typeof media.$inferInsert> = {};
  const changed: string[] = [];

  if (patch.filename !== undefined) {
    const name = resolveFilename(patch.filename, row.filename);
    if (name !== row.filename) {
      set.filename = name;
      changed.push("filename");
    }
  }
  if (patch.title !== undefined) {
    const v = cleanText(patch.title, TEXT_MAX, "Titre");
    if (v !== row.title) {
      set.title = v;
      changed.push("title");
    }
  }
  if (patch.altText !== undefined) {
    const v = cleanText(patch.altText, TEXT_MAX, "Texte alternatif");
    if (v !== row.altText) {
      set.altText = v;
      changed.push("altText");
    }
  }
  if (patch.description !== undefined) {
    const v = cleanText(patch.description, DESCRIPTION_MAX, "Description");
    if (v !== row.description) {
      set.description = v;
      changed.push("description");
    }
  }

  if (patch.folderId !== undefined) {
    if (patch.folderId !== null) {
      const [folder] = await db
        .select({ id: mediaFolders.id })
        .from(mediaFolders)
        .where(and(eq(mediaFolders.id, patch.folderId), eq(mediaFolders.organizationId, orgId)))
        .limit(1);
      if (!folder) throw new MetadataError(400, "Dossier introuvable");
    }
    if (patch.folderId !== row.folderId) {
      set.folderId = patch.folderId;
      changed.push("folderId");
    }
  }

  if (patch.spaceId !== undefined && patch.spaceId !== row.spaceId) {
    if (!(await isOrgAdminOrOwner(user.id, orgId))) {
      throw new MetadataError(403, "Seul un administrateur peut changer l'espace d'un média");
    }
    if (patch.spaceId !== null) {
      const [target] = await db
        .select({ id: spaces.id })
        .from(spaces)
        .where(and(eq(spaces.id, patch.spaceId), eq(spaces.organizationId, orgId)))
        .limit(1);
      // Espace d'une autre organisation : 404, pour ne pas révéler son existence (ADR-079).
      if (!target) throw new MetadataError(404, "Espace introuvable");
    }
    if (patch.spaceId !== null && !(await checkSpaceWriteAccess(user, patch.spaceId, { orgId }))) {
      throw new MetadataError(403, "Droits d'écriture requis sur l'espace cible");
    }
    set.spaceId = patch.spaceId;
    changed.push("spaceId");
  }

  const tagRows = patch.tags !== undefined ? await ensureTags(orgId, patch.tags) : null;
  if (tagRows && tagRows.length > MEDIA_TAGS_MAX) {
    throw new MetadataError(400, `${MEDIA_TAGS_MAX} tags au plus par média`);
  }

  await db.transaction(async (tx) => {
    if (tagRows) {
      const existing = await tx
        .select({ tagId: mediaTagLinks.tagId })
        .from(mediaTagLinks)
        .where(eq(mediaTagLinks.mediaId, id));
      const have = new Set(existing.map((e) => e.tagId));
      const want = new Set(tagRows.map((t) => t.id));
      const toRemove = [...have].filter((t) => !want.has(t));
      const toAdd = [...want].filter((t) => !have.has(t));
      if (toRemove.length > 0) {
        await tx
          .delete(mediaTagLinks)
          .where(and(eq(mediaTagLinks.mediaId, id), inArray(mediaTagLinks.tagId, toRemove)));
      }
      if (toAdd.length > 0) {
        await tx
          .insert(mediaTagLinks)
          .values(toAdd.map((tagId) => ({ mediaId: id, tagId })))
          .onConflictDoNothing();
      }
      if (toRemove.length > 0 || toAdd.length > 0) changed.push("tags");
    }
    if (changed.length > 0) {
      await tx
        .update(media)
        .set({ ...set, updatedAt: new Date() })
        .where(and(eq(media.id, id), eq(media.organizationId, orgId)));
    }
  });

  if (changed.length > 0) {
    await logActivity({
      userId: user.id,
      action: "media.updated",
      entityType: "media",
      entityId: id,
      metadata: { fields: changed },
    });
  }

  const fresh = (await getMediaFull(id)) ?? row;
  return loadDetail(user, orgId, fresh);
}
