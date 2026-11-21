import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import {
  userDatabaseAutomations,
  userDatabaseAutomationRuns,
  userDatabases,
  spaces,
} from "@/lib/db/schema";
import { and, desc, eq } from "drizzle-orm";
import { getSessionUser } from "@/lib/auth/get-user";
import { hasGlobalRole } from "@/lib/auth/rbac";
import { getRequestOrgId } from "@/lib/org/get-request-org";

const STATUS_VALUES = new Set(["success", "error", "skipped", "partial"]);

export async function GET(request: Request) {
  const user = await getSessionUser();
  if (!user || !hasGlobalRole(user.globalRole, "admin")) {
    return NextResponse.json({ error: "Accès refusé" }, { status: 403 });
  }

  // Cloisonnement (audit AZ-06) : l'historique d'exécution porte les messages
  // d'erreur des automatisations, qui appartiennent à un espace, donc à une
  // organisation. Filtrage, pas portée instance.
  const orgId = await getRequestOrgId(user);
  if (!orgId) {
    return NextResponse.json({ error: "Organisation introuvable" }, { status: 404 });
  }

  const url = new URL(request.url);
  const limitParam = parseInt(url.searchParams.get("limit") ?? "100", 10);
  const limit = Math.min(Math.max(Number.isFinite(limitParam) ? limitParam : 100, 1), 500);
  const status = url.searchParams.get("status");

  const query = db
    .select({
      id: userDatabaseAutomationRuns.id,
      automationId: userDatabaseAutomationRuns.automationId,
      automationName: userDatabaseAutomations.name,
      databaseName: userDatabases.name,
      triggeredAt: userDatabaseAutomationRuns.triggeredAt,
      status: userDatabaseAutomationRuns.status,
      durationMs: userDatabaseAutomationRuns.durationMs,
      errorMessage: userDatabaseAutomationRuns.errorMessage,
    })
    .from(userDatabaseAutomationRuns)
    .innerJoin(
      userDatabaseAutomations,
      eq(userDatabaseAutomations.id, userDatabaseAutomationRuns.automationId)
    )
    .innerJoin(userDatabases, eq(userDatabases.id, userDatabaseAutomations.databaseId))
    .innerJoin(spaces, eq(spaces.id, userDatabases.spaceId))
    .orderBy(desc(userDatabaseAutomationRuns.triggeredAt))
    .limit(limit);

  const rows = status && STATUS_VALUES.has(status)
    ? await query.where(
        and(
          eq(spaces.organizationId, orgId),
          eq(userDatabaseAutomationRuns.status, status)
        )
      )
    : await query.where(eq(spaces.organizationId, orgId));

  return NextResponse.json(rows);
}
