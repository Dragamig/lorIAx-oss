import { extractExifText } from "./extract-exif";
import { extractOfficeText, type OfficeFormat } from "./extract-office";
import { extractPdfText } from "./extract-pdf";
import { extractSheetText, type SheetFormat } from "./extract-sheet";
import { MAX_EXTRACT_BYTES, MAX_TEXT_CHARS } from "./limits";
import { normalizeText } from "./xml-text";
import type { MediaTextSource } from "@/lib/db/schema-media-ai";

export type ExtractResult =
  | { ok: true; text: string; source: MediaTextSource; truncated: boolean }
  | { ok: false; reason: "unsupported" | "too_large" | "empty" | "error" };

type Format = "pdf" | OfficeFormat | SheetFormat | "txt" | "exif" | "transcript";

const BY_MIME: Record<string, Format> = {
  "application/pdf": "pdf",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document": "docx",
  "application/vnd.openxmlformats-officedocument.presentationml.presentation": "pptx",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": "xlsx",
  "application/vnd.oasis.opendocument.text": "odt",
  "application/vnd.oasis.opendocument.presentation": "odp",
  "text/csv": "csv",
  "application/csv": "csv",
  "text/plain": "txt",
  "text/markdown": "txt",
  "image/jpeg": "exif",
  "image/tiff": "exif",
  "image/heic": "exif",
  "image/heif": "exif",
  "image/webp": "exif",
};

const BY_EXT: Record<string, Format> = {
  pdf: "pdf",
  docx: "docx",
  pptx: "pptx",
  xlsx: "xlsx",
  odt: "odt",
  odp: "odp",
  csv: "csv",
  txt: "txt",
  md: "txt",
  markdown: "txt",
  jpg: "exif",
  jpeg: "exif",
  tif: "exif",
  tiff: "exif",
  heic: "exif",
  heif: "exif",
  webp: "exif",
};

function detectFormat(mimeType: string, filename: string): Format | null {
  const mime = (mimeType || "").toLowerCase().split(";")[0].trim();
  if (mime.startsWith("video/") || mime.startsWith("audio/")) return "transcript";
  const ext = /\.([a-z0-9]{1,10})$/i.exec(filename || "")?.[1]?.toLowerCase();
  // Type générique : l'extension décide ; sinon le type MIME connu l'emporte.
  if (!mime || mime === "application/octet-stream") return (ext && BY_EXT[ext]) || null;
  return BY_MIME[mime] ?? null;
}

const SOURCE: Record<Format, MediaTextSource> = {
  pdf: "pdf",
  docx: "office",
  odt: "office",
  pptx: "office",
  odp: "office",
  xlsx: "sheet",
  csv: "sheet",
  txt: "text",
  exif: "exif",
  transcript: "transcript",
};

/** Décide l'extracteur ; `null` = pas de mise en file (archive, .doc binaire, etc.). */
export function extractableKind(mimeType: string, filename: string): MediaTextSource | "transcript" | null {
  const f = detectFormat(mimeType, filename);
  return f ? SOURCE[f] : null;
}

const cap = (text: string, truncated: boolean) =>
  text.length > MAX_TEXT_CHARS
    ? { text: text.slice(0, MAX_TEXT_CHARS), truncated: true }
    : { text, truncated };

/** Extrait le texte d'un média ; jamais d'exception. La transcription est faite ailleurs. */
export async function extractText(input: {
  buffer: Buffer;
  mimeType: string;
  filename: string;
}): Promise<ExtractResult> {
  try {
    const format = detectFormat(input.mimeType, input.filename);
    if (!format || format === "transcript") return { ok: false, reason: "unsupported" };
    if (input.buffer.length > MAX_EXTRACT_BYTES) return { ok: false, reason: "too_large" };
    const source = SOURCE[format];

    let r: { text: string; truncated: boolean } | null;
    switch (format) {
      case "pdf": {
        const p = await extractPdfText(input.buffer);
        r = p && { text: p.text, truncated: p.truncated };
        break;
      }
      case "docx":
      case "odt":
      case "pptx":
      case "odp":
        r = await extractOfficeText(input.buffer, format);
        break;
      case "xlsx":
      case "csv":
        r = await extractSheetText(input.buffer, format);
        break;
      case "txt":
        r = { text: normalizeText(input.buffer.toString("utf8")), truncated: false };
        break;
      default: {
        const t = await extractExifText(input.buffer);
        r = t === null ? { text: "", truncated: false } : { text: t, truncated: false };
      }
    }
    if (!r) return { ok: false, reason: "error" };
    const out = cap(r.text, r.truncated);
    if (!out.text.trim()) return { ok: false, reason: "empty" };
    return { ok: true, text: out.text, source, truncated: out.truncated };
  } catch {
    return { ok: false, reason: "error" };
  }
}
