import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { userDatabaseAutomations } from "@/lib/db/schema";
import { eq, and } from "drizzle-orm";
import { requireOrgScoped, OrgScopeError } from "@/lib/auth/require-org-scoped";
import { canManageAutomations } from "@/lib/auth/rbac";
import { handleRunReplay } from "@/lib/automations/run-handlers";
import type { AutomationRow } from "@/lib/automations/actions/types";

type RouteParams = {
  params: Promise<{ databaseId: string; automationId: string; runId: string }>;
};

/** Rejeu d'un run : réexécution réelle, le run d'origine est remplacé. */
export async function POST(_request: Request, { params }: RouteParams) {
  const { databaseId, automationId, runId } = await params;
  let ctx;
  try {
    ctx = await requireOrgScoped({
      resource: { type: "database", id: databaseId },
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

  const [automation] = await db
    .select()
    .from(userDatabaseAutomations)
    .where(
      and(
        eq(userDatabaseAutomations.id, automationId),
        eq(userDatabaseAutomations.databaseId, databaseId)
      )
    )
    .limit(1);
  if (!automation) return NextResponse.json({ error: "Introuvable" }, { status: 404 });

  return handleRunReplay(automation as AutomationRow, runId, ctx.user.id);
}
