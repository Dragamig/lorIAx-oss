import { randomUUID } from "crypto";
import { and, eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { media, mediaFolders, mediaTagLinks, mediaVersions, type Media } from "@/lib/db/schema";
import logger from "@/lib/logger";
import { checkSpaceWriteAccess } from "@/lib/auth/check-access";
import { uploadFile } from "@/lib/storage/s3";
import { logActivity } from "@/lib/activity";
import type { SessionUser } from "@/types";
import type { ValidationProfile } from "./validate-upload";
import { prepareMediaFile } from "./prepare-file";
import { checkUploadQuota, type QuotaVerdict } from "./quota";
import { reserveMediaRow } from "./reserve";
import { canWriteLibrary } from "./folders";
import { ensureTags } from "./tags";
import { notifyQuotaThreshold } from "./notify";
import { emitMediaUploaded } from "./events";
import { enqueueMediaIndex } from "./ai/enqueue";
import { getMediaForAccess, resolveMediaAccess } from "./access";

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
  /**
   * Média dont celui-ci est dérivé (retouche). Doit être de la même organisation,
   * hors corbeille et lisible par l'appelant ; sinon 400 (refus fermé, sans
   * distinguer absent et interdit).
   */
  sourceMediaId?: string | null;
  /** Profil de validation : "default" (médiathèque) ou "video" (banc de montage). */
  validation?: ValidationProfile;
  /** Clé de stockage imposée (images du studio sous `studio/`). */
  storageKey?: string;
  /** Nom affiché stocké à la place du nom de fichier nettoyé. */
  displayName?: string;
  file: { name: string; size: number; type: string };
  buffer: Buffer;
};

export type IngestResult =
  | { ok: true; media: Media; quota: QuotaVerdict; hasLocationExif: boolean }
  | { ok: false; status: 400 | 403 | 409 | 413 | 415 | 500 | 507; error: string; quota?: QuotaVerdict };

export type IngestTargetResult =
  | { ok: true; folderId: string | null }
  | { ok: false; status: 400 | 403; error: string };

/**
 * Droit d'écriture sur l'espace (ou droit d'écriture sur la médiathèque hors espace : un viewer membre est refusé)
 * puis dossier de la même organisation. Aucune ligne créée. Partagé avec
 * l'envoi multipart.
 */
export async function assertIngestTarget(
  user: SessionUser,
  orgId: string,
  spaceId: string | null,
  rawFolderId?: string | null,
): Promise<IngestTargetResult> {
  if (spaceId) {
    if (!(await checkSpaceWriteAccess(user, spaceId, { orgId }))) {
      return { ok: false, status: 403, error: "Accès refusé à cet espace" };
    }
  } else if (!(await canWriteLibrary(user, orgId))) {
    return { ok: false, status: 403, error: "Accès refusé" };
  }

  // Dossier : de la même organisation, sinon 400
  const folderId = rawFolderId || null;
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
  return { ok: true, folderId };
}

/**
 * Ingestion d'un fichier : validation, droit d'écriture, quota sous verrou
 * consultatif par organisation, ligne `media` insérée AVANT l'envoi S3, puis
 * envoi. Aucune suppression d'objet : en cas d'échec S3, seule la ligne part.
 */
export async function ingestMedia(input: IngestInput): Promise<IngestResult> {
  const { user, orgId, spaceId, file, buffer } = input;

  // 1. Droit d'écriture et dossier, avant tout calcul coûteux
  const target = await assertIngestTarget(user, orgId, spaceId, input.folderId);
  if (!target.ok) return target;
  const folderId = target.folderId;

  // 1 bis. Média source : même organisation, hors corbeille, lisible par l'appelant
  let sourceMediaId: string | null = null;
  if (input.sourceMediaId) {
    const refused = { ok: false, status: 400, error: "Média source introuvable" } as const;
    if (!UUID_RE.test(input.sourceMediaId)) return refused;
    const source = await getMediaForAccess(input.sourceMediaId);
    if (!source || source.organizationId !== orgId || source.deletedAt) return refused;
    const verdict = await resolveMediaAccess(user, source, "read", { orgId });
    if (!verdict.allowed) return refused;
    sourceMediaId = source.id;
  }

  // 1 ter. Quota : pré-contrôle sans verrou sur la taille déclarée. Le contrôle
  // qui fait foi reste celui de la réservation, sous verrou.
  const precheck = await checkUploadQuota(orgId, file.size);
  if (!precheck.allowed) {
    return { ok: false, status: 507, error: "Quota de stockage atteint", quota: precheck };
  }

  // 2. Validation, type, miniature et empreinte
  const prepared = await prepareMediaFile(file, buffer, input.validation ?? "default");
  if (!prepared.ok) return { ok: false, status: prepared.status, error: prepared.error };
  const { kind, width, height, thumbnail, pageCount, hasLocationExif } = prepared;

  const key = input.storageKey ?? `${spaceId ?? "org-" + orgId}/${randomUUID()}.${prepared.ext}`;
  const thumbnailKey = thumbnail ? `${key}.thumb.webp` : null;

  // 3. Quota et insertion sous verrou consultatif (section critique partagée)
  const reserved = await reserveMediaRow({
    orgId,
    sizeBytes: file.size,
    values: {
      spaceId,
      folderId,
      documentId: input.documentId || null,
      filename: input.displayName ? input.displayName.slice(0, 255) : prepared.safeName,
      mimeType: prepared.mime,
      kind,
      origin: input.origin ?? "upload",
      sourceMediaId,
      storageKey: key,
      checksumSha256: prepared.checksum,
      width,
      height,
      thumbnailKey,
      pageCount,
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
    await uploadFile(key, buffer, prepared.mime);
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
      await db
        .update(mediaVersions)
        .set({ thumbnailKey: null })
        .where(and(eq(mediaVersions.mediaId, row.id), eq(mediaVersions.version, row.currentVersion)));
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

  // 6. Déclencheur d'automatisme « média ajouté » : jamais bloquant, jamais en échec.
  void emitMediaUploaded(row).catch(() => undefined);

  // 7. File d'indexation IA : ne lève jamais, n'annule jamais l'ingestion.
  await enqueueMediaIndex(row.id, "ingest").catch(() => undefined);

  return { ok: true, media: row, quota: outcome.quota, hasLocationExif };
}
