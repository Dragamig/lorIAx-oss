/**
 * Sérialisation pure du bloc Fichier, partagée par l'éditeur (tiptap-markdown)
 * et le chemin collaboratif serveur (`atomic-markdown.ts`).
 *
 * Forme : `<div data-type="file-block" data-media-id=".." ...><a href="/api/media/<id>">nom</a></div>`.
 * Les attributs portent la vérité (échappés, retours à la ligne en entités) ;
 * le lien interne rend la référence lisible hors éditeur et visible de
 * l'extraction des usages (`extractMediaRefs`).
 */

export const FILE_BLOCK_UUID_RE =
  /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;

export interface FileBlockAttrs {
  mediaId: string;
  filename: string;
  mimeType: string;
  size: number;
  preview: boolean;
}

function escapeAttr(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\r/g, "&#13;")
    .replace(/\n/g, "&#10;");
}

function escapeText(value: string): string {
  return value
    .replace(/[\r\n]+/g, " ")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\[/g, "&#91;")
    .replace(/\]/g, "&#93;")
    .replace(/\*/g, "&#42;")
    .replace(/_/g, "&#95;")
    .replace(/`/g, "&#96;");
}

/** Valeurs normalisées d'un nœud (attributs possiblement absents ou nuls). */
export function normalizeFileBlockAttrs(raw: Record<string, unknown>): FileBlockAttrs | null {
  const mediaId = typeof raw.mediaId === "string" ? raw.mediaId.toLowerCase() : "";
  if (!FILE_BLOCK_UUID_RE.test(mediaId)) return null;
  const size = Number(raw.size);
  return {
    mediaId,
    filename: typeof raw.filename === "string" ? raw.filename : "",
    mimeType: typeof raw.mimeType === "string" ? raw.mimeType : "",
    size: Number.isFinite(size) && size >= 0 ? Math.floor(size) : 0,
    preview: raw.preview === true || raw.preview === "true",
  };
}

/** Balise Markdown du bloc ; chaîne vide si l'identifiant n'est pas un UUID. */
export function serializeFileBlock(raw: Record<string, unknown>): string {
  const a = normalizeFileBlockAttrs(raw);
  if (!a) return "";
  const parts = [
    `data-media-id="${a.mediaId}"`,
    `data-filename="${escapeAttr(a.filename)}"`,
    `data-mime-type="${escapeAttr(a.mimeType)}"`,
    `data-size="${a.size}"`,
    `data-preview="${a.preview ? "true" : "false"}"`,
    `data-type="file-block"`,
  ];
  const label = escapeText(a.filename || a.mediaId);
  return `<div ${parts.join(" ")}><a href="/api/media/${a.mediaId}">${label}</a></div>`;
}
