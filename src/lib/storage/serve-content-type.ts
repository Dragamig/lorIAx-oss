import { isInlineSafe } from "@/lib/media/kind";

/**
 * H9 : decision unique du type et de la disposition RESTITUES pour un objet
 * stocke. Le type stocke peut venir du deposant ou d'un serveur distant (synchro
 * externe), donc il n'est jamais repris tel quel : le type servi est recompose
 * a partir de l'extension du nom de fichier (liste fermee), puis, a defaut, d'un
 * type stocke strictement valide ET present dans la liste blanche inline.
 * Tout le reste, dont SVG, HTML et XML (formats executables au rendu), sort en
 * `application/octet-stream` avec `attachment`. Les types inertes legitimes
 * (documents, texte, csv, json, zip) gardent leur vrai type, en pieces jointes.
 */

export interface ServedContentType {
  contentType: string;
  disposition: "inline" | "attachment";
}

const NEUTRAL: ServedContentType = {
  contentType: "application/octet-stream",
  disposition: "attachment",
};

/** Extensions dont le type est connu et inerte : rendu inline autorise. */
const INLINE_TYPE_BY_EXT: Record<string, string> = {
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  gif: "image/gif",
  webp: "image/webp",
  avif: "image/avif",
  pdf: "application/pdf",
  mp3: "audio/mpeg",
  wav: "audio/wav",
  ogg: "audio/ogg",
  mp4: "video/mp4",
  webm: "video/webm",
};

/** Extensions inertes : vrai type conserve, mais toujours en piece jointe. */
const ATTACHMENT_TYPE_BY_EXT: Record<string, string> = {
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  pptx: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  doc: "application/msword",
  xls: "application/vnd.ms-excel",
  ppt: "application/vnd.ms-powerpoint",
  odt: "application/vnd.oasis.opendocument.text",
  ods: "application/vnd.oasis.opendocument.spreadsheet",
  odp: "application/vnd.oasis.opendocument.presentation",
  rtf: "application/rtf",
  txt: "text/plain",
  csv: "text/csv",
  json: "application/json",
  md: "text/markdown",
  zip: "application/zip",
};

/** Extensions de contenu actif (rendu executable) : toujours neutralisees. */
const ACTIVE_EXT = new Set(["svg", "svgz", "html", "htm", "xhtml", "xml"]);

/** Type/sous-type strict : un seul couple, sans virgule ni parametre. */
const STRICT_MIME = /^[a-z0-9][a-z0-9!#$&^_.+-]*\/[a-z0-9][a-z0-9!#$&^_.+-]*$/;

function extensionOf(filename: string): string {
  const i = filename.lastIndexOf(".");
  return i < 0 ? "" : filename.slice(i + 1).toLowerCase().trim();
}

const ACTIVE_TYPES = new Set([
  "image/svg+xml",
  "text/html",
  "application/xhtml+xml",
  "text/xml",
  "application/xml",
]);

/** Types executables au rendu : liste exacte et suffixe +xml (jamais une sous-chaine, sinon OOXML). */
function isActiveType(base: string): boolean {
  return ACTIVE_TYPES.has(base) || base.endsWith("+xml");
}

/** Vrai si le type declare ou l'extension designe un contenu executable au rendu. */
export function isActiveContent(storedType: string, filename: string): boolean {
  const base = (storedType || "").split(";")[0].trim().toLowerCase();
  if (ACTIVE_EXT.has(extensionOf(filename)) || isActiveType(base)) return true;
  // Type mal forme (virgule, etc.) : on neutralise (echec ferme), y compris si une partie est active.
  if (base && !STRICT_MIME.test(base)) return true;
  return false;
}

export function serveContentType(storedType: string, filename: string): ServedContentType {
  const ext = extensionOf(filename);
  const fromExt = INLINE_TYPE_BY_EXT[ext];
  if (fromExt) return { contentType: fromExt, disposition: "inline" };
  if (ACTIVE_EXT.has(ext)) return { ...NEUTRAL };
  const inert = ATTACHMENT_TYPE_BY_EXT[ext];
  if (inert) return { contentType: inert, disposition: "attachment" };

  // Extension inconnue ou absente : le type stocke est conserve s'il est propre
  // (recompose sans ses parametres) et non actif ; inline seulement s'il est sur.
  const base = (storedType || "").split(";")[0].trim().toLowerCase();
  if (STRICT_MIME.test(base) && !isActiveType(base)) {
    return { contentType: base, disposition: isInlineSafe(base) ? "inline" : "attachment" };
  }
  return { ...NEUTRAL };
}
