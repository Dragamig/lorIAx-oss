import type { MediaKind } from "@/lib/db/schema";
import { listMedia, type MediaListItem } from "@/lib/media/list";
import type { SessionUser } from "@/types";

export const MEDIA_SEARCH_MIN_LENGTH = 2;
export const MEDIA_SEARCH_DEFAULT_LIMIT = 5;

export type MediaSearchMatch = "name" | "title" | "alt" | "tag" | "description";

export type MediaSearchHit = {
  id: string;
  filename: string;
  title: string | null;
  kind: MediaKind;
  thumbnailUrl: string | null;
  spaceName: string | null;
  snippet: string | null;
  matchedOn: MediaSearchMatch;
};

function has(value: string | null | undefined, needle: string): value is string {
  return !!value && value.toLowerCase().includes(needle);
}

function describeMatch(item: MediaListItem, q: string): Pick<MediaSearchHit, "snippet" | "matchedOn"> {
  const needle = q.toLowerCase();
  if (has(item.filename, needle)) return { matchedOn: "name", snippet: null };
  if (has(item.title, needle)) return { matchedOn: "title", snippet: item.title };
  if (has(item.altText, needle)) return { matchedOn: "alt", snippet: item.altText };
  const tag = item.tags.find((t) => has(t.label, needle));
  if (tag) return { matchedOn: "tag", snippet: tag.label };
  return { matchedOn: "description", snippet: null };
}

/**
 * Recherche de médias pour la recherche générale et la palette. Passe par
 * `listMedia` (vue « all » : médias hors corbeille, jugés sur le droit de
 * lecture, organisation courante) : une seule source de vérité de visibilité.
 */
export async function searchMedia(
  user: SessionUser,
  orgId: string,
  q: string,
  limit: number = MEDIA_SEARCH_DEFAULT_LIMIT
): Promise<MediaSearchHit[]> {
  const term = q.trim();
  if (term.length < MEDIA_SEARCH_MIN_LENGTH) return [];

  const { items } = await listMedia(user, orgId, {
    view: "all",
    q: term,
    kinds: [],
    tagIds: [],
    sort: "createdAt",
    dir: "desc",
    limit,
  });

  return items.map((item) => ({
    id: item.id,
    filename: item.filename,
    title: item.title,
    kind: item.kind,
    thumbnailUrl: item.thumbnailUrl,
    spaceName: item.spaceName,
    ...describeMatch(item, term),
  }));
}
