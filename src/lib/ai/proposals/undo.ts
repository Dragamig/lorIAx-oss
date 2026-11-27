import type { NextRequest } from "next/server";
import { and, eq, gt, inArray } from "drizzle-orm";
import { db } from "@/lib/db";
import { userDatabaseRows } from "@/lib/db/schema";
import { aiProposals } from "@/lib/db/schema-ai-proposals";
import { canTargetRelationDatabase } from "@/lib/databases/relation-target-access";
import { mergeDatabaseRowCells, type DbExecutor } from "@/lib/databases/row-writes";
import { deleteDatabaseRows, restoreDatabaseRows, RowBatchError } from "@/lib/databases/row-batch";
import type { RowChangeContext } from "@/lib/databases/row-change-context";
import { MediaCellError } from "@/lib/databases/attachment-cell-guard";
import { ToolAccessError } from "@/lib/ai/chat-tools/context";
import type { SessionUser } from "@/types";
import { assertProposalAccess } from "./access";
import { ApplyWriteError, assertRelationTargets } from "./apply";
import { computeFingerprint, isFresh } from "./freshness";
import { beforeOf, dispatchProposalRowEvents, type RowEvent } from "./row-events";
import { getOwnProposal } from "./store";
import type { UndoSnapshot } from "./types";

/** Fenêtre d'annulation : 24 h après l'application. */
export const UNDO_WINDOW_MS = 24 * 60 * 60 * 1000;

/** `refused` : aucune écriture, proposition inchangée. */
export type UndoOutcome = { status: "undone" | "refused"; message?: string };

const NOT_UNDOABLE = "Cette proposition ne peut pas être annulée";
const ALREADY_UNDONE = "Proposition déjà annulée";
const WINDOW_EXPIRED = "Le délai d'annulation de 24 h est dépassé";
const CHANGED_SINCE = "Des modifications ultérieures empêchent l'annulation";
const GENERIC_FAILURE = "L'annulation a échoué, aucune modification n'a été écrite";

/** Refus métier levé dans la transaction : provoque le rollback complet (y compris du passage à `undone`). */
class UndoRefusal extends Error {}

type Tx = DbExecutor;
type Cells = Record<string, unknown>;

async function currentFingerprint(tx: Tx, expectedIds: string[]) {
  const ids = [...expectedIds].sort();
  if (ids.length === 0) return { fingerprint: [], cells: new Map<string, Cells>() };
  // Verrou de lignes (ordre d'id croissant, comme l'apply) : une écriture concurrente attend, puis rend l'état différent.
  const rows = await tx
    .select({ id: userDatabaseRows.id, cells: userDatabaseRows.cells })
    .from(userDatabaseRows)
    .where(inArray(userDatabaseRows.id, ids))
    .orderBy(userDatabaseRows.id)
    .for("update");
  const mapped = rows.map((r) => ({ id: r.id, cells: (r.cells as Cells) ?? {} }));
  return { fingerprint: computeFingerprint(mapped), cells: new Map(mapped.map((r) => [r.id, r.cells])) };
}

async function revert(
  tx: Tx,
  databaseId: string,
  snap: UndoSnapshot,
  ctx: RowChangeContext,
  current: Map<string, Cells>,
): Promise<RowEvent[]> {
  const events: RowEvent[] = [];
  const holders = new Map<string, { databaseId: string; cells: Record<string, unknown> }>();
  for (const r of snap.repointedRelations ?? []) {
    const h = holders.get(r.rowId) ?? { databaseId: r.databaseId, cells: {} };
    h.cells[r.columnId] = r.before;
    holders.set(r.rowId, h);
  }
  const previous = snap.previousCells ?? [];
  try {
    await assertRelationTargets(
      tx,
      databaseId,
      previous.map((p) => p.cells),
      [...new Set([...holders.values()].map((h) => h.databaseId))],
      canTargetRelationDatabase,
    );
  } catch (e) {
    if (e instanceof ApplyWriteError) throw new UndoRefusal(e.message);
    throw e;
  }

  // Lignes supprimées d'abord : les cellules rétablies ci-dessous peuvent les référencer (même ids qu'avant).
  if (snap.restoredRows?.length) {
    const restored = await restoreDatabaseRows(
      databaseId,
      snap.restoredRows,
      tx,
      { canAccessRelationTarget: (targetId) => canTargetRelationDatabase(targetId) },
      ctx,
    );
    const back = new Set(restored.rows.map((r) => r.id));
    for (const r of snap.restoredRows) {
      if (back.has(r.id) && !restored.alreadyRestored) events.push({ databaseId, rowId: r.id, before: null, after: r.cells });
    }
  }
  for (const p of previous) {
    const updated = await mergeDatabaseRowCells(databaseId, p.rowId, p.cells, {}, tx, ctx);
    if (!updated) throw new UndoRefusal(CHANGED_SINCE);
    const after = (updated.cells as Cells | null) ?? {};
    events.push({ databaseId, rowId: p.rowId, before: beforeOf(current.get(p.rowId), after, {}), after });
  }
  for (const [rowId, h] of holders) {
    const updated = await mergeDatabaseRowCells(h.databaseId, rowId, h.cells, {}, tx, ctx);
    if (!updated) throw new UndoRefusal(CHANGED_SINCE);
    const after = (updated.cells as Cells | null) ?? {};
    events.push({ databaseId: h.databaseId, rowId, before: beforeOf(current.get(rowId), after, {}), after });
  }
  if (snap.createdRowIds?.length) {
    const removed = await deleteDatabaseRows(databaseId, snap.createdRowIds, tx, ctx);
    for (const r of removed) events.push({ databaseId, rowId: r.id, before: r.cells, after: null });
  }
  return events;
}

function refusalMessage(e: unknown): string {
  if (e instanceof UndoRefusal || e instanceof RowBatchError || e instanceof MediaCellError) return e.message;
  console.error("[ai-proposals] échec d'annulation", e);
  return GENERIC_FAILURE;
}

/**
 * Annule une proposition appliquée depuis moins de 24 h : accès `editor` revérifié, statut `applied` ET
 * `appliedAt` dans la fenêtre. Le passage `applied` vers `undone` est la première écriture de la transaction (verrou
 * de la ligne de proposition : un double clic n'écrit qu'une fois, le second est refusé). Les lignes touchées sont
 * verrouillées puis comparées à `postApply` : toute modification ultérieure refuse l'annulation sans rien écrire.
 * Historique `source: "ai"`, acteur humain, lot de la proposition. Tout refus ou erreur : rollback complet.
 * Lève ToolAccessError (inconnue, étrangère ou droits insuffisants).
 */
export async function undoProposal(args: {
  proposalId: string;
  user: SessionUser;
  orgId: string;
  req?: NextRequest;
}): Promise<UndoOutcome> {
  const { user, orgId } = args;
  const proposal = await getOwnProposal({ id: args.proposalId, userId: user.id, orgId });
  if (!proposal) throw new ToolAccessError("not_found");
  await assertProposalAccess({ user, orgId, proposal, minPermission: "editor", req: args.req });

  const ctx: RowChangeContext = {
    source: "ai",
    actorUserId: user.id,
    batchId: proposal.batchId,
    mediaGuard: { user, orgId },
  };
  try {
    const events = await db.transaction(async (tx) => {
      const now = new Date();
      const [claimed] = await tx
        .update(aiProposals)
        .set({ status: "undone", undoneAt: now })
        .where(
          and(
            eq(aiProposals.id, proposal.id),
            eq(aiProposals.userId, user.id),
            eq(aiProposals.orgId, orgId),
            eq(aiProposals.status, "applied"),
            gt(aiProposals.appliedAt, new Date(now.getTime() - UNDO_WINDOW_MS)),
          ),
        )
        .returning();
      if (!claimed) {
        const [cur] = await tx.select().from(aiProposals).where(eq(aiProposals.id, proposal.id));
        if (cur?.status === "undone") throw new UndoRefusal(ALREADY_UNDONE);
        if (cur?.status === "applied") throw new UndoRefusal(WINDOW_EXPIRED);
        throw new UndoRefusal(NOT_UNDOABLE);
      }
      const snap = claimed.undoSnapshot as UndoSnapshot | null;
      if (!snap) throw new UndoRefusal(NOT_UNDOABLE);

      const current = await currentFingerprint(tx, snap.postApply.map((r) => r.id));
      if (!isFresh({ rows: snap.postApply }, { rows: current.fingerprint })) throw new UndoRefusal(CHANGED_SINCE);

      return revert(tx, claimed.databaseId, snap, ctx, current.cells);
    });
    // Après le commit seulement : l'annulation se comporte comme la même modification manuelle.
    dispatchProposalRowEvents(events);
    return { status: "undone" };
  } catch (e) {
    return { status: "refused", message: refusalMessage(e) };
  }
}
