import sharp from "sharp";
import type { Media } from "@/lib/db/schema";
import type { SessionUser } from "@/types";
import { validateImageUpload } from "@/lib/images/validate-upload";
import { MAX_OUTPUT_PIXELS, MAX_OUTPUT_SIDE } from "@/components/media/retouch/limits";
import { getMediaForAccess, getMediaFull, resolveMediaAccess } from "./access";
import { assertIngestTarget, ingestMedia } from "./ingest";
import { replaceMediaFile } from "./versions";
import { findDuplicates } from "./duplicates";
import { checkUploadQuota, type QuotaVerdict } from "./quota";
import { sha256Hex } from "./image-processing";

export type SaveRetouchInput = {
  user: SessionUser;
  orgId: string;
  sourceId: string;
  mode: "derived" | "version";
  spaceId: string | null;
  folderId?: string | null;
  name: string;
  expectedVersion?: number;
  comment?: string;
  file: { name: string; size: number; type: string };
  buffer: Buffer;
};

export type SaveRetouchResult =
  | { ok: true; media: Media; duplicate: boolean; quota: QuotaVerdict; /** Id de ligne de la version créée (mode version). */ versionId?: string }
  | {
      ok: false;
      status: 400 | 403 | 404 | 409 | 413 | 415 | 507 | 500;
      error: string;
      quota?: QuotaVerdict;
    };

const fail = (status: Extract<SaveRetouchResult, { ok: false }>["status"], error: string) =>
  ({ ok: false, status, error }) as const;

/**
 * Enregistre le fichier rendu par le retoucheur : dérivé lié à l'original
 * (`ingestMedia`) ou nouvelle version de l'original (`replaceMediaFile`).
 * Aucune règle d'accès propre : tout passe par les fonctions existantes.
 */
export async function saveRetouch(input: SaveRetouchInput): Promise<SaveRetouchResult> {
  const { user, orgId, sourceId, file, buffer } = input;

  // 1. Original : même organisation, hors corbeille, lisible, image. 404 muet sinon.
  const source = await getMediaForAccess(sourceId);
  const notFound = fail(404, "Média introuvable");
  if (!source || source.organizationId !== orgId || source.deletedAt) return notFound;
  const read = await resolveMediaAccess(user, source, "read", { orgId });
  if (!read.allowed) return notFound;
  const sourceMime = (source as { mimeType?: string }).mimeType;
  if (sourceMime !== undefined && !sourceMime.startsWith("image/")) return notFound;

  // 2. Fichier rendu : octets réels (SVG refusé), dimensions réelles plafonnées.
  const valid = await validateImageUpload(new File([new Uint8Array(buffer)], file.name, { type: file.type }));
  if (!valid.ok) return fail(valid.status as 400 | 415, valid.error);
  if (valid.contentType === "image/svg+xml") return fail(415, "SVG refusé en sortie de retouche");
  let width = 0;
  let height = 0;
  try {
    const meta = await sharp(valid.buffer).metadata();
    width = meta.width ?? 0;
    height = meta.height ?? 0;
  } catch {
    return fail(415, "Image illisible");
  }
  if (width < 1 || height < 1) return fail(415, "Image illisible");
  if (width > MAX_OUTPUT_SIDE || height > MAX_OUTPUT_SIDE || width * height > MAX_OUTPUT_PIXELS) {
    return fail(413, "Dimensions de sortie trop grandes");
  }

  // 3a. Nouvelle version de l'original
  if (input.mode === "version") {
    if (!input.expectedVersion) return fail(400, "Version attendue requise");
    const write = await resolveMediaAccess(user, source, "write", { orgId });
    if (!write.allowed) return fail(403, "Accès refusé");
    const r = await replaceMediaFile({
      user,
      orgId,
      mediaId: sourceId,
      expectedVersion: input.expectedVersion,
      comment: input.comment,
      file: { name: file.name, size: valid.buffer.length, type: valid.contentType },
      buffer: valid.buffer,
    });
    if (!r.ok) return { ok: false, status: r.status, error: r.error, ...(r.quota ? { quota: r.quota } : {}) };
    return { ok: true, media: r.media, duplicate: false, quota: r.quota, versionId: r.version.id };
  }

  // 3b. Dérivé : droit sur la cible d'abord (pas de fuite de doublon sans écriture)
  const target = await assertIngestTarget(user, orgId, input.spaceId, input.folderId);
  if (!target.ok) return fail(target.status, target.error);

  const sum = sha256Hex(valid.buffer);
  const hit = (await findDuplicates(user, orgId, [sum]))[sum];
  if (hit) {
    const existing = await getMediaFull(hit.id);
    if (existing) {
      return { ok: true, media: existing, duplicate: true, quota: await checkUploadQuota(orgId, 0) };
    }
  }

  const r = await ingestMedia({
    user,
    orgId,
    spaceId: input.spaceId,
    folderId: target.folderId,
    origin: "studio",
    sourceMediaId: sourceId,
    validation: "default",
    displayName: input.name,
    file: { name: file.name, size: valid.buffer.length, type: valid.contentType },
    buffer: valid.buffer,
  });
  if (!r.ok) return { ok: false, status: r.status, error: r.error, ...(r.quota ? { quota: r.quota } : {}) };
  return { ok: true, media: r.media, duplicate: false, quota: r.quota };
}
