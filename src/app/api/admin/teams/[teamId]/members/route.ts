import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { teams, teamMembers, users, organizationMembers } from "@/lib/db/schema";
import { eq, and } from "drizzle-orm";
import { getSessionUser } from "@/lib/auth/get-user";
import { hasGlobalRole } from "@/lib/auth/rbac";
import { getRequestOrgId } from "@/lib/org/get-request-org";
import { subscribeToTeamCalendar, unsubscribeFromTeamCalendar } from "@/lib/calendar/auto-provision";

type RouteContext = { params: Promise<{ teamId: string }> };

/**
 * Cloisonnement multi-tenant de la composition d'équipe (audit AZ-06, lot 6).
 *
 * Le `teamId` vient de l'URL et le `userId` du corps : la garde de rôle
 * `admin` dit « cet utilisateur administre quelque chose », pas « il
 * administre cette équipe ». Sans confrontation à l'organisation de la
 * requête, un admin de l'organisation A s'ajoutait lui-même, en rôle
 * d'administrateur d'équipe, à une équipe de l'organisation B, ce qui lui
 * ouvrait en prime un abonnement au calendrier de cette équipe et, depuis que
 * `getSpacePermission` honore les lignes de permission d'équipe (1.99.5), une
 * permission réelle sur les espaces de la victime.
 *
 * Un dépareillement d'organisation répond 404 muet, jamais 403 : dire
 * « refusé » révélerait l'existence d'une équipe d'un autre tenant.
 */
async function resolveTeamInOrg(
  user: { id: string; globalRole: string },
  teamId: string
): Promise<{ orgId: string } | null> {
  const orgId = await getRequestOrgId(user);
  if (!orgId) return null;

  const [team] = await db
    .select({ id: teams.id })
    .from(teams)
    .where(and(eq(teams.id, teamId), eq(teams.organizationId, orgId)))
    .limit(1);

  if (!team) return null;
  return { orgId };
}

/** Vrai si l'utilisateur visé appartient bien à l'organisation courante. */
async function isMemberOfOrg(userId: string, orgId: string): Promise<boolean> {
  const [row] = await db
    .select({ userId: organizationMembers.userId })
    .from(organizationMembers)
    .where(
      and(
        eq(organizationMembers.organizationId, orgId),
        eq(organizationMembers.userId, userId)
      )
    )
    .limit(1);
  return Boolean(row);
}

const teamNotFound = () =>
  NextResponse.json({ error: "Équipe introuvable" }, { status: 404 });

export async function GET(_request: NextRequest, context: RouteContext) {
  const user = await getSessionUser();
  if (!user || !hasGlobalRole(user.globalRole, "admin")) {
    return NextResponse.json({ error: "Accès refusé" }, { status: 403 });
  }

  const { teamId } = await context.params;
  const scope = await resolveTeamInOrg(user, teamId);
  if (!scope) return teamNotFound();

  const members = await db
    .select({
      userId: teamMembers.userId,
      role: teamMembers.role,
      joinedAt: teamMembers.joinedAt,
      userName: users.name,
      userEmail: users.email,
      userAvatar: users.avatarUrl,
    })
    .from(teamMembers)
    .innerJoin(users, eq(users.id, teamMembers.userId))
    .where(eq(teamMembers.teamId, teamId))
    .orderBy(users.name);

  return NextResponse.json(members);
}

export async function POST(request: NextRequest, context: RouteContext) {
  const user = await getSessionUser();
  if (!user || !hasGlobalRole(user.globalRole, "admin")) {
    return NextResponse.json({ error: "Accès refusé" }, { status: 403 });
  }

  const { teamId } = await context.params;
  const { userId, role = "member" } = await request.json();

  if (!userId) {
    return NextResponse.json({ error: "userId requis" }, { status: 400 });
  }

  const scope = await resolveTeamInOrg(user, teamId);
  if (!scope) return teamNotFound();

  // L'utilisateur ajouté doit lui aussi appartenir à l'organisation : sans ce
  // contrôle, une équipe de l'organisation A servirait de porte d'entrée à un
  // compte d'un autre tenant.
  if (!(await isMemberOfOrg(userId, scope.orgId))) {
    return NextResponse.json({ error: "Utilisateur introuvable" }, { status: 404 });
  }

  // Vérifier que l'utilisateur n'est pas déjà membre
  const existing = await db
    .select()
    .from(teamMembers)
    .where(and(eq(teamMembers.teamId, teamId), eq(teamMembers.userId, userId)))
    .limit(1);

  if (existing.length > 0) {
    return NextResponse.json({ error: "Déjà membre de l'équipe" }, { status: 409 });
  }

  await db.insert(teamMembers).values({ teamId, userId, role });

  // Auto-subscribe to team calendar
  await subscribeToTeamCalendar(userId, teamId, role).catch(() => {});

  return NextResponse.json({ success: true }, { status: 201 });
}

export async function PATCH(request: NextRequest, context: RouteContext) {
  const user = await getSessionUser();
  if (!user || !hasGlobalRole(user.globalRole, "admin")) {
    return NextResponse.json({ error: "Accès refusé" }, { status: 403 });
  }

  const { teamId } = await context.params;
  const { userId, role } = await request.json();

  if (!userId || !role) {
    return NextResponse.json({ error: "userId et role requis" }, { status: 400 });
  }

  const scope = await resolveTeamInOrg(user, teamId);
  if (!scope) return teamNotFound();

  await db
    .update(teamMembers)
    .set({ role })
    .where(and(eq(teamMembers.teamId, teamId), eq(teamMembers.userId, userId)));

  return NextResponse.json({ success: true });
}

export async function DELETE(request: NextRequest, context: RouteContext) {
  const user = await getSessionUser();
  if (!user || !hasGlobalRole(user.globalRole, "admin")) {
    return NextResponse.json({ error: "Accès refusé" }, { status: 403 });
  }

  const { teamId } = await context.params;
  const { searchParams } = new URL(request.url);
  const userId = searchParams.get("userId");

  if (!userId) {
    return NextResponse.json({ error: "userId requis" }, { status: 400 });
  }

  const scope = await resolveTeamInOrg(user, teamId);
  if (!scope) return teamNotFound();

  await db
    .delete(teamMembers)
    .where(and(eq(teamMembers.teamId, teamId), eq(teamMembers.userId, userId)));

  // Remove team calendar subscription
  await unsubscribeFromTeamCalendar(userId, teamId).catch(() => {});

  return NextResponse.json({ success: true });
}
