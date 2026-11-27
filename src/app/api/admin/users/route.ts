import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { users, spaces } from "@/lib/db/schema";
import { organizationMembers } from "@/lib/db/schema-org";
import { eq, inArray, sql } from "drizzle-orm";
import { getSessionUser } from "@/lib/auth/get-user";
import { hasGlobalRole } from "@/lib/auth/rbac";
import { revokeUserSessions } from "@/lib/auth/revoke-sessions";
import { clearAuthUserStateCache } from "@/lib/auth";
import bcrypt from "bcryptjs";
import slugify from "slugify";
import { sendEmail } from "@/lib/email/send";
import { accountCreatedEmail } from "@/lib/email/templates/account-created";
import { initRepository } from "@/lib/git/repository";
import { ensurePersonalCalendar } from "@/lib/calendar/auto-provision";
import { getHooks } from "@/lib/modules/hooks";
import logger from "@/lib/logger";
import { getRequestOrgId } from "@/lib/org/get-request-org";
import { getOrgMemberIds } from "@/lib/org/org-members";
import { deletePersonalViewsOf } from "@/lib/databases/view-cleanup";

export async function GET() {
  const user = await getSessionUser();
  if (!user || !hasGlobalRole(user.globalRole, "admin")) {
    return NextResponse.json({ error: "Accès refusé" }, { status: 403 });
  }

  // Cloisonnement multi-tenant : ne lister que les membres de l'organisation
  // du sous-domaine courant (y compris pour un super_admin — pas de god-view
  // transverse sous le tenant mutualisé `app`).
  const orgId = await getRequestOrgId(user);
  if (!orgId) {
    return NextResponse.json({ error: "Organisation introuvable" }, { status: 404 });
  }
  const memberIds = await getOrgMemberIds(orgId);
  if (memberIds.length === 0) {
    return NextResponse.json([]);
  }

  const allUsers = await db
    .select({
      id: users.id,
      email: users.email,
      name: users.name,
      globalRole: users.globalRole,
      capabilities: users.capabilities,
      avatarUrl: users.avatarUrl,
      createdAt: users.createdAt,
      updatedAt: users.updatedAt,
      emailVerifiedAt: users.emailVerifiedAt,
    })
    .from(users)
    .where(inArray(users.id, memberIds))
    .orderBy(users.name);

  return NextResponse.json(allUsers);
}

export async function POST(request: NextRequest) {
  const user = await getSessionUser();
  if (!user || !hasGlobalRole(user.globalRole, "admin")) {
    return NextResponse.json({ error: "Accès refusé" }, { status: 403 });
  }

  try {
    const body = await request.json();
    const { name, email, password, globalRole, sendWelcomeEmail } = body;

    if (!name?.trim() || !email?.trim() || !password) {
      return NextResponse.json({ error: "Nom, email et mot de passe requis" }, { status: 400 });
    }
    if (password.length < 8) {
      return NextResponse.json({ error: "Le mot de passe doit faire au moins 8 caractères" }, { status: 400 });
    }

    const validRoles = ["viewer", "editor", "admin", "super_admin"] as const;
    type ValidRole = typeof validRoles[number];
    const requestedRole = (validRoles as readonly string[]).includes(globalRole) ? globalRole : "editor";

    if (requestedRole === "super_admin" && !hasGlobalRole(user.globalRole, "super_admin")) {
      return NextResponse.json({ error: "Seul un super admin peut créer un super admin" }, { status: 403 });
    }

    const role: ValidRole = requestedRole;
    const normalizedEmail = email.toLowerCase().trim();

    // Organisation du sous-domaine courant : l'admin agit dans son org.
    const orgId = await getRequestOrgId(user);
    if (!orgId) {
      return NextResponse.json({ error: "Organisation introuvable" }, { status: 404 });
    }

    // Vérifier le quota utilisateurs de l'organisation (scopé par tenant)
    const usersStatus = await getHooks().usage.checkUsersLimit(orgId);
    if (usersStatus.exceeded) {
      return NextResponse.json(
        { error: `Quota d'utilisateurs atteint (${usersStatus.current}/${usersStatus.max}). Mettez à niveau votre licence.` },
        { status: 403 }
      );
    }

    const [existing] = await db
      .select({ id: users.id })
      .from(users)
      .where(eq(users.email, normalizedEmail))
      .limit(1);

    if (existing) {
      return NextResponse.json({ error: "Un compte avec cet email existe déjà" }, { status: 400 });
    }

    const passwordHash = await bcrypt.hash(password, 12);

    // Création atomique : compte + adhésion org + espace personnel dans une
    // transaction. Si l'une échoue (ex. collision de slug), tout est annulé —
    // évite les comptes « fantômes » insérés sans espace qui bloqueraient ensuite
    // la recréation avec le même email.
    const { created, gitRepoPath } = await db.transaction(async (tx) => {
      const [u] = await tx
        .insert(users)
        .values({ name: name.trim(), email: normalizedEmail, passwordHash, globalRole: role })
        .returning({
          id: users.id,
          name: users.name,
          email: users.email,
          globalRole: users.globalRole,
          createdAt: users.createdAt,
        });

      // Rattacher le compte à l'organisation du sous-domaine courant (résolue
      // plus haut). Sans cela, l'utilisateur serait exclu d'une org isolée.
      await tx
        .insert(organizationMembers)
        .values({ organizationId: orgId, userId: u.id, role: "member" })
        .onConflictDoNothing();

      // Espace personnel (comme à l'inscription). Le slug doit être unique : un
      // espace archivé d'un compte supprimé de même nom occupe déjà
      // `personal-<nom>` → on suffixe par l'id pour éviter la collision sur
      // `spaces_slug_unique`.
      const slug = slugify(name.trim(), { lower: true, strict: true });
      const baseSlug = `personal-${slug}`;
      const [slugTaken] = await tx
        .select({ id: spaces.id })
        .from(spaces)
        .where(eq(spaces.slug, baseSlug))
        .limit(1);
      const spaceSlug = slugTaken ? `${baseSlug}-${u.id.slice(0, 8)}` : baseSlug;
      const repoPath = `personal/${u.id}`;
      await tx.insert(spaces).values({
        name: `Espace de ${name.trim()}`,
        slug: spaceSlug,
        type: "personal",
        ownerUserId: u.id,
        gitRepoPath: repoPath,
        organizationId: orgId,
      });

      return { created: u, gitRepoPath: repoPath };
    });

    // Effets externes hors transaction (best-effort) : dépôt git + calendrier.
    await initRepository(gitRepoPath);

    // Créer le calendrier personnel
    await ensurePersonalCalendar(created.id, name.trim()).catch((err) =>
      logger.error({ err }, "[admin/users] Erreur création calendrier personnel")
    );

    let emailSent = false;
    if (sendWelcomeEmail) {
      try {
        const appUrl = process.env.NEXTAUTH_URL ?? process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";
        const template = accountCreatedEmail({
          name: created.name,
          email: created.email,
          password,
          loginUrl: `${appUrl}/login`,
        });
        const result = await sendEmail({ to: created.email, ...template });
        emailSent = result.success;
      } catch {
        emailSent = false;
      }
    }

    return NextResponse.json({ user: created, emailSent }, { status: 201 });
  } catch (error) {
    logger.error({ err: error }, "[admin/users] Erreur création utilisateur");
    return NextResponse.json({ error: "Erreur serveur lors de la création" }, { status: 500 });
  }
}

export async function PATCH(request: NextRequest) {
  const user = await getSessionUser();
  if (!user || !hasGlobalRole(user.globalRole, "admin")) {
    return NextResponse.json({ error: "Accès refusé" }, { status: 403 });
  }

  const body = await request.json();
  const { id, globalRole, name, capabilities } = body;

  if (!id) {
    return NextResponse.json({ error: "ID requis" }, { status: 400 });
  }

  const updates: Record<string, unknown> = {};

  if (globalRole) {
    const validRoles = ["viewer", "editor", "admin", "super_admin"] as const;
    if (!(validRoles as readonly string[]).includes(globalRole)) {
      return NextResponse.json({ error: "Rôle invalide" }, { status: 400 });
    }
    if (globalRole === "super_admin" && !hasGlobalRole(user.globalRole, "super_admin")) {
      return NextResponse.json(
        { error: "Seul un super admin peut accorder le rôle super admin" },
        { status: 403 }
      );
    }
    updates.globalRole = globalRole;
  }

  if (capabilities !== undefined) {
    const validCaps = [
      "facility_manager",
      "automation_manager",
      "template_doc_editor",
      "template_graphic_editor",
    ] as const;
    if (
      !Array.isArray(capabilities) ||
      capabilities.some((c: unknown) => !(validCaps as readonly string[]).includes(c as string))
    ) {
      return NextResponse.json({ error: "Capacité invalide" }, { status: 400 });
    }
    updates.capabilities = Array.from(new Set(capabilities)) as string[];
  }

  if (name) updates.name = name;

  if (Object.keys(updates).length === 0) {
    return NextResponse.json({ error: "Aucune modification" }, { status: 400 });
  }

  // Cloisonnement : interdire la modification d'un compte hors de l'org courante.
  const orgId = await getRequestOrgId(user);
  if (!orgId) {
    return NextResponse.json({ error: "Organisation introuvable" }, { status: 404 });
  }
  const memberIds = await getOrgMemberIds(orgId);
  if (!memberIds.includes(id)) {
    return NextResponse.json({ error: "Utilisateur introuvable" }, { status: 404 });
  }

  await db.update(users).set(updates).where(eq(users.id, id));

  // H10 : un changement de rôle global coupe les sessions en cours de la cible.
  if (updates.globalRole) {
    await revokeUserSessions(id);
  }

  return NextResponse.json({ success: true });
}

export async function DELETE(request: NextRequest) {
  const user = await getSessionUser();
  if (!user || !hasGlobalRole(user.globalRole, "super_admin")) {
    return NextResponse.json({ error: "Accès refusé" }, { status: 403 });
  }

  const { id } = await request.json();
  if (!id) {
    return NextResponse.json({ error: "ID requis" }, { status: 400 });
  }

  if (id === user.id) {
    return NextResponse.json(
      { error: "Impossible de supprimer votre propre compte" },
      { status: 400 }
    );
  }

  // Cloisonnement : interdire la suppression d'un compte hors de l'org courante.
  const orgId = await getRequestOrgId(user);
  if (!orgId) {
    return NextResponse.json({ error: "Organisation introuvable" }, { status: 404 });
  }
  const memberIds = await getOrgMemberIds(orgId);
  if (!memberIds.includes(id)) {
    return NextResponse.json({ error: "Utilisateur introuvable" }, { status: 404 });
  }

  // Récupère le compte cible pour nommer l'espace d'archive.
  const [target] = await db
    .select({ name: users.name, email: users.email })
    .from(users)
    .where(eq(users.id, id))
    .limit(1);
  const archiveLabel = target?.name?.trim() || target?.email || "compte supprimé";

  // Les contenus créés par le compte supprimé sont réassignés à l'admin qui
  // effectue la suppression : aucune perte, la suppression réussit toujours.
  // Couvre les FK `users.id` en ON DELETE NO ACTION (les autres sont gérées
  // automatiquement : CASCADE pour les données personnelles, SET NULL pour les
  // références d'auteur/acteur nullables). Les ESPACES possédés sont traités à
  // part : conservés (contenu + dépôt git intacts), transférés à l'admin et
  // renommés d'après le compte → l'admin retrouve son contenu dans un espace
  // identifiable.
  // ⚠ Garder cette liste synchronisée avec les contraintes NO ACTION du schéma.
  const reassignOnDelete: ReadonlyArray<readonly [table: string, column: string]> = [
    ["media", "uploaded_by"],
    ["presentations", "created_by"],
    ["calendar_events", "created_by"],
    ["dashboards", "created_by"],
    ["documents", "created_by"],
    ["labels", "created_by"],
    ["meeting_rooms", "created_by"],
    ["public_shares", "created_by"],
    ["tasks", "created_by"],
    ["teams", "created_by"],
    ["templates", "created_by"],
    ["automations", "created_by"],
    ["user_database_groups", "created_by"],
    ["user_database_views", "created_by"],
    ["user_databases", "created_by"],
    ["video_jobs", "created_by"],
    ["video_projects", "created_by"],
  ];

  await db.transaction(async (tx) => {
    // Espaces possédés : transférés à l'admin + renommés (255 max), contenu/git intacts.
    await tx.execute(
      sql`UPDATE spaces SET owner_user_id = ${user.id}, name = LEFT(${`Archive ${archiveLabel} : `} || name, 255), updated_at = now() WHERE owner_user_id = ${id}`
    );
    // Vues personnelles : supprimées (jamais réattribuées), avant la boucle ci-dessous.
    await deletePersonalViewsOf(tx, id);
    for (const [table, column] of reassignOnDelete) {
      await tx.execute(
        sql`UPDATE ${sql.identifier(table)} SET ${sql.identifier(column)} = ${user.id} WHERE ${sql.identifier(column)} = ${id}`
      );
    }
    // Verrou d'édition transitoire : libéré plutôt que transféré.
    await tx.execute(sql`UPDATE documents SET locked_by = NULL WHERE locked_by = ${id}`);
    await tx.delete(users).where(eq(users.id, id));
  });

  // H10 : le compte n'existe plus (les clés d'API partent en cascade) ; l'état
  // mémoïsé est purgé pour que sa session soit rejetée sans attendre le cache.
  clearAuthUserStateCache(id);

  return NextResponse.json({ success: true });
}
