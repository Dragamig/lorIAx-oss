type ElementLike = { type?: string; isDeleted?: boolean; customData?: Record<string, unknown> | null };

/** Identifiants de médias des éléments `image` non supprimés d'un tableau blanc (`customData.mediaId`), dédoublonnés. */
export function collectWhiteboardMediaIds(elements: readonly ElementLike[]): string[] {
  const ids = new Set<string>();
  for (const el of elements) {
    if (el.type !== "image" || el.isDeleted) continue;
    const id = el.customData?.mediaId;
    if (typeof id === "string" && id) ids.add(id.toLowerCase());
  }
  return [...ids];
}
