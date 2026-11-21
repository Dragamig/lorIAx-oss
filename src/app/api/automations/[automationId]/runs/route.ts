import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { userDatabaseAutomations } from "@/lib/db/schema";
import { eq, and, isNull } from "drizzle-orm";
import { requireOrgScoped, OrgScopeError } from "@/lib/auth/require-org-scoped";
import { listAutomationRuns } from "@/lib/automations/executor";

type RouteParams = { params: Promise<{ automationId: string }> };

/** Historique des exécutions d'un workflow AUTONOME (scopé par son espace). */
export async function GET(_request: Request, { params }: RouteParams) {
  const { automationId } = await params;

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

  const runs = await listAutomationRuns(automationId, 100);
  return NextResponse.json(runs);
}
