import { NextRequest, NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth/get-user";
import { db } from "@/lib/db";
import { sharedPresets, users } from "@/lib/db/schema";
import { organizationMembers } from "@/lib/db/schema-org";
import { eq, and, desc } from "drizzle-orm";
import { getRequestOrgId } from "@/lib/org/get-request-org";
import { getDefaultOrgId } from "@/lib/org/get-org-id";
import type { SessionUser } from "@/types";

/**
 * Cloisonnement des préréglages partagés.
 *
 * `shared_presets` n'a pas de colonne `organization_id` : le rattachement passe
 * par l'auteur. On applique donc la même règle que `isOrgMember` :
 * - org partagée par défaut (tenant mutualisé historique) → tout le monde ;
 * - org isolée → l'auteur doit avoir une ligne `organization_members`.
 *
 * Retourne `null` quand aucune organisation n'est résolue (fail-closed).
 */
async function resolveOrgScope(
  user: SessionUser
): Promise<{ orgId: string; isDefaultOrg: boolean } | null> {
  const orgId = await getRequestOrgId(user);
  if (!orgId) return null;
  const defaultOrgId = await getDefaultOrgId();
  return { orgId, isDefaultOrg: orgId === defaultOrgId };
}

/** L'auteur d'un préréglage est-il visible depuis l'organisation courante ? */
async function isAuthorInScope(
  authorId: string,
  scope: { orgId: string; isDefaultOrg: boolean }
): Promise<boolean> {
  if (scope.isDefaultOrg) return true;
  const [member] = await db
    .select({ organizationId: organizationMembers.organizationId })
    .from(organizationMembers)
    .where(
      and(
        eq(organizationMembers.organizationId, scope.orgId),
        eq(organizationMembers.userId, authorId)
      )
    )
    .limit(1);
  return !!member;
}

// GET — list shared presets of the current organization (with author name)
export async function GET() {
  const user = await getSessionUser();
  if (!user) {
    return NextResponse.json({ error: "Non autorisé" }, { status: 401 });
  }

  const scope = await resolveOrgScope(user);
  if (!scope) return NextResponse.json({ error: "Accès refusé" }, { status: 403 });

  const columns = {
    id: sharedPresets.id,
    name: sharedPresets.name,
    description: sharedPresets.description,
    config: sharedPresets.config,
    createdAt: sharedPresets.createdAt,
    userId: sharedPresets.userId,
    authorName: users.name,
  };

  // Org isolée : jointure sur l'appartenance de l'auteur, pour ne pas exposer
  // les préréglages (et les noms d'auteurs) des autres organisations.
  const presets = scope.isDefaultOrg
    ? await db
        .select(columns)
        .from(sharedPresets)
        .innerJoin(users, eq(sharedPresets.userId, users.id))
        .orderBy(desc(sharedPresets.createdAt))
    : await db
        .select(columns)
        .from(sharedPresets)
        .innerJoin(users, eq(sharedPresets.userId, users.id))
        .innerJoin(
          organizationMembers,
          and(
            eq(organizationMembers.userId, sharedPresets.userId),
            eq(organizationMembers.organizationId, scope.orgId)
          )
        )
        .orderBy(desc(sharedPresets.createdAt));

  return NextResponse.json(presets);
}

// POST — share a preset
export async function POST(req: NextRequest) {
  const user = await getSessionUser();
  if (!user) {
    return NextResponse.json({ error: "Non autorisé" }, { status: 401 });
  }

  const scope = await resolveOrgScope(user);
  if (!scope) return NextResponse.json({ error: "Accès refusé" }, { status: 403 });

  let body;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "JSON invalide" }, { status: 400 });
  }
  const { name, description, config } = body;

  if (!name || !config) {
    return NextResponse.json({ error: "Nom et configuration requis" }, { status: 400 });
  }

  const [preset] = await db
    .insert(sharedPresets)
    .values({
      userId: user.id,
      name,
      description: description || null,
      config,
    })
    .returning();

  return NextResponse.json(preset, { status: 201 });
}

// DELETE — remove own shared preset
export async function DELETE(req: NextRequest) {
  const user = await getSessionUser();
  if (!user) {
    return NextResponse.json({ error: "Non autorisé" }, { status: 401 });
  }

  const scope = await resolveOrgScope(user);
  if (!scope) return NextResponse.json({ error: "Accès refusé" }, { status: 403 });

  const { id } = await req.json();
  if (!id) {
    return NextResponse.json({ error: "ID requis" }, { status: 400 });
  }

  // Only allow deleting own presets (or admin)
  const [existing] = await db
    .select({ userId: sharedPresets.userId })
    .from(sharedPresets)
    .where(eq(sharedPresets.id, id));

  if (!existing) {
    return NextResponse.json({ error: "Preset introuvable" }, { status: 404 });
  }

  // Un préréglage d'une autre organisation n'existe pas de ce point de vue :
  // sinon un admin global de l'org A supprimerait ceux de l'org B.
  if (!(await isAuthorInScope(existing.userId, scope))) {
    return NextResponse.json({ error: "Preset introuvable" }, { status: 404 });
  }

  if (existing.userId !== user.id && user.globalRole !== "super_admin" && user.globalRole !== "admin") {
    return NextResponse.json({ error: "Non autorisé" }, { status: 403 });
  }

  await db.delete(sharedPresets).where(eq(sharedPresets.id, id));

  return NextResponse.json({ success: true });
}
