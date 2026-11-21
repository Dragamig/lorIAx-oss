/**
 * Normaliseurs des valeurs de cellules de bases de données (image et pièces
 * jointes). Partagés entre l'interface et les scripts de réécriture : purs,
 * jamais d'exception, jamais de réécriture silencieuse de la valeur lue.
 */

const UUID = "[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}";
const MEDIA_URL_RE = new RegExp(`^/api/media/(${UUID})(?:[/?#].*)?$`);
const UUID_RE = new RegExp(`^${UUID}$`);
const ATTACHMENT_URL_PREFIX = "/api/attachments/";

/** Plafond de pièces jointes par cellule. */
export const MAX_ATTACHMENTS_PER_CELL = 20;

export type AttachmentValue = {
  mediaId: string;
  filename: string;
  mimeType: string;
  size: number;
};

export type LegacyAttachment = {
  key?: string;
  filename?: string;
  mimeType?: string;
  size?: number;
  mediaId?: string;
};

export type NormalizedAttachment =
  | { kind: "media"; value: AttachmentValue }
  | { kind: "legacy"; value: LegacyAttachment; resolvable: boolean };

export type ImageCellValue =
  | { kind: "media"; mediaId: string }
  | { kind: "external"; url: string }
  | { kind: "data"; url: string }
  | { kind: "legacyKey"; key: string }
  | { kind: "empty" }
  | { kind: "invalid" };

function str(v: unknown): string | undefined {
  return typeof v === "string" ? v : undefined;
}

function normalizeSize(v: unknown): number {
  const n = typeof v === "number" ? v : NaN;
  return Number.isFinite(n) && n > 0 ? n : 0;
}

function safeDecode(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

/**
 * Pièces jointes : forme cible `{ mediaId, ... }`, forme héritée `{ key, ... }`,
 * et objets sans `key` (non résolubles, conservés pour l'affichage du nom).
 * L'ordre est conservé ; les éléments qui ne sont pas des objets sont comptés
 * dans `invalid`.
 */
export function normalizeAttachments(value: unknown): {
  items: NormalizedAttachment[];
  invalid: number;
} {
  if (value === null || value === undefined) return { items: [], invalid: 0 };
  if (!Array.isArray(value)) return { items: [], invalid: 1 };

  const items: NormalizedAttachment[] = [];
  let invalid = 0;
  for (const raw of value) {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
      invalid++;
      continue;
    }
    const o = raw as Record<string, unknown>;
    const mediaId = str(o.mediaId);
    const filename = str(o.filename);
    const mimeType = str(o.mimeType);
    if (mediaId && UUID_RE.test(mediaId)) {
      items.push({
        kind: "media",
        value: {
          mediaId,
          filename: filename ?? "",
          mimeType: mimeType ?? "application/octet-stream",
          size: normalizeSize(o.size),
        },
      });
      continue;
    }
    const key = str(o.key);
    const hasKey = !!key && key.trim() !== "";
    const legacy: LegacyAttachment = {};
    if (hasKey) legacy.key = key;
    if (filename !== undefined) legacy.filename = filename;
    if (mimeType !== undefined) legacy.mimeType = mimeType;
    if ("size" in o) legacy.size = normalizeSize(o.size);
    items.push({ kind: "legacy", value: legacy, resolvable: hasKey });
  }
  return { items, invalid };
}

/** Cellule image : chaîne `/api/media/<uuid>`, clé héritée, URL externe ou `data:`. */
export function normalizeImageCell(value: unknown): ImageCellValue {
  if (value === null || value === undefined) return { kind: "empty" };
  if (typeof value !== "string") return { kind: "invalid" };
  const v = value.trim();
  if (v === "") return { kind: "empty" };

  const m = MEDIA_URL_RE.exec(v);
  if (m) return { kind: "media", mediaId: m[1].toLowerCase() };

  if (v.startsWith(ATTACHMENT_URL_PREFIX)) {
    const rest = v.slice(ATTACHMENT_URL_PREFIX.length).split(/[?#]/)[0];
    const key = safeDecode(rest);
    return key ? { kind: "legacyKey", key } : { kind: "invalid" };
  }

  if (/^data:image\/[a-z0-9.+-]+(;[^,]*)?,/i.test(v)) return { kind: "data", url: v };

  if (/^https?:\/\//i.test(v)) {
    try {
      new URL(v);
      return { kind: "external", url: v };
    } catch {
      return { kind: "invalid" };
    }
  }
  return { kind: "invalid" };
}
