import type { NextRequest } from "next/server";
import { and, eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { aiProposals, type AiProposalRow } from "@/lib/db/schema-ai-proposals";
import { ToolAccessError, type ChatToolContext } from "@/lib/ai/chat-tools/context";
import type { SessionUser } from "@/types";
import { isProposalTypeAllowed, PROPOSAL_TYPE_DISABLED_MESSAGE } from "@/lib/ai/chat-actions-settings";
import { assertProposalAccess } from "./access";
import { planDeleteRows } from "./plan-delete";
import { planMergeDuplicates } from "./plan-merge";
import { planUpdateRows } from "./plan-update";
import type { ProposalPlan } from "./plan-shared";
import { createProposal, getOwnProposal } from "./store";
import { ProposalPlanError, type ProposalPayload } from "./types";

export type RecomputeOutcome =
  | { status: "recomputed"; proposal: AiProposalRow }
  | { status: "refused" | "not_applicable" | "plan_failed"; message: string };

const REFUSED = "Cette proposition ne peut plus être recalculée";
const NOT_APPLICABLE = "Une création de lignes n'a rien à recalculer";

/** Rejoue l'intention du payload stocké sur l'état actuel de la base. */
function replay(databaseId: string, payload: ProposalPayload): Promise<ProposalPlan> | null {
  switch (payload.type) {
    case "update_rows":
      return planUpdateRows(
        databaseId,
        payload.changes.map((c) => ({ rowId: c.rowId, cells: c.after })),
      );
    case "delete_rows":
      return planDeleteRows(databaseId, payload.rows.map((r) => r.id));
    case "merge_duplicates":
      return planMergeDuplicates(databaseId, payload.keyColumnIds, payload.groups.map((g) => g.groupId));
    case "create_rows":
      return null;
  }
}

/**
 * Recalcule une proposition `pending`, `stale`, `expired` ou `failed` : même intention (lignes, cellules, clés, groupes du
 * payload), état actuel de la base. Crée une nouvelle proposition (`replacesId` = l'ancienne) et passe l'ancienne
 * `pending` à `stale`. Aucune ligne n'est écrite. Accès `editor` revérifié. Lève ToolAccessError.
 */
export async function recomputeProposal(args: {
  proposalId: string;
  user: SessionUser;
  orgId: string;
  req?: NextRequest;
}): Promise<RecomputeOutcome> {
  const { user, orgId } = args;
  const old = await getOwnProposal({ id: args.proposalId, userId: user.id, orgId });
  if (!old) throw new ToolAccessError("not_found");
  await assertProposalAccess({ user, orgId, proposal: old, minPermission: "editor", req: args.req });
  if (old.status !== "pending" && old.status !== "stale" && old.status !== "expired" && old.status !== "failed") {
    return { status: "refused", message: REFUSED };
  }
  if (!(await isProposalTypeAllowed(orgId, (old.payload as ProposalPayload).type))) {
    return { status: "refused", message: PROPOSAL_TYPE_DISABLED_MESSAGE };
  }
  const planning = replay(old.databaseId, old.payload as ProposalPayload);
  if (planning === null) return { status: "not_applicable", message: NOT_APPLICABLE };

  let plan: ProposalPlan;
  try {
    plan = await planning;
  } catch (e) {
    if (e instanceof ProposalPlanError) return { status: "plan_failed", message: e.message };
    throw e;
  }
  const ctx: ChatToolContext = { user, orgId, spaceIds: [], admin: false, req: args.req as NextRequest };
  const proposal = await createProposal({
    ctx,
    databaseId: old.databaseId,
    payload: plan.payload,
    freshness: plan.freshness,
    replacesId: old.id,
  });
  await db
    .update(aiProposals)
    .set({ status: "stale" })
    .where(and(eq(aiProposals.id, old.id), eq(aiProposals.status, "pending")));
  return { status: "recomputed", proposal };
}

