import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { spaces, spacePermissions, teamMembers, users } from "@/lib/db/schema";
import { eq, or, inArray, and } from "drizzle-orm";
import { getSessionUser } from "@/lib/auth/get-user";
import { hasGlobalRole } from "@/lib/auth/rbac";
import { z } from "zod";
import { getRequestOrgId } from "@/lib/org/get-request-org";
import logger from "@/lib/logger";
import { assertSpaceQuota, insertSpace, afterSpaceCreated } from "@/lib/spaces/create-space";

export async function GET() {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "Non authentifié" }, { status: 401 });

  // Cloisonnement multi-tenant : l'organisation du sous-domaine n'est résolue
  // que si l'utilisateur en est membre. `getOrgId` traduisait le slug sans
  // aucun contrôle, donc un membre du tenant A listait et créait des espaces
  // dans l'organisation du tenant B en rejouant sa requête sur le
  // sous-domaine de celui-ci (fail-closed : `null` = aucun accès, 404).
  const orgId = await getRequestOrgId(user);
  if (!orgId) {
    return NextResponse.json({ error: "Organisation introuvable" }, { status: 404 });
  }

  // Helper : enrichir les espaces avec l'avatar du propriétaire
  async function withOwnerAvatars(spaceList: (typeof spaces.$inferSelect)[]) {
    const ownerIds = [...new Set(spaceList.filter((s) => s.ownerUserId).map((s) => s.ownerUserId!))];
    if (ownerIds.length === 0) return spaceList.map((s) => ({ ...s, ownerAvatarUrl: null }));

    const owners = await db
      .select({ id: users.id, avatarUrl: users.avatarUrl, email: users.email })
      .from(users)
      .where(inArray(users.id, ownerIds));

    const ownerMap = new Map(owners.map((o) => [o.id, o]));
    return spaceList.map((s) => {
      const owner = s.ownerUserId ? ownerMap.get(s.ownerUserId) : null;
      return {
        ...s,
        ownerAvatarUrl: owner?.avatarUrl ?? null,
        ownerEmail: owner?.email ?? null,
      };
    });
  }

  // Admins voient tous les espaces de l'organisation
  if (hasGlobalRole(user.globalRole, "admin")) {
    const allSpaces = await db.select().from(spaces)
      .where(eq(spaces.organizationId, orgId))
      .orderBy(spaces.name);
    return NextResponse.json(await withOwnerAvatars(allSpaces));
  }

  // Trouver les equipes de l'utilisateur
  const userTeams = await db
    .select({ teamId: teamMembers.teamId })
    .from(teamMembers)
    .where(eq(teamMembers.userId, user.id));

  const teamIds = userTeams.map((t) => t.teamId);

  // Espaces accessibles : perso + permissions directes + permissions equipe
  const perms = await db
    .select({ spaceId: spacePermissions.spaceId })
    .from(spacePermissions)
    .where(
      or(
        eq(spacePermissions.userId, user.id),
        teamIds.length > 0
          ? inArray(spacePermissions.teamId, teamIds)
          : undefined
      )
    );

  const permSpaceIds = perms.map((p) => p.spaceId);

  // Espaces accessibles (hors secret sauf si membre/admin), filtrés par org
  const allAccessible = await db
    .select()
    .from(spaces)
    .where(
      and(
        eq(spaces.organizationId, orgId),
        or(
          eq(spaces.ownerUserId, user.id),
          eq(spaces.type, "organization"),
          permSpaceIds.length > 0
            ? inArray(spaces.id, permSpaceIds)
            : undefined,
          teamIds.length > 0
            ? inArray(spaces.ownerTeamId, teamIds)
            : undefined
        )
      )
    )
    .orderBy(spaces.name);

  // Filtrer les espaces "secret" pour les non-admins sans permission d'espace
  const permSpaceIdSet = new Set(permSpaceIds);
  const accessibleSpaces = allAccessible.filter((s) => {
    if (s.classification !== "secret") return true;
    if (s.ownerUserId === user.id) return true;
    return permSpaceIdSet.has(s.id);
  });

  return NextResponse.json(await withOwnerAvatars(accessibleSpaces));
}

const createSpaceSchema = z.object({
  name: z.string().min(1),
  type: z.enum(["personal", "team", "organization"]),
  description: z.string().optional(),
  icon: z.string().max(50).optional(),
  ownerTeamId: z.string().uuid().optional(),
});

export async function POST(request: Request) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "Non authentifié" }, { status: 401 });

  // Cloisonnement multi-tenant : l'organisation du sous-domaine n'est résolue
  // que si l'utilisateur en est membre. `getOrgId` traduisait le slug sans
  // aucun contrôle, donc un membre du tenant A listait et créait des espaces
  // dans l'organisation du tenant B en rejouant sa requête sur le
  // sous-domaine de celui-ci (fail-closed : `null` = aucun accès, 404).
  const orgId = await getRequestOrgId(user);
  if (!orgId) {
    return NextResponse.json({ error: "Organisation introuvable" }, { status: 404 });
  }

  const body = await request.json();
  const parsed = createSpaceSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0].message }, { status: 400 });
  }

  const { name, type, description, icon, ownerTeamId } = parsed.data;

  // Seuls les admins peuvent creer des espaces organisation
  if (type === "organization" && !hasGlobalRole(user.globalRole, "admin")) {
    return NextResponse.json(
      { error: "Seuls les administrateurs peuvent créer des espaces d'organisation" },
      { status: 403 }
    );
  }

  // Vérifier le quota espaces de l'organisation (hors espaces personnels)
  if (type !== "personal") {
    const spacesStatus = await assertSpaceQuota(orgId);
    if (spacesStatus.exceeded) {
      return NextResponse.json(
        { error: `Quota d'espaces atteint (${spacesStatus.current}/${spacesStatus.max}). Mettez à niveau votre licence.` },
        { status: 403 }
      );
    }
  }

  let space: typeof spaces.$inferSelect;
  try {
    space = await insertSpace(db, { orgId, userId: user.id, name, type, description, icon, ownerTeamId });
  } catch (err) {
    logger.error({ err }, "[spaces] Erreur lors de la création de l'espace");
    return NextResponse.json(
      { error: "Erreur lors de la création de l'espace dans la base de données" },
      { status: 500 }
    );
  }

  const { gitOk } = await afterSpaceCreated(space, user.id);
  if (!gitOk) {
    return NextResponse.json(
      { error: "Erreur lors de l'initialisation du repository git" },
      { status: 500 }
    );
  }

  return NextResponse.json(space, { status: 201 });
}
