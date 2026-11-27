import { validateUpload, type ValidationProfile } from "./validate-upload";
import { processImage, sha256Hex } from "./image-processing";
import { renderPdfFirstPage } from "./pdf-thumbnail";
import { kindFromMime } from "./kind";
import type { MediaKind } from "@/lib/db/schema";

export type PrepareResult =
  | {
      ok: true;
      mime: string;
      ext: string;
      safeName: string;
      kind: MediaKind;
      width: number | null;
      height: number | null;
      thumbnail: Buffer | null;
      pageCount: number | null;
      checksum: string;
      hasLocationExif: boolean;
    }
  | { ok: false; status: 400 | 413 | 415; error: string };

/**
 * Validation du fichier, type, dimensions, miniature et empreinte SHA-256.
 * Partagé par l'ingestion et le remplacement de version. Une image illisible
 * par sharp, un PDF illisible restent acceptés, sans miniature.
 */
export async function prepareMediaFile(
  file: { name: string; size: number; type: string },
  buffer: Buffer,
  profile: ValidationProfile,
): Promise<PrepareResult> {
  const valid = await validateUpload(file, buffer, profile);
  if (!valid.ok) return { ok: false, status: valid.status, error: valid.error };

  const kind = kindFromMime(valid.mime, valid.safeName);
  let hasLocationExif = false;
  let width: number | null = null;
  let height: number | null = null;
  let thumbnail: Buffer | null = null;
  let pageCount: number | null = null;
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

  if (kind === "pdf") {
    // Miniature de la 1re page : facultative, jamais bloquante (PDF chiffré, corrompu, trop lent).
    const page = await renderPdfFirstPage(buffer);
    if (page) {
      thumbnail = page.webp;
      pageCount = page.pageCount;
    }
  }

  return {
    ok: true,
    mime: valid.mime,
    ext: valid.ext,
    safeName: valid.safeName,
    kind,
    width,
    height,
    thumbnail,
    pageCount,
    checksum: sha256Hex(buffer),
    hasLocationExif,
  };
}
