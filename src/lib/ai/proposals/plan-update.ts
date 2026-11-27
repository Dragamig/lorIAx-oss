import { loadRowsByIds } from "@/lib/ai/chat-tools/rows-loader";
import { computeFingerprint } from "./freshness";
import { assertRowCount, assertWritableCells, finishPlan, loadTypes, type ProposalPlan } from "./plan-shared";
import { ProposalPlanError } from "./types";

/** Planifie une mise à jour : `before` (valeurs actuelles des colonnes touchées) et `after` par ligne. */
export async function planUpdateRows(
  databaseId: string,
  modifications: { rowId: string; cells: Record<string, unknown> }[],
): Promise<ProposalPlan> {
  assertRowCount(modifications.length);
  const ids = modifications.map((m) => m.rowId);
  if (new Set(ids).size !== ids.length) {
    throw new ProposalPlanError("invalid_cells", "Une même ligne apparaît plusieurs fois");
  }
  const types = await loadTypes(databaseId);
  for (const m of modifications) assertWritableCells(m.cells, types);

  const rows = await loadRowsByIds(databaseId, ids);
  const byId = new Map(rows.map((r) => [r.id, r]));
  // Message identique pour une ligne inexistante, d'une autre base ou d'une autre organisation.
  if (ids.some((id) => !byId.has(id))) {
    throw new ProposalPlanError("unknown_row", "Une ou plusieurs lignes sont introuvables dans cette base");
  }

  const changes = modifications.map((m) => {
    const current = byId.get(m.rowId)!.cells;
    const before: Record<string, unknown> = {};
    for (const columnId of Object.keys(m.cells)) before[columnId] = current[columnId] ?? null;
    return { rowId: m.rowId, before, after: { ...m.cells } };
  });
  return finishPlan({ type: "update_rows", changes }, { rows: computeFingerprint(rows) });
}
