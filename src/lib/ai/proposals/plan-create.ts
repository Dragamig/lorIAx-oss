import { assertRowCount, assertWritableCells, finishPlan, loadTypes, type ProposalPlan } from "./plan-shared";

/** Planifie une création : aucune ligne existante n'est concernée, donc aucune empreinte de fraîcheur. */
export async function planCreateRows(
  databaseId: string,
  rows: { cells: Record<string, unknown> }[],
): Promise<ProposalPlan> {
  assertRowCount(rows.length);
  const types = await loadTypes(databaseId);
  for (const r of rows) assertWritableCells(r.cells, types);
  return finishPlan(
    { type: "create_rows", rows: rows.map((r) => ({ cells: { ...r.cells } })) },
    { rows: [] },
  );
}
