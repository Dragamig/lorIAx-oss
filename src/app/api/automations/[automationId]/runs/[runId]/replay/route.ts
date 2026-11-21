import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { userDatabaseAutomations } from "@/lib/db/schema";
import { eq, and, isNull } from "drizzle-orm";
import { requireOrgScoped, OrgScopeError } from "@/lib/auth/require-org-scoped";
import { canManageAutomations } from "@/lib/auth/rbac";
import { handleRunReplay } from "@/lib/automations/run-handlers";
import type { AutomationRow } from "@/lib/automations/actions/types";

type RouteParams = { params: Promise<{ automationId: string; runId: string }> };

/** Rejeu d'un run d'un workflow AUTONOME : le run d'origine est remplacé. */
export async function POST(_request: Request, { params }: RouteParams) {
  const { automationId, runId } = await params;
  const [automation] = await db
    .select()
    .from(userDatabaseAutomations)
    .where(
      and(
        eq(userDatabaseAutomations.id, automationId),
        isNull(userDatabaseAutomations.databaseId)
      )
    )
    .limit(1);
  if (!automation || !automation.spaceId) {
    return NextResponse.json({ error: "Introuvable" }, { status: 404 });
  }
  let ctx;
  try {
    ctx = await requireOrgScoped({
      resource: { type: "space", id: automation.spaceId },
      minPermission: "editor",
    });
  } catch (e) {
    if (e instanceof OrgScopeError) return e.response;
    throw e;
  }
  if (!canManageAutomations(ctx.user.globalRole, ctx.user.capabilities)) {
    return NextResponse.json(
      { error: "Vous n'avez pas le rôle requis pour rejouer une exécution" },
      { status: 403 }
    );
  }
  return handleRunReplay(automation as AutomationRow, runId, ctx.user.id);
}
