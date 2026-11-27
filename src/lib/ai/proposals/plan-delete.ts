import { loadRowsByIds } from "@/lib/ai/chat-tools/rows-loader";
import { computeFingerprint } from "./freshness";
import { assertRowCount, finishPlan, type ProposalPlan } from "./plan-shared";
import { ProposalPlanError } from "./types";

/** Planifie une suppression : les lignes sont snapshottées (cellules et position) pour l'annulation. */
export async function planDeleteRows(databaseId: string, rowIds: string[]): Promise<ProposalPlan> {
  const ids = [...new Set(rowIds)];
  assertRowCount(ids.length);
  const rows = await loadRowsByIds(databaseId, ids);
  if (rows.length !== ids.length) {
    throw new ProposalPlanError("unknown_row", "Une ou plusieurs lignes sont introuvables dans cette base");
  }
  const byId = new Map(rows.map((r) => [r.id, r]));
  const ordered = ids.map((id) => byId.get(id)!);
  const snapshots = ordered.map((r) => ({ id: r.id, cells: r.cells, position: r.position }));
  return finishPlan({ type: "delete_rows", rows: snapshots }, { rows: computeFingerprint(ordered) });
}
