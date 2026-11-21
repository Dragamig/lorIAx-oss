import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { teams, teamMembers, spaces, documents } from "@/lib/db/schema";
import { eq, and, sql } from "drizzle-orm";
import { getSessionUser } from "@/lib/auth/get-user";
import { hasGlobalRole } from "@/lib/auth/rbac";
import slugify from "slugify";
import { initRepository } from "@/lib/git/repository";
import { logActivity } from "@/lib/activity";
import logger from "@/lib/logger";
import { ensureTeamCalendar } from "@/lib/calendar/auto-provision";
import { createTeamChannel } from "@/lib/chat/channel-hooks";
import { getRequestOrgId } from "@/lib/org/get-request-org";

export async function GET() {
  const user = await getSessionUser();
  if (!user || !hasGlobalRole(user.globalRole, "admin")) {
    return NextResponse.json({ error: "Accès refusé" }, { status: 403 });
  }

  // Cloisonnement multi-tenant : ne lister que les équipes de l'org courante.
  // Le rôle `admin` vaut DANS son organisation, il ne dispense pas d'y
  // appartenir (audit AZ-06) : l'organisation est résolue avec contrôle
  // d'appartenance, `null` = aucun accès, donc 404.
  const orgId = await getRequestOrgId(user);
  if (!orgId) {
    return NextResponse.json({ error: "Organisation introuvable" }, { status: 404 });
  }

  const allTeams = await db
    .select({
      id: teams.id,
      name: teams.name,
      description: teams.description,
      createdBy: teams.createdBy,
      createdAt: teams.createdAt,
      memberCount: sql<number>`(
        SELECT COUNT(*) FROM team_members
        WHERE team_members.team_id = ${teams.id}
      )`.as("member_count"),
    })
    .from(teams)
    .where(eq(teams.organizationId, orgId))
    .orderBy(teams.name);

  return NextResponse.json(allTeams);
}

export async function POST(request: NextRequest) {
  const user = await getSessionUser();
  if (!user || !hasGlobalRole(user.globalRole, "admin")) {
    return NextResponse.json({ error: "Accès refusé" }, { status: 403 });
  }

  // Cloisonnement : une équipe ne peut naître que dans l'organisation dont
  // l'administrateur est membre (audit AZ-06).
  const orgId = await getRequestOrgId(user);
  if (!orgId) {
    return NextResponse.json({ error: "Organisation introuvable" }, { status: 404 });
  }

  let body;
  try {
    body = await request.json();
  } catch (err) {
    logger.error({ err }, "[teams] Invalid JSON in POST request");
    return NextResponse.json({ error: "Requête JSON invalide" }, { status: 400 });
  }
  const { name, description } = body;

  if (!name) {
    return NextResponse.json({ error: "Nom requis" }, { status: 400 });
  }

  const [team] = await db
    .insert(teams)
    .values({
      name,
      description: description || null,
      createdBy: user.id,
      organizationId: orgId,
    })
    .returning();

  // Ajouter le créateur comme admin de l'équipe
  await db.insert(teamMembers).values({
    teamId: team.id,
    userId: user.id,
    role: "admin",
  });

  // Créer automatiquement un espace associé à l'équipe
  const baseSlug = slugify(name, { lower: true, strict: true });
  const timestamp = Date.now();
  const slug = `${baseSlug}-${timestamp}`;
  const gitRepoPath = `team/${slug}`;

  try {
    const [space] = await db
      .insert(spaces)
      .values({
        name,
        slug,
        type: "team",
        ownerTeamId: team.id,
        gitRepoPath,
        organizationId: orgId,
      })
      .returning();

    await initRepository(gitRepoPath);

    // Créer le calendrier d'équipe par défaut
    await ensureTeamCalendar(team.id, name).catch((err) =>
      logger.error({ err }, "[teams] Erreur création calendrier équipe")
    );

    // Créer le canal de messagerie pour l'équipe
    createTeamChannel({
      teamId: team.id,
      organizationId: orgId,
      createdBy: user.id,
      memberIds: [user.id],
    }).catch((err) =>
      logger.error({ err }, "[channel-hooks] Erreur création canal équipe")
    );

    logActivity({
      userId: user.id,
      action: "create",
      entityType: "space",
      entityId: space.id,
      metadata: { name, type: "team", teamId: team.id },
    });

    return NextResponse.json({ ...team, spaceId: space.id, spaceSlug: space.slug }, { status: 201 });
  } catch (err) {
    // Si la création de l'espace échoue, supprimer l'équipe créée
    await db.delete(teamMembers).where(eq(teamMembers.teamId, team.id));
    await db.delete(teams).where(eq(teams.id, team.id));
    logger.error({ err }, "[teams] Erreur création espace équipe");
    return NextResponse.json({ error: "Erreur lors de la création de l'espace" }, { status: 500 });
  }
}

export async function DELETE(request: NextRequest) {
  const user = await getSessionUser();
  if (!user || !hasGlobalRole(user.globalRole, "admin")) {
    return NextResponse.json({ error: "Accès refusé" }, { status: 403 });
  }

  let body;
  try {
    body = await request.json();
  } catch (err) {
    logger.error({ err }, "[teams] Invalid JSON in DELETE request");
    return NextResponse.json({ error: "Requête JSON invalide" }, { status: 400 });
  }
  const { id } = body;
  if (!id) {
    return NextResponse.json({ error: "ID requis" }, { status: 400 });
  }

  // Cloisonnement : interdire la suppression d'une équipe hors de l'org
  // courante, et n'accepter cette org que si l'administrateur en est membre.
  const orgId = await getRequestOrgId(user);
  if (!orgId) {
    return NextResponse.json({ error: "Organisation introuvable" }, { status: 404 });
  }
  const [targetTeam] = await db
    .select({ id: teams.id })
    .from(teams)
    .where(and(eq(teams.id, id), eq(teams.organizationId, orgId)))
    .limit(1);
  if (!targetTeam) {
    return NextResponse.json({ error: "Équipe introuvable" }, { status: 404 });
  }

  // Supprimer les documents de l'espace associé, puis l'espace, puis l'équipe
  const teamSpaces = await db
    .select({ id: spaces.id })
    .from(spaces)
    .where(eq(spaces.ownerTeamId, id));

  for (const space of teamSpaces) {
    await db.delete(documents).where(eq(documents.spaceId, space.id));
    await db.delete(spaces).where(eq(spaces.id, space.id));
  }

  await db.delete(teams).where(eq(teams.id, id));

  return NextResponse.json({ success: true });
}
