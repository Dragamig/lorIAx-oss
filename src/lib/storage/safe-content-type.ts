import { fileTypeFromBuffer } from "file-type";

/**
 * H9 : decision unique du type de contenu stocke sur S3, et de celui restitue.
 *
 * Deux chemins deposent des objets dans le bucket des pieces jointes :
 * `POST /api/attachments` (fichier televerse par un utilisateur) et
 * `downloadAndReupload` dans la synchronisation Airtable / Notion (corps recupere
 * sur une URL tierce, non authentifiee, saisie librement dans la base externe).
 * Les deux passent par ce module, sans quoi le second rouvre exactement le vecteur
 * que le premier ferme : un serveur controle par l'attaquant annonce
 * `Content-Type: image/svg+xml` ou `text/html`, l'objet est stocke avec ce type,
 * puis distribue par URL presignee sur l'origine de stockage.
 *
 * Regle : le type stocke ne vient JAMAIS de l'appelant ni du serveur distant.
 * Il est deduit des octets reels pour les binaires, impose par extension pour le
 * texte, et neutralise pour les formats que le navigateur executerait au rendu.
 *
 * `presentationOverrides()` applique la meme regle a la RESTITUTION, pour les objets
 * deposes avant ce durcissement et qui portent encore un type declare par leur
 * deposant.
 */

export const ALLOWED_UPLOAD_EXTENSIONS = new Set([
  "pdf", "doc", "docx", "xls", "xlsx", "ppt", "pptx", "odt", "ods", "odp",
  "txt", "csv", "json", "xml", "yaml", "yml", "md",
  "png", "jpg", "jpeg", "gif", "webp", "svg", "bmp", "ico",
  // Formats produits par les mobiles et les appareils photo. Ils arrivent
  // couramment par la synchronisation Airtable / Notion : les exclure faisait
  // disparaitre des pieces jointes de la cellule sans le dire.
  "heic", "heif", "avif", "tif", "tiff",
  "mp4", "webm", "mp3", "wav", "ogg", "mov", "m4a", "m4v", "aac", "flac",
  "zip", "tar", "gz", "rar", "7z",
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

/**
 * Extensions equivalentes du point de vue du contenu. `file-type` ne connait qu'une
 * graphie par format : comparer sans normaliser rejetterait `.jpg`, `.tiff` ou
 * `.heif`, dont les octets sont detectes comme `jpeg`, `tif` et `heic`.
 */
const EXTENSION_ALIASES: Record<string, string> = {
  jpg: "jpeg",
  tiff: "tif",
  heif: "heic",
};

/**
 * Formats livres dans un conteneur generique, que `file-type` v21 ne sait pas
 * distinguer : les Office historiques sortent tous en `cfb` (OLE2), et une archive
 * OOXML ou ODF dont les entrees ne sont pas lisibles sort en `zip`. Sans cette
 * table, un `.doc` parfaitement legitime tombait en incoherence de type.
 */
const CONTAINER_FAMILIES: Record<string, Set<string>> = {
  cfb: new Set(["doc", "xls", "ppt"]),
  zip: new Set(["docx", "xlsx", "pptx", "odt", "ods", "odp"]),
};

/** Type MIME canonique des formats bureautiques livres en conteneur. */
const CONTAINER_MEMBER_MIME: Record<string, string> = {
  doc: "application/msword",
  xls: "application/vnd.ms-excel",
  ppt: "application/vnd.ms-powerpoint",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  pptx: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  odt: "application/vnd.oasis.opendocument.text",
  ods: "application/vnd.oasis.opendocument.spreadsheet",
  odp: "application/vnd.oasis.opendocument.presentation",
};

const NEUTRAL_TYPE = "application/octet-stream";

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

function canonicalExtension(ext: string): string {
  return EXTENSION_ALIASES[ext] ?? ext;
}

/**
 * Type de contenu a stocker pour un fichier dont le nom fait foi (televersement
 * utilisateur), ou motif de refus.
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
    return { ok: true, contentType: NEUTRAL_TYPE, contentDisposition: "attachment" };
  }

  if (TEXT_EXTENSIONS.has(ext)) {
    return { ok: true, contentType: TEXT_CONTENT_TYPES[ext] ?? NEUTRAL_TYPE };
  }

  // SEC-05 : verification des octets magiques pour les fichiers binaires
  const detected = await fileTypeFromBuffer(buffer);
  if (!detected) return { ok: false, reason: "unrecognized" };

  const normalizedExt = canonicalExtension(ext);
  const normalizedDetected = canonicalExtension(detected.ext);

  // Type MIME issu des octets reels, pas de la declaration de l'appelant
  if (normalizedExt === normalizedDetected) {
    return { ok: true, contentType: detected.mime };
  }

  // Conteneur generique : l'extension designe un membre connu de la famille
  if (CONTAINER_FAMILIES[normalizedDetected]?.has(normalizedExt)) {
    return {
      ok: true,
      contentType: CONTAINER_MEMBER_MIME[normalizedExt] ?? NEUTRAL_TYPE,
    };
  }

  return { ok: false, reason: "mismatch", detectedExt: detected.ext };
}

export interface DownloadedStorageType {
  /** Extension a donner a la cle S3. */
  ext: string;
  contentType: string;
  contentDisposition?: string;
  /** Vrai quand les octets n'ont pas pu etre types et que l'objet est neutralise. */
  neutralized: boolean;
}

/**
 * Type de contenu a stocker pour un corps recupere sur une URL tierce.
 *
 * Le nom de fichier n'est ici qu'un indice : pour une propriete Notion `files` en
 * mode *external* il vaut `f.name`, un libelle libre souvent depourvu d'extension.
 * La decision part donc des OCTETS, et le nom ne sert qu'a departager les formats
 * livres en conteneur ou depourvus d'octets magiques.
 *
 * Cette fonction ne refuse jamais : un contenu non typable est stocke en binaire
 * opaque plutot que rejete. Refuser reviendrait a vider silencieusement la cellule
 * de la ligne synchronisee, alors que la neutralisation suffit a fermer le vecteur.
 */
export async function resolveDownloadedStorageType(
  filenameHint: string,
  buffer: Buffer
): Promise<DownloadedStorageType> {
  const hintExt = canonicalExtension(extensionOf(filenameHint));
  const detected = await fileTypeFromBuffer(buffer);

  if (detected) {
    const detectedExt = canonicalExtension(detected.ext);

    // Conteneur generique : l'indice de nom permet de nommer le format reel
    if (CONTAINER_FAMILIES[detectedExt]?.has(hintExt)) {
      return {
        ext: hintExt,
        contentType: CONTAINER_MEMBER_MIME[hintExt] ?? NEUTRAL_TYPE,
        neutralized: false,
      };
    }

    if (
      ALLOWED_UPLOAD_EXTENSIONS.has(detectedExt) &&
      !NEUTRALIZED_EXTENSIONS.has(detectedExt)
    ) {
      return { ext: detectedExt, contentType: detected.mime, neutralized: false };
    }

    // Format binaire hors liste blanche : conserve, mais inerte.
    return {
      ext: detectedExt || "bin",
      contentType: NEUTRAL_TYPE,
      contentDisposition: "attachment",
      neutralized: true,
    };
  }

  // Aucun octet magique : seuls les formats textuels inertes gardent leur type.
  if (TEXT_EXTENSIONS.has(hintExt) && !NEUTRALIZED_EXTENSIONS.has(hintExt)) {
    return {
      ext: hintExt,
      contentType: TEXT_CONTENT_TYPES[hintExt] ?? NEUTRAL_TYPE,
      neutralized: false,
    };
  }

  return {
    ext: "bin",
    contentType: NEUTRAL_TYPE,
    contentDisposition: "attachment",
    neutralized: true,
  };
}

/**
 * Types que le navigateur peut rendre en ligne sans jamais executer de script dans
 * l'origine de stockage. Tout ce qui n'y figure pas est restitue en binaire opaque
 * et en piece jointe.
 */
const INLINE_SAFE_MIME = new Set([
  "image/png", "image/jpeg", "image/gif", "image/webp", "image/bmp",
  "image/x-icon", "image/vnd.microsoft.icon", "image/heic", "image/avif",
  "image/tiff",
  "video/mp4", "video/webm", "video/quicktime",
  "audio/mpeg", "audio/wav", "audio/ogg", "audio/x-m4a", "audio/mp4",
  "audio/aac", "audio/flac", "audio/x-flac",
  "application/pdf",
  "text/plain", "text/csv", "application/json",
]);

export interface PresentationOverrides {
  contentType: string;
  contentDisposition: "inline" | "attachment";
}

/**
 * Type et disposition a imposer A LA RESTITUTION d'un objet deja stocke.
 *
 * Les objets deposes AVANT ce durcissement portent encore le type declare par leur
 * deposant : un `image/svg+xml` d'epoque reste donc un XSS stocke vivant sur
 * l'origine S3, que le `nosniff` de la route proxy ne couvre pas puisque l'URL
 * presignee s'ouvre directement sur le stockage. Garage implemente les parametres
 * `response-*` de GetObject (`GetObjectOverrides`, `src/api/s3/get.rs`), la
 * restitution peut donc etre corrigee a la signature, sans reprise de donnees.
 */
export function presentationOverrides(storedMimeType: string): PresentationOverrides {
  const base = storedMimeType.split(";")[0].trim().toLowerCase();

  if (INLINE_SAFE_MIME.has(base)) {
    return { contentType: storedMimeType, contentDisposition: "inline" };
  }

  return { contentType: NEUTRAL_TYPE, contentDisposition: "attachment" };
}
