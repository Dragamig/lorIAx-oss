import type { RowChangeContext } from "./row-change-context";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Builds the history context of a row write request. Headers only drive the
 * label and the grouping of entries, never access control. An unknown
 * X-Row-Source is ignored (source ui), an invalid X-Batch-Id is replaced.
 */
export function rowContextFromRequest(
  request: Request,
  user: { id: string },
  opts: { allowImport?: boolean } = {}
): RowChangeContext {
  const isImport = !!opts.allowImport && request.headers.get("X-Row-Source") === "import";
  const headerBatch = request.headers.get("X-Batch-Id");
  const batchId = isImport && headerBatch && UUID_RE.test(headerBatch) ? headerBatch : crypto.randomUUID();
  return { source: isImport ? "import" : "ui", actorUserId: user.id, batchId };
}
