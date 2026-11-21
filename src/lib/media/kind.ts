import type { MediaKind } from "@/lib/db/schema";

// Référence croisée : ce mapping doit rester identique au CASE MIME vers
// media_kind de src/lib/db/migrations/0052_mediatheque.sql (copie et déclencheur).
export function kindFromMime(mime: string, _filename?: string): MediaKind {
  const m = (mime || "").toLowerCase();
  if (m.startsWith("image/")) return "image";
  if (m === "application/pdf") return "pdf";
  if (m.startsWith("video/")) return "video";
  if (m.startsWith("audio/")) return "audio";
  if (
    ["application/zip", "application/x-tar", "application/gzip", "application/x-gzip"].includes(m)
  ) {
    return "archive";
  }
  if (
    m.startsWith("text/") ||
    ["application/msword", "application/rtf", "application/json"].includes(m) ||
    m.startsWith("application/vnd.ms-") ||
    m.startsWith("application/vnd.openxmlformats-") ||
    m.startsWith("application/vnd.oasis.opendocument.")
  ) {
    return "document";
  }
  return "other";
}

const INLINE_IMAGES = new Set(["image/png", "image/jpeg", "image/gif", "image/webp", "image/avif"]);

/** Lecture inline autorisée : liste blanche. SVG et HTML restent en pièce jointe. */
export function isInlineSafe(mime: string): boolean {
  const m = (mime || "").toLowerCase();
  return (
    INLINE_IMAGES.has(m) || m === "application/pdf" || m.startsWith("audio/") || m.startsWith("video/")
  );
}
