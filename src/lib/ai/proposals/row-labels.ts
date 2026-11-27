import type { ProposalPayload } from "./types";

function cellText(v: unknown): string {
  if (v === null || v === undefined || v === "") return "";
  if (typeof v === "object") return "";
  return String(v);
}

/** Libellés de lignes : colonnes clés pour une fusion, sinon première colonne de la base. */
export function buildRowLabels(payload: ProposalPayload, primaryColumnId: string | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  const put = (id: string, cells: Record<string, unknown>, cols: string[]) => {
    const label = cols.map((c) => cellText(cells[c])).filter(Boolean).join(", ");
    if (label) out[id] = label;
  };
  const primary = primaryColumnId ? [primaryColumnId] : [];
  if (payload.type === "merge_duplicates") {
    const cols = payload.keyColumnIds.length > 0 ? payload.keyColumnIds : primary;
    for (const g of payload.groups) {
      put(g.keepRowId, g.keepRow.cells, cols);
      for (const r of g.removedRows) put(r.id, r.cells, cols);
    }
  } else if (payload.type === "delete_rows") {
    for (const r of payload.rows) put(r.id, r.cells, primary);
  } else if (payload.type === "update_rows") {
    for (const c of payload.changes) put(c.rowId, c.before, primary);
  }
  return out;
}

