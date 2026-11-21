// Pure logic of the Gallery view of /bases: cover column and cover URL.

interface ColumnLike {
  id: string;
  type: string;
}

/** First image column, or null: no cover is ever invented. */
export function pickCoverColumn<T extends ColumnLike>(columns: T[]): T | null {
  return columns.find((c) => c.type === "image") ?? null;
}

/** Usable cover URL of a cell (absolute http(s) or app-relative), else null. */
export function coverUrl(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const v = value.trim();
  return /^(https?:\/\/|\/(?!\/))/.test(v) ? v : null;
}
