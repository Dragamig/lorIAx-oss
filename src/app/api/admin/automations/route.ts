import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import {
  userDatabaseAutomations,
  userDatabaseAutomationRuns,
  userDatabases,
  spaces,
  users,
} from "@/lib/db/schema";
import { desc, eq, sql } from "drizzle-orm";
import { getSessionUser } from "@/lib/auth/get-user";
import { hasGlobalRole } from "@/lib/auth/rbac";
import { getRequestOrgId } from "@/lib/org/get-request-org";

export async function GET() {
  const user = await getSessionUser();
  if (!user || !hasGlobalRole(user.globalRole, "admin")) {
    return NextResponse.json({ error: "Accès refusé" }, { status: 403 });
  }

  // Cloisonnement (audit AZ-06) : une automatisation appartient à une base,
  // donc à un espace, donc à une organisation. Ce n'est pas une ressource de
  // portée instance, elle se filtre. Sans clause d'organisation, cette route
  // rendait le nom, la configuration, l'auteur avec son adresse électronique
  // et l'historique d'exécution de tous les tenants.
  const orgId = await getRequestOrgId(user);
  if (!orgId) {
    return NextResponse.json({ error: "Organisation introuvable" }, { status: 404 });
  }

  const rows = await db
    .select({
      id: userDatabaseAutomations.id,
      name: userDatabaseAutomations.name,
      triggerType: userDatabaseAutomations.triggerType,
      actionType: userDatabaseAutomations.actionType,
      enabled: userDatabaseAutomations.enabled,
      lastRunAt: userDatabaseAutomations.lastRunAt,
      createdAt: userDatabaseAutomations.createdAt,
      databaseId: userDatabaseAutomations.databaseId,
      databaseName: userDatabases.name,
      spaceName: spaces.name,
      organizationId: spaces.organizationId,
      createdBy: userDatabaseAutomations.createdBy,
      creatorName: users.name,
      creatorEmail: users.email,
      runCount: sql<number>`(
        SELECT COUNT(*)::int FROM ${userDatabaseAutomationRuns}
        WHERE ${userDatabaseAutomationRuns.automationId} = ${userDatabaseAutomations.id}
      )`,
    })
    .from(userDatabaseAutomations)
    .innerJoin(userDatabases, eq(userDatabases.id, userDatabaseAutomations.databaseId))
    .innerJoin(spaces, eq(spaces.id, userDatabases.spaceId))
    .leftJoin(users, eq(users.id, userDatabaseAutomations.createdBy))
    .where(eq(spaces.organizationId, orgId))
    .orderBy(desc(userDatabaseAutomations.updatedAt));

  return NextResponse.json(rows);
}
