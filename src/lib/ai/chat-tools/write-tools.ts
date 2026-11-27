import { tool } from "ai";
import { z } from "zod";
import { requireDatabaseAccess, type ChatToolContext } from "./context";
import { withToolLog } from "./tool-log";
import { createProposal } from "@/lib/ai/proposals/store";
import { planUpdateRows } from "@/lib/ai/proposals/plan-update";
import { planDeleteRows } from "@/lib/ai/proposals/plan-delete";
import { planCreateRows } from "@/lib/ai/proposals/plan-create";
import { planMergeDuplicates } from "@/lib/ai/proposals/plan-merge";
import { ProposalPlanError } from "@/lib/ai/proposals/types";
import type { ProposalPlan } from "@/lib/ai/proposals/plan-shared";
import { ALL_ON_CHAT_ACTIONS, type ChatActionsSettings } from "@/lib/ai/chat-actions-settings";

/** Message unique renvoyé au modèle : une proposition n'est jamais décrite comme déjà appliquée. */
export const PROPOSAL_PENDING_MESSAGE = "Proposition créée, en attente de validation par l'utilisateur.";

const cellsSchema = z
  .record(z.string(), z.unknown())
  .describe("Valeurs par id de colonne (jamais par nom)");

/** Contrôle d'accès éditeur, planification, puis insertion de la proposition. Aucune écriture de ligne. */
async function propose(
  ctx: ChatToolContext,
  databaseId: string,
  plan: () => Promise<ProposalPlan>,
) {
  await requireDatabaseAccess(ctx, databaseId, "editor");
  let planned: ProposalPlan;
  try {
    planned = await plan();
  } catch (e) {
    if (e instanceof ProposalPlanError) return { error: e.message };
    throw e;
  }
  const row = await createProposal({
    ctx,
    databaseId,
    payload: planned.payload,
    freshness: planned.freshness,
  });
  const conflicts = planned.payload.type === "merge_duplicates"
    ? planned.payload.groups.reduce((s, g) => s + (g.excluded ? 0 : g.conflicts.length), 0)
    : 0;
  return {
    proposalId: row.id,
    summary: planned.summary,
    rowCount: planned.rowCount,
    conflicts,
    message: PROPOSAL_PENDING_MESSAGE,
  };
}

export function buildWriteTools(ctx: ChatToolContext, actions: ChatActionsSettings = ALL_ON_CHAT_ACTIONS) {
  const propose_update_rows = tool({
    description:
      "Propose la mise à jour de lignes (valeurs par id de colonne). Ne modifie rien : crée une proposition que l'utilisateur doit valider.",
    inputSchema: z.object({
      databaseId: z.string().describe("Identifiant de la base"),
      modifications: z.array(z.object({ rowId: z.string(), cells: cellsSchema })).min(1),
    }),
    execute: withToolLog(ctx, "propose_update_rows", ({ databaseId, modifications }) =>
      propose(ctx, databaseId, () => planUpdateRows(databaseId, modifications)),
    ),
  });

  const propose_delete_rows = tool({
    description:
      "Propose la suppression de lignes. Ne supprime rien : crée une proposition que l'utilisateur doit valider.",
    inputSchema: z.object({
      databaseId: z.string().describe("Identifiant de la base"),
      rowIds: z.array(z.string()).min(1),
    }),
    execute: withToolLog(ctx, "propose_delete_rows", ({ databaseId, rowIds }) =>
      propose(ctx, databaseId, () => planDeleteRows(databaseId, rowIds)),
    ),
  });

  const propose_merge_duplicates = tool({
    description:
      "Propose le regroupement de doublons selon 1 à 5 colonnes clés (ids), groupIds facultatif pour limiter aux groupes voulus. Ne modifie rien : crée une proposition que l'utilisateur doit valider.",
    inputSchema: z.object({
      databaseId: z.string().describe("Identifiant de la base"),
      keyColumnIds: z.array(z.string()).min(1).max(5),
      groupIds: z.array(z.string()).optional(),
    }),
    execute: withToolLog(ctx, "propose_merge_duplicates", ({ databaseId, keyColumnIds, groupIds }) =>
      propose(ctx, databaseId, () => planMergeDuplicates(databaseId, keyColumnIds, groupIds)),
    ),
  });

  const propose_create_rows = tool({
    description:
      "Propose la création de lignes (valeurs par id de colonne). Ne crée rien : crée une proposition que l'utilisateur doit valider.",
    inputSchema: z.object({
      databaseId: z.string().describe("Identifiant de la base"),
      rows: z.array(z.object({ cells: cellsSchema })).min(1),
    }),
    execute: withToolLog(ctx, "propose_create_rows", ({ databaseId, rows }) =>
      propose(ctx, databaseId, () => planCreateRows(databaseId, rows)),
    ),
  });

  return {
    ...(actions.proposeUpdates ? { propose_update_rows } : {}),
    ...(actions.proposeDeletes ? { propose_delete_rows } : {}),
    ...(actions.proposeMerges ? { propose_merge_duplicates } : {}),
    ...(actions.proposeCreates ? { propose_create_rows } : {}),
  };
}
