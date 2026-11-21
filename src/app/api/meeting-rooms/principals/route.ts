import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { teams, users } from "@/lib/db/schema";
import { asc, eq, inArray } from "drizzle-orm";
import { getSessionUser } from "@/lib/auth/get-user";
import { getRequestOrgId } from "@/lib/org/get-request-org";
import { getOrgMemberIds } from "@/lib/org/org-members";
import { guardMeetingRoomsEnabled } from "@/lib/meeting-rooms/guards";
import {
  ASSIGNABLE_ROLES,
  canManageRooms,
} from "@/lib/meeting-rooms/permissions";

const ROLE_LABELS: Record<string, string> = {
  super_admin: "Super Admin",
  admin: "Administrateur",
  facility_manager: "Gestionnaire de salles",
  editor: "Éditeur",
  viewer: "Lecteur",
};

/**
 * Lecture seule : liste des utilisateurs, équipes et rôles assignables
 * pour la matrice de permissions des salles. Accessible aux gestionnaires
 * de salles (admin, super_admin ou facility_manager).
 */
export async function GET() {
  const blocked = await guardMeetingRoomsEnabled();
  if (blocked) return blocked;

  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "Non authentifié" }, { status: 401 });
  if (!canManageRooms(user.globalRole, user.capabilities)) {
    return NextResponse.json({ error: "Accès refusé" }, { status: 403 });
  }

  // Cloisonnement multi-tenant : ne proposer que les membres et équipes de
  // l'organisation du sous-domaine courant.
  const orgId = await getRequestOrgId(user);
  if (!orgId) {
    return NextResponse.json({ error: "Organisation introuvable" }, { status: 404 });
  }
  const memberIds = await getOrgMemberIds(orgId);

  const [u, t] = await Promise.all([
    memberIds.length === 0
      ? Promise.resolve([])
      : db
          .select({ id: users.id, name: users.name, email: users.email })
          .from(users)
          .where(inArray(users.id, memberIds))
          .orderBy(asc(users.name)),
    db
      .select({ id: teams.id, name: teams.name })
      .from(teams)
      .where(eq(teams.organizationId, orgId))
      .orderBy(asc(teams.name)),
  ]);

  const roles = ASSIGNABLE_ROLES.map((id) => ({
    id,
    name: ROLE_LABELS[id] ?? id,
  }));

  return NextResponse.json({ users: u, teams: t, roles });
}
