const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Reads the `row` query param. Anything that is not a uuid is ignored,
 * so a malformed link falls back to the plain view.
 */
export function readRowParam(params: { get(name: string): string | null }): string | null {
  const raw = params.get("row");
  if (raw === null || !UUID_RE.test(raw)) return null;
  return raw.toLowerCase();
}

/** Sets (or removes, when rowId is null) the `row` param on a relative href. */
export function withRowParam(href: string, rowId: string | null): string {
  const url = new URL(href, "http://local");
  if (rowId === null) {
    url.searchParams.delete("row");
  } else {
    url.searchParams.set("row", rowId);
  }
  const query = url.searchParams.toString();
  return `${url.pathname}${query ? `?${query}` : ""}${url.hash}`;
}

export function viewRedirectUrl(args: {
  databaseId: string;
  viewId: string;
  spaceId: string;
  rowId: string | null;
}): string {
  const base = `/bases/${args.databaseId}/views/${args.viewId}?spaceId=${args.spaceId}`;
  return withRowParam(base, args.rowId);
}
