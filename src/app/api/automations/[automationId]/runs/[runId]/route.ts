import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { userDatabaseAutomations } from "@/lib/db/schema";
import { eq, and, isNull } from "drizzle-orm";
import { requireOrgScoped, OrgScopeError } from "@/lib/auth/require-org-scoped";
import { handleRunDetail } from "@/lib/automations/run-handlers";

type RouteParams = { params: Promise<{ automationId: string; runId: string }> };

/** Détail d'un run d'un workflow AUTONOME avec sa trace par étape. */
export async function GET(_request: Request, { params }: RouteParams) {
  const { automationId, runId } = await params;
  const [automation] = await db
    .select({ id: userDatabaseAutomations.id, spaceId: userDatabaseAutomations.spaceId })
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
  try {
    await requireOrgScoped({ resource: { type: "space", id: automation.spaceId }, minPermission: "viewer" });
  } catch (e) {
    if (e instanceof OrgScopeError) return e.response;
    throw e;
  }
  return handleRunDetail(automationId, runId);
}
