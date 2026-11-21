import { randomUUID } from "crypto";
import { and, eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { media, mediaFolders, mediaTagLinks, type Media } from "@/lib/db/schema";
import logger from "@/lib/logger";
import { checkSpaceWriteAccess } from "@/lib/auth/check-access";
import { uploadFile } from "@/lib/storage/s3";
import { logActivity } from "@/lib/activity";
import type { SessionUser } from "@/types";
import { validateUpload, type ValidationProfile } from "./validate-upload";
import { processImage, sha256Hex } from "./image-processing";
import { kindFromMime } from "./kind";
import type { QuotaVerdict } from "./quota";
import { reserveMediaRow } from "./reserve";
import { isOrgAdminOrOwner } from "./access";
import { ensureTags } from "./tags";
import { notifyQuotaThreshold } from "./notify";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type MediaOrigin = (typeof media.$inferInsert)["origin"];

export type IngestInput = {
  user: SessionUser;
  orgId: string;
  spaceId: string | null;
  documentId?: string | null;
  /** Dossier de classement : doit appartenir à l'organisation (sinon 400). */
  folderId?: string | null;
  /** Libellés de tags liés après l'insertion ; un échec n'annule pas l'upload. */
  tags?: string[];
  origin?: MediaOrigin;
  /** Profil de validation : "default" (médiathèque) ou "video" (banc de montage). */
  validation?: ValidationProfile;
  /** Serveur seulement : un média sans espace n'exige pas un admin d'organisation. */
  allowOrgLevel?: boolean;
  /** Clé de stockage imposée (images du studio sous `studio/`). */
  storageKey?: string;
  /** Nom affiché stocké à la place du nom de fichier nettoyé. */
  displayName?: string;
  file: { name: string; size: number; type: string };
  buffer: Buffer;
};

export type IngestResult =
  | { ok: true; media: Media; quota: QuotaVerdict; hasLocationExif: boolean }
  | { ok: false; status: 400 | 403 | 413 | 415 | 500 | 507; error: string; quota?: QuotaVerdict };

/**
 * Ingestion d'un fichier : validation, droit d'écriture, quota sous verrou
 * consultatif par organisation, ligne `media` insérée AVANT l'envoi S3, puis
 * envoi. Aucune suppression d'objet : en cas d'échec S3, seule la ligne part.
 */
export async function ingestMedia(input: IngestInput): Promise<IngestResult> {
  const { user, orgId, spaceId, file, buffer } = input;

  // 1. Validation
  const valid = await validateUpload(file, buffer, input.validation ?? "default");
  if (!valid.ok) return { ok: false, status: valid.status, error: valid.error };

  // 2. Droit d'écriture
  if (spaceId) {
    if (!(await checkSpaceWriteAccess(user, spaceId, { orgId }))) {
      return { ok: false, status: 403, error: "Accès refusé à cet espace" };
    }
  } else if (!input.allowOrgLevel && !(await isOrgAdminOrOwner(user.id, orgId))) {
    return { ok: false, status: 403, error: "Accès refusé" };
  }

  // 2 bis. Dossier : de la même organisation, sinon 400 (aucune ligne créée)
  const folderId = input.folderId || null;
  if (folderId) {
    let found = false;
    if (UUID_RE.test(folderId)) {
      const rows = await db
        .select({ id: mediaFolders.id })
        .from(mediaFolders)
        .where(and(eq(mediaFolders.id, folderId), eq(mediaFolders.organizationId, orgId)));
      found = rows.length > 0;
    }
    if (!found) return { ok: false, status: 400, error: "Dossier introuvable" };
  }

  const kind = kindFromMime(valid.mime, valid.safeName);

  let hasLocationExif = false;
  let width: number | null = null;
  let height: number | null = null;
  let thumbnail: Buffer | null = null;
  if (kind === "image") {
    try {
      const processed = await processImage(buffer, valid.mime);
      width = processed.width;
      height = processed.height;
      thumbnail = processed.thumbnail;
      hasLocationExif = processed.hasLocationExif;
    } catch {
      // Image illisible par sharp : l'envoi continue sans miniature.
    }
  }

  const key = input.storageKey ?? `${spaceId ?? "org-" + orgId}/${randomUUID()}.${valid.ext}`;
  const thumbnailKey = thumbnail ? `${key}.thumb.webp` : null;

  // 3. Quota et insertion sous verrou consultatif (section critique partagée)
  const reserved = await reserveMediaRow({
    orgId,
    sizeBytes: file.size,
    values: {
      spaceId,
      folderId,
      documentId: input.documentId || null,
      filename: input.displayName ? input.displayName.slice(0, 255) : valid.safeName,
      mimeType: valid.mime,
      kind,
      origin: input.origin ?? "upload",
      storageKey: key,
      checksumSha256: sha256Hex(buffer),
      width,
      height,
      thumbnailKey,
      uploadedBy: user.id,
    },
  });
  if (!reserved.ok) {
    return { ok: false, status: reserved.status, error: reserved.error, quota: reserved.quota };
  }
  const outcome = { quota: reserved.quota };
  let row = reserved.media;

  // 4. Envoi S3 : l'original d'abord, la miniature ensuite
  try {
    await uploadFile(key, buffer, valid.mime);
  } catch {
    await db.delete(media).where(eq(media.id, row.id));
    return { ok: false, status: 500, error: "Échec de l'envoi du fichier" };
  }
  if (thumbnail && thumbnailKey) {
    try {
      await uploadFile(thumbnailKey, thumbnail, "image/webp");
    } catch {
      // La miniature est secondaire : le média reste utilisable sans.
      await db.update(media).set({ thumbnailKey: null }).where(eq(media.id, row.id));
      row = { ...row, thumbnailKey: null };
    }
  }

  // 4 bis. Tags : un échec de liaison ne fait pas échouer l'upload
  if (input.tags && input.tags.length > 0) {
    try {
      const tags = await ensureTags(orgId, input.tags);
      if (tags.length > 0) {
        await db
          .insert(mediaTagLinks)
          .values(tags.map((t) => ({ mediaId: row.id, tagId: t.id })))
          .onConflictDoNothing();
      }
    } catch (err) {
      logger.warn({ err, mediaId: row.id }, "Liaison des tags impossible à l'upload");
    }
  }

  // 4 ter. Quota : franchissement de 80 % ou 100 %, sans bloquer l'upload
  if (outcome.quota.limitBytes && outcome.quota.limitBytes > 0) {
    const before = (outcome.quota.usedBytes / outcome.quota.limitBytes) * 100;
    void notifyQuotaThreshold(orgId, before, outcome.quota.percentAfter).catch(() => undefined);
  }

  // 5. Journal d'activité
  await logActivity({
    userId: user.id,
    action: "upload",
    entityType: "media",
    entityId: row.id,
    metadata: { filename: row.filename, sizeBytes: row.sizeBytes, kind },
  });

  return { ok: true, media: row, quota: outcome.quota, hasLocationExif };
}
