import type { DesignDocument } from "./index";

const UUID = "[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}";
// Mêmes règles que extractMediaRefs (serveur) : pas d'URL absolue ni de chemin imbriqué.
const NOT_AFTER = "(?<![A-Za-z0-9._~%:\\-])";
const MEDIA_RE = new RegExp(`${NOT_AFTER}/api/(?:media|studio/images)/(${UUID})(?![0-9A-Za-z-])`, "g");

/** Identifiants des médias de la médiathèque référencés par toutes les pages d'un design. */
export function collectMediaIds(doc: Pick<DesignDocument, "pages"> | { pages?: unknown }): string[] {
  const text = JSON.stringify(doc.pages ?? []) ?? "";
  const ids = new Set<string>();
  for (const m of text.matchAll(MEDIA_RE)) ids.add(m[1].toLowerCase());
  return [...ids];
}
