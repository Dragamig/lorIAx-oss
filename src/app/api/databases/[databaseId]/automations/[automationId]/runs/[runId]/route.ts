import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { userDatabaseAutomations } from "@/lib/db/schema";
import { eq, and } from "drizzle-orm";
import { requireOrgScoped, OrgScopeError } from "@/lib/auth/require-org-scoped";
import { handleRunDetail } from "@/lib/automations/run-handlers";

type RouteParams = {
  params: Promise<{ databaseId: string; automationId: string; runId: string }>;
};

/** Détail d'un run avec sa trace par étape (même accès que la liste). */
export async function GET(_request: Request, { params }: RouteParams) {
  const { databaseId, automationId, runId } = await params;
  try {
    await requireOrgScoped({ resource: { type: "database", id: databaseId }, minPermission: "viewer" });
  } catch (e) {
    if (e instanceof OrgScopeError) return e.response;
    throw e;
  }

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
  if (!existing) return NextResponse.json({ error: "Introuvable" }, { status: 404 });

  return handleRunDetail(automationId, runId);
}
