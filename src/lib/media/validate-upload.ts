import { fileTypeFromBuffer } from "file-type";

import { validateSvg } from "@/lib/images/validate-upload";
import { MAX_UPLOAD_BYTES, VIDEO_MAX_UPLOAD_BYTES } from "./upload-limits";

export { MAX_UPLOAD_BYTES, VIDEO_MAX_UPLOAD_BYTES };

const ALLOWED_EXTENSIONS = new Set([
  "pdf", "doc", "docx", "xls", "xlsx", "ppt", "pptx", "odt", "ods", "odp",
  "txt", "csv", "json", "xml", "yaml", "yml", "md",
  "png", "jpg", "jpeg", "gif", "webp", "svg", "bmp", "ico",
  "mp4", "webm", "mp3", "wav", "ogg",
  "zip", "tar", "gz",
]);

// Extensions texte que file-type ne peut pas détecter (pas de magic bytes)
const TEXT_EXTENSIONS = new Set(["txt", "csv", "json", "xml", "yaml", "yml", "md", "svg"]);

/** Type MIME imposé aux extensions texte : le type déclaré par le client n'est pas fiable. */
const TEXT_MIME_BY_EXT: Record<string, string> = {
  txt: "text/plain",
  csv: "text/csv",
  json: "application/json",
  xml: "application/xml",
  yaml: "application/yaml",
  yml: "application/yaml",
  md: "text/markdown",
  svg: "image/svg+xml",
};

/**
 * Type établi d'un fichier : pour une extension texte, dérivé de l'extension ;
 * sinon le type déclaré. À utiliser pour choisir limite et profil de validation.
 */
export function establishedTypeOf(file: { name: string; type: string }): string {
  const ext = file.name.split(".").pop()?.toLowerCase() || "";
  return TEXT_MIME_BY_EXT[ext] ?? file.type;
}

/** SEC-06 : empêche le path traversal et les caractères problématiques. */
export function sanitizeFilename(name: string): string {
  return (
    name
      .replace(/\.\.\//g, "")
      .replace(/\.\.\\/g, "")
      .replace(/[<>:"/\\|?*\x00-\x1F]/g, "_")
      .slice(0, 255)
      .replace(/^\.+/, "") || "fichier"
  );
}

/** Profil du banc de montage vidéo : règles historiques de /api/video/upload. */
export const VIDEO_ALLOWED_TYPES = new Set([
  "video/mp4", "video/quicktime", "video/webm", "video/x-msvideo", "video/x-matroska",
  "audio/mpeg", "audio/wav", "audio/aac", "audio/ogg",
  "audio/flac", "audio/x-flac", "audio/mp4", "audio/x-m4a", "audio/x-wav",
]);

export type ValidationProfile = "default" | "video";

export type UploadValidation =
  | { ok: true; ext: string; safeName: string; mime: string }
  | { ok: false; status: 400 | 413 | 415; error: string };

async function validateVideoUpload(
  file: { name: string; size: number; type: string },
  buffer: Buffer,
): Promise<UploadValidation> {
  if (!VIDEO_ALLOWED_TYPES.has(file.type)) {
    return { ok: false, status: 400, error: "Type de fichier non autorisé" };
  }
  if (file.size > VIDEO_MAX_UPLOAD_BYTES) {
    return { ok: false, status: 413, error: "Fichier trop volumineux (max 200 Mo)" };
  }
  // Magic bytes : le contenu réel doit être un média (anti-spoof d'extension).
  const detected = await fileTypeFromBuffer(buffer);
  if (!detected || !(detected.mime.startsWith("video/") || detected.mime.startsWith("audio/"))) {
    return { ok: false, status: 415, error: "Le contenu du fichier n'est pas un média reconnu" };
  }
  const nameExt = file.name.split(".").length > 1 ? file.name.split(".").pop()!.toLowerCase() : "";
  const ext = /^[a-z0-9]{1,8}$/.test(nameExt) ? nameExt : detected.ext;
  return { ok: true, ext, safeName: sanitizeFilename(file.name), mime: file.type };
}

export async function validateUpload(
  file: { name: string; size: number; type: string },
  buffer: Buffer,
  profile: ValidationProfile = "default",
): Promise<UploadValidation> {
  if (profile === "video") return validateVideoUpload(file, buffer);
  if (file.size > MAX_UPLOAD_BYTES) {
    return { ok: false, status: 413, error: "Fichier trop volumineux (max 50 Mo)" };
  }

  const ext = file.name.split(".").pop()?.toLowerCase() || "";
  if (!ALLOWED_EXTENSIONS.has(ext)) {
    return { ok: false, status: 400, error: `Extension .${ext} non autorisée` };
  }

  // H9 : le SVG est un document actif. Il saute le controle des octets magiques
  // (file-type ne le connait pas), donc son contenu est controle ici.
  if (ext === "svg") {
    const verdict = validateSvg(buffer);
    if (!verdict.ok) return { ok: false, status: 400, error: verdict.error };
  }

  let detectedMime: string | undefined = TEXT_MIME_BY_EXT[ext];
  // SEC-05 : magic bytes pour les fichiers binaires
  if (!TEXT_EXTENSIONS.has(ext)) {
    const detected = await fileTypeFromBuffer(buffer);
    if (!detected) {
      return { ok: false, status: 415, error: "Type de fichier non reconnu" };
    }
    const normalizedExt = ext === "jpg" ? "jpeg" : ext;
    const normalizedDetected = detected.ext === "jpg" ? "jpeg" : detected.ext;
    if (normalizedExt !== normalizedDetected) {
      return {
        ok: false,
        status: 400,
        error: `Type de fichier incohérent : extension .${ext} mais contenu détecté comme .${detected.ext}`,
      };
    }
    detectedMime = detected.mime;
  }

  return {
    ok: true,
    ext,
    safeName: sanitizeFilename(file.name),
    mime: TEXT_MIME_BY_EXT[ext] ?? (file.type || detectedMime || "application/octet-stream"),
  };
}
