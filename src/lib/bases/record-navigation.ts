export interface RecordNav {
  /** Zero-based index of the current row in the list (or the anchor when out of list). */
  index: number;
  total: number;
  prevId: string | null;
  nextId: string | null;
  /** True when the current row is not (or no longer) in the list. */
  outOfList: boolean;
}

/**
 * Neighbours of the open record in the list of visible rows.
 * When the row is no longer in the list, navigation continues from the
 * last known position (lastIndex), clamped to the current list length.
 */
export function resolveRecordNav(
  rowIds: string[],
  currentId: string,
  lastIndex: number | null,
): RecordNav {
  const total = rowIds.length;
  const found = rowIds.indexOf(currentId);

  if (found !== -1) {
    return {
      index: found,
      total,
      prevId: rowIds[found - 1] ?? null,
      nextId: rowIds[found + 1] ?? null,
      outOfList: false,
    };
  }

  if (lastIndex === null) {
    return {
      index: 0,
      total,
      prevId: null,
      nextId: rowIds[0] ?? null,
      outOfList: true,
    };
  }

  const anchor = Math.min(lastIndex, total);
  return {
    index: anchor,
    total,
    prevId: rowIds[anchor - 1] ?? null,
    nextId: rowIds[anchor] ?? null,
    outOfList: true,
  };
}
