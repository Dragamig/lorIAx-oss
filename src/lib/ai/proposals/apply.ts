import type { NextRequest } from "next/server";
import { and, eq, inArray } from "drizzle-orm";
import { db } from "@/lib/db";
import { userDatabaseColumns, userDatabaseRows } from "@/lib/db/schema";
import { aiProposals, type AiProposalRow } from "@/lib/db/schema-ai-proposals";
import { canTargetRelationDatabase } from "@/lib/databases/relation-target-access";
import { createDatabaseRow, mergeDatabaseRowCells, type DbExecutor } from "@/lib/databases/row-writes";
import { deleteDatabaseRows, RowBatchError } from "@/lib/databases/row-batch";
import type { RowChangeContext } from "@/lib/databases/row-change-context";
import { MediaCellError } from "@/lib/databases/attachment-cell-guard";
import { ToolAccessError } from "@/lib/ai/chat-tools/context";
import type { SessionUser } from "@/types";
import { isProposalTypeAllowed, PROPOSAL_TYPE_DISABLED_MESSAGE } from "@/lib/ai/chat-actions-settings";
import { assertProposalAccess } from "./access";
import { computeFingerprint, isFresh } from "./freshness";
import { buildMergeWrites, computeMergeFreshness } from "./plan-merge";
import { beforeOf, dispatchProposalRowEvents, type RowEvent } from "./row-events";
import { claimForApply, getOwnProposal } from "./store";
import type { Freshness, ProposalPayload, RowFingerprint, UndoSnapshot } from "./types";

/** `overrides[groupId][columnId]` = rowId dont la valeur est retenue ; `excludedGroupIds` : groupes de fusion écartés. */
export type ApplyBody = { overrides?: Record<string, Record<string, string>>; excludedGroupIds?: string[] };

/** `refused` : proposition déjà en cours, déjà traitée ou non applicable (aucune écriture, état inchangé). */
export type ApplyOutcome = {
  status: "applied" | "stale" | "expired" | "failed" | "refused";
  summary?: string;
  message?: string;
};

/** Corps de requête incohérent avec la proposition (groupe inconnu, tout exclu) : à traduire en 400, rien n'est réclamé. */
export class ApplyBodyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ApplyBodyError";
  }
}

/** Échec d'application dont le message est sûr à montrer à l'utilisateur. */
export class ApplyWriteError extends Error {}

const GENERIC_FAILURE = "L'application a échoué, aucune modification n'a été écrite";
const REFUSED_MESSAGE = "Proposition déjà traitée ou en cours d'application";
type MergePayload = Extract<ProposalPayload, { type: "merge_duplicates" }>;
type Tx = DbExecutor;
type Written = { undo: Omit<UndoSnapshot, "postApply">; touchedIds: string[]; summary: string; events: RowEvent[] };
type Cells = Record<string, unknown>;

function plural(n: number, one: string, many: string): string {
  return `${n} ${n === 1 ? one : many}`;
}

function validateBody(payload: ProposalPayload, body?: ApplyBody): void {
  if (!body) return;
  if (payload.type !== "merge_duplicates") {
    if (body.excludedGroupIds?.length || (body.overrides && Object.keys(body.overrides).length)) {
      throw new ApplyBodyError("Cette proposition n'accepte ni arbitrage ni exclusion");
    }
    return;
  }
  const ids = new Set(payload.groups.map((g) => g.groupId));
  const unknown = [...(body.excludedGroupIds ?? []), ...Object.keys(body.overrides ?? {})].some((id) => !ids.has(id));
  if (unknown) throw new ApplyBodyError("Groupe de doublons inconnu");
  const excluded = new Set(body.excludedGroupIds ?? []);
  if (payload.groups.every((g) => g.excluded || excluded.has(g.groupId))) {
    throw new ApplyBodyError("Aucun groupe à fusionner");
  }
}

/**
 * Verrouille (FOR UPDATE, ordre d'id croissant) les lignes de l'empreinte, y compris les lignes porteuses d'autres
 * bases : toute écriture concurrente attend ce verrou puis, une fois validée, rend la proposition périmée.
 * Une ligne qui REJOINT un groupe (insertion) n'est pas verrouillable : elle est couverte par la recomparaison
 * du compte `databaseRowCountForKey`, faite sous verrou.
 */
async function lockFingerprintRows(tx: Tx, expected: Freshness): Promise<Map<string, Cells>> {
  const ids = expected.rows.map((r) => r.id).sort();
  if (ids.length === 0) return new Map();
  const locked = await tx
    .select({ id: userDatabaseRows.id, cells: userDatabaseRows.cells })
    .from(userDatabaseRows)
    .where(inArray(userDatabaseRows.id, ids))
    .orderBy(userDatabaseRows.id)
    .for("update");
  return new Map(locked.map((r) => [r.id, (r.cells as Cells | null) ?? {}]));
}

async function currentFreshness(tx: Tx, proposal: AiProposalRow, payload: ProposalPayload): Promise<Freshness> {
  if (payload.type === "merge_duplicates") return computeMergeFreshness(proposal.databaseId, payload);
  const expected = proposal.freshness as Freshness;
  if (expected.rows.length === 0) return { rows: [] };
  const rows = await tx
    .select({ id: userDatabaseRows.id, cells: userDatabaseRows.cells })
    .from(userDatabaseRows)
    .where(
      and(
        eq(userDatabaseRows.databaseId, proposal.databaseId),
        inArray(userDatabaseRows.id, expected.rows.map((r) => r.id)),
      ),
    );
  return { rows: computeFingerprint(rows.map((r) => ({ id: r.id, cells: (r.cells as Record<string, unknown>) ?? {} }))) };
}

async function fingerprintRows(tx: Tx, ids: string[]): Promise<RowFingerprint[]> {
  if (ids.length === 0) return [];
  const rows = await tx
    .select({ id: userDatabaseRows.id, cells: userDatabaseRows.cells })
    .from(userDatabaseRows)
    .where(inArray(userDatabaseRows.id, ids));
  return computeFingerprint(rows.map((r) => ({ id: r.id, cells: (r.cells as Record<string, unknown>) ?? {} })));
}

/** Les bases cibles des relations écrites doivent rester modifiables par l'utilisateur (C10), sinon l'application échoue. */
export async function assertRelationTargets(
  tx: Tx,
  databaseId: string,
  writes: Record<string, unknown>[],
  holderDatabaseIds: string[],
  canAccess: (id: string) => Promise<boolean>,
): Promise<void> {
  const checked = new Map<string, boolean>([[databaseId, true]]);
  const ok = async (id: string) => {
    if (!checked.has(id)) checked.set(id, await canAccess(id));
    return checked.get(id)!;
  };
  const written = new Set(writes.flatMap((c) => Object.keys(c)));
  if (written.size > 0) {
    const cols = await tx
      .select({ id: userDatabaseColumns.id, config: userDatabaseColumns.config })
      .from(userDatabaseColumns)
      .where(and(eq(userDatabaseColumns.databaseId, databaseId), eq(userDatabaseColumns.type, "relation")));
    for (const c of cols) {
      const target = (c.config as Record<string, unknown> | null)?.targetDatabaseId;
      if (written.has(c.id) && typeof target === "string" && !(await ok(target))) {
        throw new ApplyWriteError("Accès refusé à une base liée");
      }
    }
  }
  for (const id of holderDatabaseIds) {
    if (!(await ok(id))) throw new ApplyWriteError("Accès refusé à une base liée");
  }
}

async function writeMerge(
  tx: Tx,
  proposal: AiProposalRow,
  payload: MergePayload,
  body: ApplyBody | undefined,
  ctx: RowChangeContext,
  canAccess: (id: string) => Promise<boolean>,
  current: Map<string, Cells>,
): Promise<Written> {
  const excluded = new Set(body?.excludedGroupIds ?? []);
  const retained: MergePayload = {
    ...payload,
    groups: payload.groups.map((g) => (excluded.has(g.groupId) ? { ...g, excluded: true } : g)),
  };
  // Seule la sortie de buildMergeWrites s'écrit : jamais les `after` stockés tels quels.
  const w = buildMergeWrites(retained, body?.overrides);
  const keeps = w.keeps.filter((k) => Object.keys(k.after).length > 0);
  const holders = new Map<string, { databaseId: string; cells: Record<string, unknown> }>();
  for (const r of w.repoints) {
    const h = holders.get(r.rowId) ?? { databaseId: r.databaseId, cells: {} };
    h.cells[r.columnId] = r.after;
    holders.set(r.rowId, h);
  }
  await assertRelationTargets(
    tx,
    proposal.databaseId,
    keeps.map((k) => k.after),
    [...new Set([...holders.values()].map((h) => h.databaseId))],
    canAccess,
  );

  const events: RowEvent[] = [];
  for (const k of keeps) {
    const updated = await mergeDatabaseRowCells(proposal.databaseId, k.rowId, k.after, {}, tx, ctx);
    if (!updated) throw new ApplyWriteError("Une ligne conservée a disparu");
    const after = (updated.cells as Cells | null) ?? {};
    events.push({ databaseId: proposal.databaseId, rowId: k.rowId, before: beforeOf(current.get(k.rowId), after, k.before), after });
  }
  for (const [rowId, h] of holders) {
    const updated = await mergeDatabaseRowCells(h.databaseId, rowId, h.cells, {}, tx, ctx);
    if (!updated) throw new ApplyWriteError("Une ligne liée a disparu");
    const after = (updated.cells as Cells | null) ?? {};
    const touchedBefore = Object.fromEntries(
      w.repoints.filter((r) => r.rowId === rowId).map((r) => [r.columnId, r.before]),
    );
    events.push({ databaseId: h.databaseId, rowId, before: beforeOf(current.get(rowId), after, touchedBefore), after });
  }
  const removed = w.removeRowIds.length ? await deleteDatabaseRows(proposal.databaseId, w.removeRowIds, tx, ctx) : [];
  for (const r of removed) events.push({ databaseId: proposal.databaseId, rowId: r.id, before: r.cells, after: null });
  return {
    undo: {
      restoredRows: removed,
      previousCells: keeps.map((k) => ({ rowId: k.rowId, cells: k.before })),
      repointedRelations: w.repoints.map((r) => ({
        databaseId: r.databaseId,
        rowId: r.rowId,
        columnId: r.columnId,
        before: r.before,
      })),
    },
    touchedIds: [...keeps.map((k) => k.rowId), ...holders.keys()],
    summary: `${plural(keeps.length, "groupe fusionné", "groupes fusionnés")}, ${plural(removed.length, "ligne retirée", "lignes retirées")}`,
    events,
  };
}

async function writeProposal(
  tx: Tx,
  proposal: AiProposalRow,
  body: ApplyBody | undefined,
  ctx: RowChangeContext,
  canAccess: (id: string) => Promise<boolean>,
  current: Map<string, Cells>,
): Promise<Written> {
  const payload = proposal.payload as ProposalPayload;
  const databaseId = proposal.databaseId;
  switch (payload.type) {
    case "update_rows": {
      await assertRelationTargets(tx, databaseId, payload.changes.map((c) => c.after), [], canAccess);
      const events: RowEvent[] = [];
      for (const c of payload.changes) {
        const updated = await mergeDatabaseRowCells(databaseId, c.rowId, c.after, {}, tx, ctx);
        if (!updated) throw new ApplyWriteError("Une ligne a disparu");
        const after = (updated.cells as Cells | null) ?? {};
        events.push({ databaseId, rowId: c.rowId, before: beforeOf(current.get(c.rowId), after, c.before), after });
      }
      return {
        undo: { previousCells: payload.changes.map((c) => ({ rowId: c.rowId, cells: c.before })) },
        touchedIds: payload.changes.map((c) => c.rowId),
        summary: plural(payload.changes.length, "ligne mise à jour", "lignes mises à jour"),
        events,
      };
    }
    case "delete_rows": {
      const removed = await deleteDatabaseRows(databaseId, payload.rows.map((r) => r.id), tx, ctx);
      return {
        undo: { restoredRows: removed },
        touchedIds: [],
        summary: plural(removed.length, "ligne supprimée", "lignes supprimées"),
        events: removed.map((r) => ({ databaseId, rowId: r.id, before: r.cells, after: null })),
      };
    }
    case "create_rows": {
      await assertRelationTargets(tx, databaseId, payload.rows.map((r) => r.cells), [], canAccess);
      const ids: string[] = [];
      const events: RowEvent[] = [];
      for (const r of payload.rows) {
        const row = await createDatabaseRow(databaseId, r.cells, tx, ctx);
        ids.push(row.id);
        events.push({ databaseId, rowId: row.id, before: null, after: (row.cells as Cells | null) ?? {} });
      }
      return {
        undo: { createdRowIds: ids },
        touchedIds: ids,
        summary: plural(ids.length, "ligne créée", "lignes créées"),
        events,
      };
    }
    case "merge_duplicates":
      return writeMerge(tx, proposal, payload, body, ctx, canAccess, current);
  }
}

function failureMessage(e: unknown): string {
  if (e instanceof ApplyWriteError || e instanceof RowBatchError || e instanceof MediaCellError) return e.message;
  console.error("[ai-proposals] échec d'application", e);
  return GENERIC_FAILURE;
}

async function closeApplying(id: string, set: Partial<typeof aiProposals.$inferInsert>): Promise<void> {
  await db
    .update(aiProposals)
    .set(set)
    .where(and(eq(aiProposals.id, id), eq(aiProposals.status, "applying")));
}

/**
 * Applique une proposition stockée au clic : accès `editor` revérifié, transition atomique `pending` vers
 * `applying` (un seul appel gagne), fraîcheur recontrôlée, puis écriture tout ou rien dans une transaction via
 * les services de lignes (historique `source: "ai"`, acteur humain, lot de la proposition). Le statut `applied`,
 * l'instantané d'annulation et `appliedAt` (heure du succès) sont posés dans la même transaction, gardés par
 * `applying`. Toute erreur : rollback complet, statut `failed`.
 * Lève ToolAccessError (inconnue, étrangère ou droits insuffisants) et ApplyBodyError (corps incohérent).
 */
export async function applyProposal(args: {
  proposalId: string;
  user: SessionUser;
  orgId: string;
  body?: ApplyBody;
  req?: NextRequest;
}): Promise<ApplyOutcome> {
  const { user, orgId, body } = args;
  const proposal = await getOwnProposal({ id: args.proposalId, userId: user.id, orgId });
  if (!proposal) {
    throw new ToolAccessError("not_found");
  }
  await assertProposalAccess({ user, orgId, proposal, minPermission: "editor", req: args.req });
  if (proposal.status === "expired") return { status: "expired", message: "Proposition expirée" };
  if (proposal.status !== "pending") return { status: "refused", message: REFUSED_MESSAGE };
  // Réglage de l'organisation relu au clic : un type d'action désactivé depuis la création n'est plus applicable.
  if (!(await isProposalTypeAllowed(orgId, (proposal.payload as ProposalPayload).type))) {
    return { status: "refused", message: PROPOSAL_TYPE_DISABLED_MESSAGE };
  }
  validateBody(proposal.payload as ProposalPayload, body);

  const claimed = await claimForApply({ id: proposal.id, userId: user.id, orgId });
  if (!claimed) {
    const now = await getOwnProposal({ id: proposal.id, userId: user.id, orgId });
    return now?.status === "expired"
      ? { status: "expired", message: "Proposition expirée" }
      : { status: "refused", message: REFUSED_MESSAGE };
  }

  try {
    const payload = claimed.payload as ProposalPayload;
    const ctx: RowChangeContext = {
      source: "ai",
      actorUserId: user.id,
      batchId: claimed.batchId,
      mediaGuard: { user, orgId },
    };
    const result = await db.transaction(async (tx) => {
      // Fraîcheur recontrôlée SOUS verrou de lignes, dans la transaction d'écriture : pas de mise à jour perdue.
      const current = await lockFingerprintRows(tx, claimed.freshness as Freshness);
      if (!isFresh(claimed.freshness as Freshness, await currentFreshness(tx, claimed, payload))) return null;
      const w = await writeProposal(tx, claimed, body, ctx, canTargetRelationDatabase, current);
      const undoSnapshot: UndoSnapshot = { ...w.undo, postApply: await fingerprintRows(tx, w.touchedIds) };
      const done = await tx
        .update(aiProposals)
        .set({ status: "applied", undoSnapshot, appliedAt: new Date() })
        .where(and(eq(aiProposals.id, claimed.id), eq(aiProposals.status, "applying")))
        .returning({ id: aiProposals.id });
      if (done.length === 0) throw new ApplyWriteError("Application interrompue");
      return w;
    });
    if (result === null) {
      await safeClose(claimed.id, { status: "stale" });
      return { status: "stale", message: "Base modifiée depuis la proposition" };
    }
    // Après le commit seulement : parité avec la même modification manuelle (automatismes et pipelines).
    dispatchProposalRowEvents(result.events);
    return { status: "applied", summary: result.summary };
  } catch (e) {
    const message = failureMessage(e);
    await safeClose(claimed.id, { status: "failed", failureMessage: message });
    return { status: "failed", message };
  }
}

/** Clôture sans jamais lever : en cas d'échec d'écriture, l'orphelin `applying` est repris par la règle des 10 minutes. */
async function safeClose(id: string, set: Partial<typeof aiProposals.$inferInsert>): Promise<void> {
  try {
    await closeApplying(id, set);
  } catch (e) {
    console.error("[ai-proposals] clôture impossible", e);
  }
}
