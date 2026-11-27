import type { NextRequest } from "next/server";
import { asc, inArray } from "drizzle-orm";
import { db } from "@/lib/db";
import { userDatabaseColumns, userDatabases } from "@/lib/db/schema";
import type { AiProposalRow } from "@/lib/db/schema-ai-proposals";
import { requireDatabaseAccess, ToolAccessError, type ChatToolContext } from "@/lib/ai/chat-tools/context";
import type { SessionUser } from "@/types";
import { neutralizeUnreadableMediaCells } from "@/lib/databases/attachment-cell-guard";
import { summarizeProposal, type ProposalPayload } from "./types";
import { buildRowLabels } from "./row-labels";

export type ProposalView = {
  id: string;
  databaseId: string;
  databaseName: string;
  type: AiProposalRow["type"];
  status: AiProposalRow["status"];
  summary: string;
  rowCount: number;
  conflictCount: number;
  createdAt: string;
  expiresAt: string;
  payload: ProposalPayload;
  /** Nom des colonnes de la base, par identifiant de colonne. */
  columnNames: Record<string, string>;
  /** Libellé lisible des lignes du payload (clé de fusion ou première colonne), par identifiant de ligne. */
  rowLabels: Record<string, string>;
  /** Droit `editor` sur la base à l'instant (info-bulle du bouton Appliquer). */
  canApply: boolean;
};

type Cells = Record<string, unknown>;

/**
 * Charge utile exposée à la carte : uniquement ce qu'elle affiche. Les cellules de snapshot sont vidées (le libellé
 * des lignes est calculé avant, sur le payload complet), les lignes porteuses d'autres bases ne sont pas exposées,
 * et les médias illisibles par l'utilisateur sont neutralisés dans les cellules et les valeurs de conflit.
 */
async function toViewPayload(
  payload: ProposalPayload,
  types: Record<string, string>,
  user: SessionUser,
  orgId: string,
): Promise<ProposalPayload> {
  const neutral = async (cells: Cells): Promise<Cells> =>
    (await neutralizeUnreadableMediaCells(types, [cells], user, orgId))[0] ?? {};
  switch (payload.type) {
    case "update_rows":
      return {
        ...payload,
        changes: await Promise.all(
          payload.changes.map(async (c) => ({ ...c, before: await neutral(c.before), after: await neutral(c.after) })),
        ),
      };
    case "create_rows":
      return { ...payload, rows: await Promise.all(payload.rows.map(async (r) => ({ cells: await neutral(r.cells) }))) };
    case "delete_rows":
      return { ...payload, rows: payload.rows.map((r) => ({ id: r.id, cells: {}, position: r.position })) };
    case "merge_duplicates":
      return {
        ...payload,
        groups: await Promise.all(
          payload.groups.map(async (g) => ({
            ...g,
            mergedCells: {},
            keepBefore: {},
            keepRow: { id: g.keepRow.id, cells: {}, position: g.keepRow.position },
            removedRows: g.removedRows.map((r) => ({ id: r.id, cells: {}, position: r.position })),
            repatriation: { ...g.repatriation, repointed: [] },
            conflicts: await Promise.all(
              g.conflicts.map(async (c) => ({
                ...c,
                candidates: await Promise.all(
                  c.candidates.map(async (k) => ({
                    rowId: k.rowId,
                    value: (await neutral({ [c.columnId]: k.value }))[c.columnId],
                  })),
                ),
              })),
            ),
          })),
        ),
      };
  }
}

/**
 * Vues de propositions : résumé dérivé du payload, nom de base, droit d'application courant. L'accès en lecture
 * (`viewer`) à la base est revérifié à chaque lecture : une proposition dont la base n'est plus lisible est omise.
 */
export async function buildProposalViews(
  rows: AiProposalRow[],
  user: SessionUser,
  orgId: string,
  req: NextRequest,
): Promise<ProposalView[]> {
  if (rows.length === 0) return [];
  const dbIds = [...new Set(rows.map((r) => r.databaseId))];
  const names = await db
    .select({ id: userDatabases.id, name: userDatabases.name })
    .from(userDatabases)
    .where(inArray(userDatabases.id, dbIds));
  const nameById = new Map(names.map((n) => [n.id, n.name]));
  const cols = await db
    .select({
      id: userDatabaseColumns.id,
      databaseId: userDatabaseColumns.databaseId,
      name: userDatabaseColumns.name,
      type: userDatabaseColumns.type,
    })
    .from(userDatabaseColumns)
    .where(inArray(userDatabaseColumns.databaseId, dbIds))
    .orderBy(asc(userDatabaseColumns.position), asc(userDatabaseColumns.createdAt));
  const colsByDb = new Map<string, { id: string; name: string; type: string }[]>();
  for (const c of cols) {
    colsByDb.set(c.databaseId, [...(colsByDb.get(c.databaseId) ?? []), { id: c.id, name: c.name, type: c.type }]);
  }
  const ctx: ChatToolContext = { user, orgId, spaceIds: [], admin: false, req };
  const canById = new Map<string, boolean>();
  const readable = new Set<string>();
  for (const id of dbIds) {
    try {
      await requireDatabaseAccess(ctx, id, "viewer");
      readable.add(id);
    } catch (e) {
      if (!(e instanceof ToolAccessError)) throw e;
      continue;
    }
    try {
      await requireDatabaseAccess(ctx, id, "editor");
      canById.set(id, true);
    } catch (e) {
      if (!(e instanceof ToolAccessError)) throw e;
      canById.set(id, false);
    }
  }
  const visible = rows.filter((r) => readable.has(r.databaseId));
  return Promise.all(visible.map(async (r) => {
    const payload = r.payload as ProposalPayload;
    const s = summarizeProposal({ payload });
    const types = Object.fromEntries((colsByDb.get(r.databaseId) ?? []).map((c) => [c.id, c.type]));
    return {
      id: r.id,
      databaseId: r.databaseId,
      databaseName: nameById.get(r.databaseId) ?? "",
      type: r.type,
      status: r.status,
      summary: s.summary,
      rowCount: s.rowCount,
      conflictCount: s.conflictCount,
      createdAt: r.createdAt.toISOString(),
      expiresAt: r.expiresAt.toISOString(),
      payload: await toViewPayload(payload, types, user, orgId),
      columnNames: Object.fromEntries((colsByDb.get(r.databaseId) ?? []).map((c) => [c.id, c.name])),
      rowLabels: buildRowLabels(payload, colsByDb.get(r.databaseId)?.[0]?.id),
      canApply: canById.get(r.databaseId) ?? false,
    };
  }));
}
