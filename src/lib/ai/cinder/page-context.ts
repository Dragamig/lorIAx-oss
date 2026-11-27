const MAX_LINE = 300;
const PREFIX = "Page courante : ";

function clean(value: unknown): string {
  if (typeof value !== "string") return "";
  return value.replace(/[\p{Cc}\p{Zl}\p{Zp}\s]+/gu, " ").trim();
}

/**
 * Builds a single-line page hint for the system prompt. Only `route` and
 * `title` are read, never document content.
 */
export function formatPageContext(raw: unknown): string {
  let route = "";
  let title = "";
  if (typeof raw === "string") {
    route = clean(raw);
  } else if (raw && typeof raw === "object" && !Array.isArray(raw)) {
    const o = raw as Record<string, unknown>;
    route = clean(o.route);
    title = clean(o.title);
  }
  if (!route && !title) return "";
  const body = route && title ? `${route} (${title})` : route || title;
  return (PREFIX + body).slice(0, MAX_LINE);
}
