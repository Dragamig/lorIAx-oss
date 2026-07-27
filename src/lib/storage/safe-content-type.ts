import { fileTypeFromBuffer } from "file-type";

/**
 * H9 : decision unique du type de contenu stocke sur S3.
 *
 * Deux chemins deposent des objets dans le bucket des pieces jointes :
 * `POST /api/attachments` (fichier televerse par un utilisateur) et
 * `downloadAndReupload` dans la synchronisation Airtable / Notion (corps recupere
 * sur une URL tierce, non authentifiee, saisie librement dans la base externe).
 * Les deux passent par cette regle, sans quoi le second rouvre exactement le
 * vecteur que le premier ferme : un serveur controle par l'attaquant annonce
 * `Content-Type: image/svg+xml` ou `text/html`, l'objet est stocke avec ce type,
 * puis distribue par URL presignee sur l'origine de stockage.
 *
 * Regle : le type stocke ne vient JAMAIS de l'appelant ni du serveur distant.
 * Il est deduit des octets reels pour les binaires, impose par extension pour le
 * texte, et neutralise pour les formats que le navigateur executerait au rendu.
 */

export const ALLOWED_UPLOAD_EXTENSIONS = new Set([
  "pdf", "doc", "docx", "xls", "xlsx", "ppt", "pptx", "odt", "ods", "odp",
  "txt", "csv", "json", "xml", "yaml", "yml", "md",
  "png", "jpg", "jpeg", "gif", "webp", "svg", "bmp", "ico",
  "mp4", "webm", "mp3", "wav", "ogg",
  "zip", "tar", "gz",
]);

/**
 * Extensions textuelles que `file-type` ne peut pas detecter, faute d'octets
 * magiques. `svg` n'y figure plus : le laisser ici lui faisait sauter tout
 * controle de contenu alors que c'est un document actif.
 */
const TEXT_EXTENSIONS = new Set(["txt", "csv", "json", "xml", "yaml", "yml", "md"]);

/**
 * Formats textuels que le navigateur peut executer s'il les rend en ligne
 * (SVG : balise script ; XML : feuille XSLT). Ils restent acceptes mais sont
 * stockes en binaire opaque, avec un `Content-Disposition: attachment` porte par
 * l'objet S3 lui-meme : une URL presignee ouverte directement sur l'origine de
 * stockage declenche un telechargement, jamais un rendu.
 */
const NEUTRALIZED_EXTENSIONS = new Set(["svg", "xml"]);

/** Content-Type sur impose par le serveur pour les extensions sans octets magiques. */
const TEXT_CONTENT_TYPES: Record<string, string> = {
  txt: "text/plain; charset=utf-8",
  csv: "text/csv; charset=utf-8",
  md: "text/plain; charset=utf-8",
  yaml: "text/plain; charset=utf-8",
  yml: "text/plain; charset=utf-8",
  json: "application/json; charset=utf-8",
};

export type SafeStorageType =
  | { ok: true; contentType: string; contentDisposition?: string }
  /** Extension hors de la liste blanche. */
  | { ok: false; reason: "extension" }
  /** Aucun type reconnaissable dans les octets d'un fichier cense etre binaire. */
  | { ok: false; reason: "unrecognized" }
  /** Octets magiques incoherents avec l'extension annoncee. */
  | { ok: false; reason: "mismatch"; detectedExt: string };

/** Extension normalisee d'un nom de fichier, chaine vide si absente. */
export function extensionOf(filename: string): string {
  const parts = filename.split(".");
  if (parts.length < 2) return "";
  return (parts.pop() ?? "").toLowerCase().trim();
}

/**
 * Type de contenu a stocker pour un fichier, ou motif de refus.
 * `buffer` doit contenir le fichier complet : la detection porte sur ses octets.
 */
export async function resolveSafeStorageType(
  ext: string,
  buffer: Buffer
): Promise<SafeStorageType> {
  if (!ALLOWED_UPLOAD_EXTENSIONS.has(ext)) {
    return { ok: false, reason: "extension" };
  }

  if (NEUTRALIZED_EXTENSIONS.has(ext)) {
    return {
      ok: true,
      contentType: "application/octet-stream",
      contentDisposition: "attachment",
    };
  }

  if (TEXT_EXTENSIONS.has(ext)) {
    return {
      ok: true,
      contentType: TEXT_CONTENT_TYPES[ext] ?? "application/octet-stream",
    };
  }

  // SEC-05 : verification des octets magiques pour les fichiers binaires
  const detected = await fileTypeFromBuffer(buffer);
  if (!detected) return { ok: false, reason: "unrecognized" };

  // Normaliser jpg/jpeg
  const normalizedExt = ext === "jpg" ? "jpeg" : ext;
  const normalizedDetected = detected.ext === "jpg" ? "jpeg" : detected.ext;

  if (normalizedExt !== normalizedDetected) {
    return { ok: false, reason: "mismatch", detectedExt: detected.ext };
  }

  // Type MIME issu des octets reels, pas de la declaration de l'appelant
  return { ok: true, contentType: detected.mime };
}
