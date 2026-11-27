import { createHash, randomUUID } from "crypto";
import { and, eq, lt, inArray } from "drizzle-orm";
import { fileTypeFromBuffer } from "file-type";
import { db } from "@/lib/db";
import { media, mediaMultipartUploads, mediaTagLinks, type MediaMultipartUpload } from "@/lib/db/schema";
import logger from "@/lib/logger";
import { logActivity } from "@/lib/activity";
import * as s3 from "@/lib/storage/s3";
import type { SessionUser } from "@/types";
import { assertIngestTarget, type IngestResult } from "./ingest";
import { checkUploadQuota } from "./quota";
import { lockOrgQuota, reserveMediaRow } from "./reserve";
import { kindFromMime } from "./kind";
import { notifyQuotaThreshold } from "./notify";
import { emitMediaUploaded } from "./events";
import { enqueueMediaIndex } from "./ai/enqueue";
import { sanitizeFilename, VIDEO_ALLOWED_TYPES } from "./validate-upload";
import { VIDEO_MAX_UPLOAD_BYTES } from "./upload-limits";
import { TagError, ensureTags, normalizeTagLabels } from "./tags";

export const MULTIPART_PART_SIZE = 16 * 1024 * 1024;
export const MULTIPART_MAX_BYTES = 5 * 1024 * 1024 * 1024;
export const MULTIPART_VALIDITY_MS = 24 * 60 * 60 * 1000;
export const MULTIPART_MAX_SIGN_PARTS = 20;
/** Sessions S3 sans ligne en base : annulées au-delà de ce délai. */
export const MULTIPART_ORPHAN_AGE_MS = 48 * 60 * 60 * 1000;

const VIDEO_EXTENSIONS = new Set([
  "mp4", "m4v", "mov", "webm", "avi", "mkv", "mp3", "wav", "aac", "ogg", "flac", "m4a",
]);

export class MultipartInputError extends Error {}

/** Message stable : les routes le traduisent en 404. */
export const MULTIPART_NOT_FOUND = "Envoi introuvable";

const UUID = "[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}";
const MULTIPART_KEY_RE = new RegExp(
  `^(?:${UUID}|org-${UUID})/${UUID}\\.(?:${[...VIDEO_EXTENSIONS].join("|")})$`,
  "i",
);

/** Clé telle que `openMultipart` la fabrique : `<espace|org-ID>/<uuid>.<ext vidéo>`. */
export function isMultipartServiceKey(key: string): boolean {
  return MULTIPART_KEY_RE.test(key);
}

type OpenInput = {
  spaceId: string | null;
  folderId?: string | null;
  name: string;
  size: number;
  type: string;
  tags?: string[];
};
type OpenResult =
  | { ok: true; uploadId: string; partSize: number; partCount: number }
  | { ok: false; status: 400 | 403 | 413 | 415 | 507; error: string };

export function multipartEnabled(): boolean {
  return Boolean(process.env.S3_PUBLIC_URL);
}

function partCountOf(row: Pick<MediaMultipartUpload, "sizeBytes" | "partSize">): number {
  return Math.ceil(row.sizeBytes / row.partSize);
}

/** Envoi appartenant à l'utilisateur et à l'organisation, sinon `null` (jamais d'indice sur l'existence). */
async function findOwn(user: SessionUser, orgId: string, uploadId: string): Promise<MediaMultipartUpload | null> {
  const [row] = await db
    .select()
    .from(mediaMultipartUploads)
    .where(
      and(
        eq(mediaMultipartUploads.id, uploadId),
        eq(mediaMultipartUploads.organizationId, orgId),
        eq(mediaMultipartUploads.userId, user.id),
      ),
    );
  return row ?? null;
}

async function findOwnOpen(user: SessionUser, orgId: string, uploadId: string): Promise<MediaMultipartUpload | null> {
  const row = await findOwn(user, orgId, uploadId);
  if (!row || row.status !== "open" || row.expiresAt.getTime() <= Date.now()) return null;
  return row;
}

/** Passage conditionnel d'un statut à un autre : `true` si cet appel a fait la transition. */
async function transition(id: string, from: string, to: string): Promise<boolean> {
  const changed = await db
    .update(mediaMultipartUploads)
    .set({ status: to })
    .where(and(eq(mediaMultipartUploads.id, id), eq(mediaMultipartUploads.status, from)))
    .returning({ id: mediaMultipartUploads.id });
  return changed.length > 0;
}

async function markAborted(id: string): Promise<void> {
  await db
    .update(mediaMultipartUploads)
    .set({ status: "aborted" })
    .where(
      and(eq(mediaMultipartUploads.id, id), inArray(mediaMultipartUploads.status, ["open", "completing", "aborting"])),
    );
}

async function mediaExistsForKey(key: string): Promise<boolean> {
  const rows = await db.select({ id: media.id }).from(media).where(eq(media.storageKey, key));
  return rows.length > 0;
}

/**
 * Annule la session S3 puis clôt la ligne. La ligne passe d'abord à `aborting`
 * (elle ne compte plus au quota et n'est plus reprenable), et n'est marquée
 * `aborted` qu'après un abandon S3 réussi : un échec la laisse à `aborting`, le
 * balayage la retente.
 */
async function discardUpload(row: MediaMultipartUpload): Promise<void> {
  await transition(row.id, "open", "aborting");
  await finishAbort(row);
}

async function finishAbort(row: MediaMultipartUpload): Promise<boolean> {
  try {
    await s3.abortMultipart(row.storageKey, row.s3UploadId);
  } catch (err) {
    logger.warn({ err, uploadId: row.id }, "Abandon multipart S3 impossible, nouvelle tentative au balayage");
    return false;
  }
  await markAborted(row.id);
  return true;
}

/**
 * Supprime l'objet déjà assemblé (échec à la finalisation) puis clôt l'envoi.
 * Jamais d'effacement si une ligne `media` référence la clé : l'objet serait
 * alors celui d'un média bien réel.
 */
async function discardCompletedObject(row: MediaMultipartUpload): Promise<void> {
  if (await mediaExistsForKey(row.storageKey)) {
    logger.warn({ uploadId: row.id }, "Objet multipart conservé : un média le référence");
    await transition(row.id, "completing", "completed");
    return;
  }
  try {
    await s3.deleteFile(row.storageKey);
  } catch (err) {
    logger.warn({ err, uploadId: row.id }, "Suppression de l'objet multipart impossible");
  }
  await markAborted(row.id);
}

/**
 * Ouvre un envoi : droits, type, taille bornée, puis quota sous le verrou
 * d'organisation (les envois ouverts comptent comme réservés). La clé S3 est
 * choisie ici, jamais par le client. Un envoi ouvert pour le même fichier par
 * le même utilisateur est repris au lieu d'être dupliqué.
 */
export async function openMultipart(user: SessionUser, orgId: string, input: OpenInput): Promise<OpenResult> {
  if (!multipartEnabled()) return { ok: false, status: 400, error: "Envoi direct indisponible" };
  if (!Number.isSafeInteger(input.size) || input.size <= 0) {
    return { ok: false, status: 400, error: "Taille invalide" };
  }
  if (input.size > MULTIPART_MAX_BYTES) {
    return { ok: false, status: 413, error: "Fichier trop volumineux (max 5 Go)" };
  }
  if (input.size <= VIDEO_MAX_UPLOAD_BYTES) {
    return { ok: false, status: 400, error: "Fichier de 200 Mo ou moins : envoi classique" };
  }
  if (!VIDEO_ALLOWED_TYPES.has(input.type)) {
    return { ok: false, status: 415, error: "Type de fichier non autorisé" };
  }
  const nameExt = (input.name.split(".").length > 1 ? input.name.split(".").pop()! : "").toLowerCase();
  if (!VIDEO_EXTENSIONS.has(nameExt)) {
    return { ok: false, status: 415, error: "Extension non autorisée" };
  }

  let tags: string[];
  try {
    tags = normalizeTagLabels(input.tags ?? []);
  } catch (err) {
    if (err instanceof TagError) return { ok: false, status: 400, error: err.message };
    throw err;
  }

  const target = await assertIngestTarget(user, orgId, input.spaceId, input.folderId);
  if (!target.ok) return target;
  const folderId = target.folderId;
  const filename = sanitizeFilename(input.name);

  const sameFile = and(
    eq(mediaMultipartUploads.organizationId, orgId),
    eq(mediaMultipartUploads.userId, user.id),
    eq(mediaMultipartUploads.status, "open"),
    eq(mediaMultipartUploads.filename, filename),
    eq(mediaMultipartUploads.sizeBytes, input.size),
  );
  const resumable = async (exec: Pick<typeof db, "select">): Promise<MediaMultipartUpload | null> => {
    const rows = await exec.select().from(mediaMultipartUploads).where(sameFile);
    const match = rows.find(
      (r) => r.expiresAt.getTime() > Date.now() && r.spaceId === input.spaceId && r.folderId === folderId && r.mimeType === input.type,
    );
    return match ?? null;
  };
  const asOpened = (r: MediaMultipartUpload): OpenResult => ({
    ok: true,
    uploadId: r.id,
    partSize: r.partSize,
    partCount: partCountOf(r),
  });

  // Reprise : les tags choisis cette fois remplacent ceux de l'ouverture précédente.
  const retag = async (r: MediaMultipartUpload) => {
    if (JSON.stringify(r.tags) !== JSON.stringify(tags)) {
      await db.update(mediaMultipartUploads).set({ tags }).where(eq(mediaMultipartUploads.id, r.id));
    }
    return asOpened(r);
  };

  const existing = await resumable(db);
  if (existing) return retag(existing);

  const storageKey = `${input.spaceId ?? "org-" + orgId}/${randomUUID()}.${nameExt}`;
  const s3UploadId = await s3.createMultipart(storageKey, input.type);

  const outcome = await db.transaction(async (tx) => {
    await lockOrgQuota(tx, orgId);
    const again = await resumable(tx as unknown as Pick<typeof db, "select">);
    if (again) return { kind: "existing" as const, row: again };
    const quota = await checkUploadQuota(orgId, input.size, tx);
    if (!quota.allowed) return { kind: "quota" as const };
    const [row] = await tx
      .insert(mediaMultipartUploads)
      .values({
        organizationId: orgId,
        userId: user.id,
        spaceId: input.spaceId,
        folderId,
        filename,
        mimeType: input.type,
        sizeBytes: input.size,
        partSize: MULTIPART_PART_SIZE,
        s3UploadId,
        storageKey,
        tags,
        expiresAt: new Date(Date.now() + MULTIPART_VALIDITY_MS),
      })
      .returning();
    return { kind: "created" as const, row };
  });

  if (outcome.kind === "created") return asOpened(outcome.row);
  // Session S3 créée pour rien (quota refusé, ou un envoi concurrent a gagné) : on la referme.
  await s3.abortMultipart(storageKey, s3UploadId).catch((err) =>
    logger.warn({ err }, "Abandon multipart S3 impossible"),
  );
  if (outcome.kind === "existing") return retag(outcome.row);
  return { ok: false, status: 507, error: "Quota de stockage atteint" };
}

/** URL signées de parts (20 au plus), `null` si l'envoi n'est pas celui de l'appelant ou n'est plus ouvert. */
export async function signParts(
  user: SessionUser,
  orgId: string,
  uploadId: string,
  partNumbers: number[],
): Promise<{ partNumber: number; url: string }[] | null> {
  const row = await findOwnOpen(user, orgId, uploadId);
  if (!row) return null;
  const count = partCountOf(row);
  const unique = [...new Set(partNumbers)];
  if (
    unique.length === 0 ||
    unique.length > MULTIPART_MAX_SIGN_PARTS ||
    unique.some((n) => !Number.isInteger(n) || n < 1 || n > count)
  ) {
    throw new MultipartInputError("Numéros de parts invalides");
  }
  return Promise.all(
    unique.map(async (partNumber) => ({
      partNumber,
      url: await s3.presignUploadPart(
        row.storageKey,
        row.s3UploadId,
        partNumber,
        Math.min(row.partSize, row.sizeBytes - (partNumber - 1) * row.partSize),
      ),
    })),
  );
}

export type UploadState =
  | { status: "open"; partSize: number; partCount: number; done: { partNumber: number; etag: string }[] }
  | { status: "completing" }
  | { status: "completed"; mediaId: string };

/**
 * État de l'envoi. Ouvert : parts reçues. En finalisation : statut seul (le
 * client attend). Terminé : identifiant du média, pour qu'un client qui a perdu
 * la réponse de `complete` connaisse l'issue. Abandonné, expiré ou étranger : `null`.
 */
export async function getUploadState(
  user: SessionUser,
  orgId: string,
  uploadId: string,
): Promise<UploadState | null> {
  const row = await findOwn(user, orgId, uploadId);
  if (!row) return null;
  if (row.status === "completing") return { status: "completing" };
  if (row.status === "completed") {
    const [m] = await db
      .select({ id: media.id })
      .from(media)
      .where(and(eq(media.storageKey, row.storageKey), eq(media.organizationId, orgId)));
    return m ? { status: "completed", mediaId: m.id } : null;
  }
  if (row.status !== "open" || row.expiresAt.getTime() <= Date.now()) return null;
  let done: { partNumber: number; etag: string }[] = [];
  try {
    done = (await s3.listUploadedParts(row.storageKey, row.s3UploadId)).map(({ partNumber, etag }) => ({
      partNumber,
      etag,
    }));
  } catch (err) {
    if ((err as { name?: string }).name !== "NoSuchUpload") throw err;
  }
  return { status: "open", partSize: row.partSize, partCount: partCountOf(row), done };
}

async function sha256OfObject(key: string): Promise<string> {
  const hash = createHash("sha256");
  const stream = await s3.getFileStream(key);
  for await (const chunk of stream) hash.update(chunk as Buffer);
  return hash.digest("hex");
}

async function existingResult(row: MediaMultipartUpload, orgId: string): Promise<IngestResult> {
  const [m] = await db
    .select()
    .from(media)
    .where(and(eq(media.storageKey, row.storageKey), eq(media.organizationId, orgId)));
  if (!m) return { ok: false, status: 500, error: "Envoi terminé sans média" };
  return { ok: true, media: m, quota: await checkUploadQuota(orgId, 0), hasLocationExif: false };
}

const FINALIZING: IngestResult = { ok: false, status: 409, error: "Finalisation en cours" };

/**
 * Finalise : assemblage S3, taille réelle contre la déclaration, premiers octets
 * (vidéo ou audio), SHA-256 en flux, puis ligne `media` sous le verrou du quota
 * (la réservation de l'envoi ne compte pas deux fois). Tout échec après
 * l'assemblage supprime l'objet et clôt l'envoi : jamais de ligne fantôme.
 * Le passage conditionnel `open` vers `completing` précède l'assemblage : un
 * appel concurrent (relance du client après un 504 du proxy) reçoit 409 ou le
 * média déjà créé, jamais une seconde finalisation. Un appel après succès rend
 * le même média.
 */
export async function completeMultipart(
  user: SessionUser,
  orgId: string,
  uploadId: string,
  parts: { partNumber: number; etag: string }[],
): Promise<IngestResult> {
  const row = await findOwn(user, orgId, uploadId);
  if (!row) return { ok: false, status: 400, error: MULTIPART_NOT_FOUND };
  if (row.status === "completed") return existingResult(row, orgId);
  if (row.status === "completing") return FINALIZING;
  if (row.status !== "open") return { ok: false, status: 400, error: "Envoi abandonné" };
  if (row.expiresAt.getTime() <= Date.now()) {
    await discardUpload(row);
    return { ok: false, status: 400, error: "Envoi expiré" };
  }

  const count = partCountOf(row);
  const numbers = new Set(parts.map((p) => p.partNumber));
  if (
    parts.length !== count ||
    numbers.size !== count ||
    parts.some((p) => !Number.isInteger(p.partNumber) || p.partNumber < 1 || p.partNumber > count || !p.etag)
  ) {
    return { ok: false, status: 400, error: "Parts incomplètes" };
  }

  // Droit d'écriture revérifié : il a pu être retiré pendant l'envoi.
  const target = await assertIngestTarget(user, orgId, row.spaceId, row.folderId);
  if (!target.ok) {
    await discardUpload(row);
    return target;
  }

  if (!(await transition(row.id, "open", "completing"))) {
    const fresh = await findOwn(user, orgId, uploadId);
    if (fresh?.status === "completed") return existingResult(fresh, orgId);
    if (fresh?.status === "completing") return FINALIZING;
    return { ok: false, status: 400, error: "Envoi abandonné" };
  }

  try {
    await s3.completeMultipart(row.storageKey, row.s3UploadId, parts);
  } catch (err) {
    // Rien n'est assemblé : l'envoi redevient repreneur.
    await transition(row.id, "completing", "open");
    logger.warn({ err, uploadId }, "Assemblage multipart refusé par S3");
    return { ok: false, status: 400, error: "Parts incomplètes ou invalides" };
  }

  try {
    const head = await s3.headObject(row.storageKey);
    if (!head || head.size !== row.sizeBytes) {
      await discardCompletedObject(row);
      return { ok: false, status: 400, error: "Taille du fichier différente de celle annoncée" };
    }

    const first = await s3.getObjectRange(row.storageKey, 0, 4099);
    const detected = await fileTypeFromBuffer(first);
    if (!detected || !(detected.mime.startsWith("video/") || detected.mime.startsWith("audio/"))) {
      await discardCompletedObject(row);
      return { ok: false, status: 415, error: "Le contenu du fichier n'est pas un média reconnu" };
    }

    const checksum = await sha256OfObject(row.storageKey);
    const reserved = await reserveMediaRow({
      orgId,
      sizeBytes: row.sizeBytes,
      excludeUploadId: row.id,
      values: {
        spaceId: row.spaceId,
        folderId: row.folderId,
        filename: sanitizeFilename(row.filename),
        mimeType: row.mimeType,
        kind: kindFromMime(row.mimeType),
        origin: "upload",
        storageKey: row.storageKey,
        checksumSha256: checksum,
        uploadedBy: user.id,
      },
      afterInsert: async (tx, inserted) => {
        const closed = await tx
          .update(mediaMultipartUploads)
          .set({ status: "completed" })
          .where(and(eq(mediaMultipartUploads.id, row.id), eq(mediaMultipartUploads.status, "completing")))
          .returning({ id: mediaMultipartUploads.id });
        if (closed.length === 0) throw new Error(`Envoi ${row.id} clos pendant la finalisation (média ${inserted.id})`);
      },
    });
    if (!reserved.ok) {
      await discardCompletedObject(row);
      return { ok: false, status: reserved.status, error: reserved.error, quota: reserved.quota };
    }

    if (row.tags.length > 0) {
      // Comme l'envoi classique : un échec de liaison n'annule pas l'envoi.
      try {
        const linked = await ensureTags(orgId, row.tags);
        if (linked.length > 0) {
          await db
            .insert(mediaTagLinks)
            .values(linked.map((t) => ({ mediaId: reserved.media.id, tagId: t.id })))
            .onConflictDoNothing();
        }
      } catch (err) {
        logger.warn({ err, mediaId: reserved.media.id }, "Liaison des tags impossible à l'envoi direct");
      }
    }

    const { quota } = reserved;
    if (quota.limitBytes && quota.limitBytes > 0) {
      const before = (quota.usedBytes / quota.limitBytes) * 100;
      void notifyQuotaThreshold(orgId, before, quota.percentAfter).catch(() => undefined);
    }
    await logActivity({
      userId: user.id,
      action: "upload",
      entityType: "media",
      entityId: reserved.media.id,
      metadata: { filename: reserved.media.filename, sizeBytes: reserved.media.sizeBytes, kind: reserved.media.kind },
    });
    void emitMediaUploaded(reserved.media).catch(() => undefined);
    await enqueueMediaIndex(reserved.media.id, "ingest").catch(() => undefined);
    return { ok: true, media: reserved.media, quota, hasLocationExif: false };
  } catch (err) {
    logger.error({ err, uploadId }, "Finalisation multipart en échec");
    await discardCompletedObject(row);
    return { ok: false, status: 500, error: "Échec de la finalisation du fichier" };
  }
}

/** Abandon par l'utilisateur : `false` si l'envoi n'est pas le sien ou n'est plus ouvert. */
export async function abortUpload(user: SessionUser, orgId: string, uploadId: string): Promise<boolean> {
  const row = await findOwn(user, orgId, uploadId);
  if (!row || row.status !== "open") return false;
  await discardUpload(row);
  return true;
}

/**
 * Nettoyage planifié : envois ouverts expirés (annulés côté S3 puis marqués),
 * puis sessions S3 sans ligne de plus de 48 h. Jamais un envoi récent ni complété.
 */
export async function abortStaleMultipartUploads(now: Date): Promise<{ aborted: number; orphans: number }> {
  const stale = await db
    .select()
    .from(mediaMultipartUploads)
    .where(and(eq(mediaMultipartUploads.status, "open"), lt(mediaMultipartUploads.expiresAt, now)));
  for (const row of stale) await discardUpload(row);

  // Abandons S3 restés en échec : retentés tant que la session existe.
  const pending = await db
    .select()
    .from(mediaMultipartUploads)
    .where(eq(mediaMultipartUploads.status, "aborting"));
  for (const row of pending) await finishAbort(row);

  // Finalisation figée (processus interrompu) et expirée : objet éventuel retiré faute de média.
  const stuck = await db
    .select()
    .from(mediaMultipartUploads)
    .where(and(eq(mediaMultipartUploads.status, "completing"), lt(mediaMultipartUploads.expiresAt, now)));
  for (const row of stuck) await discardCompletedObject(row);

  let orphans = 0;
  try {
    const sessions = await s3.listMultipartUploads();
    // Le bucket sert à d'autres usages : on ne touche qu'aux clés fabriquées par ce service.
    const old = sessions.filter(
      (u) => now.getTime() - u.initiated.getTime() > MULTIPART_ORPHAN_AGE_MS && isMultipartServiceKey(u.key),
    );
    if (old.length > 0) {
      // Seules les sessions encore vivantes sont épargnées : une ligne close dont la session S3 subsiste est retentée.
      const known = await db
        .select({ id: mediaMultipartUploads.s3UploadId })
        .from(mediaMultipartUploads)
        .where(
          and(
            inArray(mediaMultipartUploads.s3UploadId, old.map((u) => u.uploadId)),
            inArray(mediaMultipartUploads.status, ["open", "completing"]),
          ),
        );
      const knownIds = new Set(known.map((k) => k.id));
      for (const u of old) {
        if (knownIds.has(u.uploadId)) continue;
        try {
          await s3.abortMultipart(u.key, u.uploadId);
          orphans++;
        } catch (err) {
          logger.warn({ err, key: u.key }, "Abandon d'une session multipart orpheline impossible");
        }
      }
    }
  } catch (err) {
    logger.warn({ err }, "Balayage des sessions multipart orphelines impossible");
  }
  return { aborted: stale.length, orphans };
}
