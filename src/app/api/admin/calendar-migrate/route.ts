import { NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth/get-user";
import { hasGlobalRole } from "@/lib/auth/rbac";
import { getRequestOrgId } from "@/lib/org/get-request-org";
import {
  migrateExistingUsers,
  migrateExistingTeams,
  ensureOrganizationCalendar,
} from "@/lib/calendar/auto-provision";

export async function POST() {
  const user = await getSessionUser();
  if (!user || !hasGlobalRole(user.globalRole, "admin")) {
    return NextResponse.json({ error: "Accès refusé" }, { status: 403 });
  }

  // Calendrier organisation provisionné dans l'org de la requête courante.
  const orgId = await getRequestOrgId(user);
  if (!orgId) {
    return NextResponse.json({ error: "Organisation introuvable" }, { status: 404 });
  }

  let usersCreated, teamsCreated, orgCalId;
  try {
    usersCreated = await migrateExistingUsers();
    teamsCreated = await migrateExistingTeams();
    orgCalId = await ensureOrganizationCalendar(user.id, orgId);
  } catch (err) {
    console.error({ error: err }, "[api/admin/calendar-migrate]");
    return NextResponse.json({ error: "Erreur lors de la migration" }, { status: 500 });
  }

  return NextResponse.json({
    message: "Migration calendriers terminée",
    usersCreated,
    teamsCreated,
    organizationCalendarId: orgCalId,
  });
}
