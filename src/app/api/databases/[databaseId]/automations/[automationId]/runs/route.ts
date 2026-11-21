import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { userDatabaseAutomations } from "@/lib/db/schema";
import { eq, and } from "drizzle-orm";
import { requireOrgScoped, OrgScopeError } from "@/lib/auth/require-org-scoped";
import { listAutomationRuns } from "@/lib/automations/executor";

type RouteParams = { params: Promise<{ databaseId: string; automationId: string }> };

export async function GET(_request: Request, { params }: RouteParams) {
  const { databaseId, automationId } = await params;
  try {
    await requireOrgScoped({ resource: { type: "database", id: databaseId }, minPermission: "viewer" });
  } catch (e) {
    if (e instanceof OrgScopeError) return e.response;
    throw e;
  }

  // Garde-fou : l'automation doit appartenir à cette database
  const [existing] = await db
    .select({ id: userDatabaseAutomations.id })
    .from(userDatabaseAutomations)
    .where(
      and(
        eq(userDatabaseAutomations.id, automationId),
        eq(userDatabaseAutomations.databaseId, databaseId)
      )
    )
    .limit(1);
  if (!existing) {
    return NextResponse.json({ error: "Introuvable" }, { status: 404 });
  }

  const runs = await listAutomationRuns(automationId, 100);
  return NextResponse.json(runs);
}
