import { db } from "@/lib/db";
import {
  meetingRoomPermissions,
  teamMembers,
  teams,
  users,
} from "@/lib/db/schema";
import { and, eq, inArray, or, sql } from "drizzle-orm";
import { canManageMeetingRooms } from "@/lib/auth/rbac";
import type { UserCapability, UserRole } from "@/types";

export const ASSIGNABLE_ROLES: readonly UserRole[] = [
  "super_admin",
  "admin",
  "facility_manager",
  "editor",
  "viewer",
];

/**
 * Peut administrer les salles : super_admin, admin ou facility_manager.
 * Accepte aussi les badges (capabilities) pour honorer facility_manager en tant que badge.
 */
export function canManageRooms(
  globalRole: UserRole,
  capabilities: UserCapability[] = []
): boolean {
  return canManageMeetingRooms(globalRole, capabilities);
}

/**
 * Construit le tableau de conditions « principalType+principalId concerne
 * cet utilisateur » (axe user, team ou role). Centralise la logique pour
 * canBookRoom et listBookableRoomIds.
 */
async function buildPrincipalConditions(
  userId: string,
  globalRole: UserRole,
  capabilities: UserCapability[] = []
) {
  const teamRows = await db
    .select({ teamId: teamMembers.teamId })
    .from(teamMembers)
    .where(eq(teamMembers.userId, userId));
  const teamIds = teamRows.map((t) => t.teamId);

  // Axe "role" : le socle ET chaque badge comptent comme des principals de rôle,
  // pour que les grants principal_type='role' / principal_id='facility_manager'
  // s'appliquent aux porteurs du badge.
  const roleIds = [globalRole, ...capabilities];

  const conditions = [
    and(
      eq(meetingRoomPermissions.principalType, "user"),
      eq(meetingRoomPermissions.principalId, userId)
    ),
    and(
      eq(meetingRoomPermissions.principalType, "role"),
      inArray(meetingRoomPermissions.principalId, roleIds)
    ),
  ];

  if (teamIds.length > 0) {
    conditions.push(
      and(
        eq(meetingRoomPermissions.principalType, "team"),
        inArray(meetingRoomPermissions.principalId, teamIds)
      )!
    );
  }

  return conditions;
}

/**
 * Peut réserver une salle donnée.
 * - Les administrateurs (admin/super_admin/facility_manager) peuvent toujours.
 * - Sinon : autorisation explicite via meeting_room_permissions
 *   (axe utilisateur, équipe ou rôle).
 */
export async function canBookRoom(
  userId: string,
  globalRole: UserRole,
  roomId: string,
  capabilities: UserCapability[] = []
): Promise<boolean> {
  if (canManageMeetingRooms(globalRole, capabilities)) return true;

  const principalConditions = await buildPrincipalConditions(userId, globalRole, capabilities);

  const rows = await db
    .select()
    .from(meetingRoomPermissions)
    .where(
      and(
        eq(meetingRoomPermissions.roomId, roomId),
        eq(meetingRoomPermissions.canBook, true),
        or(...principalConditions)
      )
    )
    .limit(1);

  return rows.length > 0;
}

/**
 * Liste les IDs des salles que l'utilisateur peut réserver.
 * Utilisée par la page Organisation pour filtrer la vue.
 */
export async function listBookableRoomIds(
  userId: string,
  globalRole: UserRole,
  capabilities: UserCapability[] = []
): Promise<string[] | "all"> {
  if (canManageMeetingRooms(globalRole, capabilities)) return "all";

  const principalConditions = await buildPrincipalConditions(userId, globalRole, capabilities);

  const rows = await db
    .select({ roomId: meetingRoomPermissions.roomId })
    .from(meetingRoomPermissions)
    .where(
      and(
        eq(meetingRoomPermissions.canBook, true),
        or(...principalConditions)
      )
    );

  return [...new Set(rows.map((r) => r.roomId))];
}

/**
 * Vérifie l'existence d'un user/team correspondant au principalId fourni,
 * ou la validité d'un nom de rôle.
 */
export async function principalExists(
  principalType: "user" | "team" | "role",
  principalId: string
): Promise<boolean> {
  if (principalType === "role") {
    return (ASSIGNABLE_ROLES as readonly string[]).includes(principalId);
  }
  if (principalType === "user") {
    const rows = await db
      .select({ id: users.id })
      .from(users)
      .where(eq(users.id, principalId))
      .limit(1);
    return rows.length > 0;
  }
  if (principalType === "team") {
    const rows = await db
      .select({ id: teams.id })
      .from(teams)
      .where(eq(teams.id, principalId))
      .limit(1);
    return rows.length > 0;
  }
  return false;
}

// Évite les warnings unused import si besoin futur
void sql;
