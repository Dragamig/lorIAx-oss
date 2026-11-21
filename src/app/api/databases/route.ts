import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import {
  userDatabases,
  userDatabaseColumns,
  userDatabaseRows,
  userDatabaseViews,
  userDatabaseRecents,
  favorites,
} from "@/lib/db/schema";
import { and, desc, eq, inArray, isNull, isNotNull } from "drizzle-orm";
import { requireOrgScoped, OrgScopeError } from "@/lib/auth/require-org-scoped";
import { z } from "zod";
import { recordIfRealSpace } from "@/lib/onboarding/progress";
import { stripInverseColumnId } from "@/lib/databases/relation-columns";
import { setRowChangeContext, SKIP_ROW_HISTORY } from "@/lib/databases/row-change-context";
import { canTargetRelationDatabase } from "@/lib/databases/relation-target-access";

export async function GET(request: NextRequest) {
  const spaceId = request.nextUrl.searchParams.get("spaceId");
  if (!spaceId) {
    return NextResponse.json({ error: "spaceId requis" }, { status: 400 });
  }

  let ctx;
  try {
    ctx = await requireOrgScoped({ resource: { type: "space", id: spaceId }, minPermission: "viewer" });
  } catch (e) {
    if (e instanceof OrgScopeError) return e.response;
    throw e;
  }

  const params = request.nextUrl.searchParams;
  const status = params.get("status") ?? "active";
  const favoritesOnly = params.get("favorites") === "1";
  const recentLimit = params.get("recent");

  // Filtre status — active = non archivé & non corbeille.
  const statusFilter =
    status === "archived"
      ? and(isNotNull(userDatabases.archivedAt), isNull(userDatabases.deletedAt))
      : status === "trashed"
        ? isNotNull(userDatabases.deletedAt)
        : and(isNull(userDatabases.archivedAt), isNull(userDatabases.deletedAt));

  if (recentLimit) {
    const limit = Math.min(Math.max(parseInt(recentLimit, 10) || 5, 1), 50);
    const recentRows = await db
      .select({ db: userDatabases, openedAt: userDatabaseRecents.openedAt })
      .from(userDatabaseRecents)
      .innerJoin(userDatabases, eq(userDatabases.id, userDatabaseRecents.databaseId))
      .where(
        and(
          eq(userDatabaseRecents.userId, ctx.user.id),
          eq(userDatabases.spaceId, spaceId),
          isNull(userDatabases.archivedAt),
          isNull(userDatabases.deletedAt),
        ),
      )
      .orderBy(desc(userDatabaseRecents.openedAt))
      .limit(limit);
    return NextResponse.json(recentRows.map((r) => ({ ...r.db, openedAt: r.openedAt })));
  }

  if (favoritesOnly) {
    const favIds = await db
      .select({ id: favorites.entityId })
      .from(favorites)
      .where(and(eq(favorites.userId, ctx.user.id), eq(favorites.entityType, "database")));
    if (favIds.length === 0) return NextResponse.json([]);
    const result = await db
      .select()
      .from(userDatabases)
      .where(
        and(
          eq(userDatabases.spaceId, spaceId),
          inArray(userDatabases.id, favIds.map((f) => f.id)),
          statusFilter,
        ),
      )
      .orderBy(userDatabases.name);
    return NextResponse.json(result);
  }

  const result = await db
    .select()
    .from(userDatabases)
    .where(and(eq(userDatabases.spaceId, spaceId), statusFilter))
    .orderBy(userDatabases.name);

  return NextResponse.json(result);
}

const columnDefSchema = z.object({
  name: z.string().min(1).max(255),
  type: z.enum(["text", "number", "date", "select", "checkbox", "relation", "image", "formula", "url", "email"]),
  config: z.record(z.string(), z.any()).optional(),
});

const createSchema = z.object({
  name: z.string().min(1),
  description: z.string().optional(),
  spaceId: z.string().uuid(),
  columns: z.array(columnDefSchema).optional(),
});

export async function POST(request: Request) {
  let body;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'JSON invalide' }, { status: 400 });
  }
  const parsed = createSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0].message },
      { status: 400 }
    );
  }

  const { name, description, spaceId, columns } = parsed.data;

  let ctx;
  try {
    ctx = await requireOrgScoped({
      resource: { type: "space", id: spaceId },
      minPermission: "editor",
    });
  } catch (e) {
    if (e instanceof OrgScopeError) return e.response;
    throw e;
  }

  // Colonnes initiales : `inverseColumnId` jamais accepté du client, cible de
  // relation contrôlée (404 muet), cible ignorée pour un type non relation.
  const safeColumns = columns?.map((col) => {
    const config = stripInverseColumnId(col.config);
    if (col.type !== "relation") delete config.targetDatabaseId;
    return { ...col, config };
  });
  for (const col of safeColumns ?? []) {
    const target = col.config.targetDatabaseId;
    if (col.type !== "relation" || target === undefined || target === null || target === "") continue;
    if (!(await canTargetRelationDatabase(target))) {
      return NextResponse.json({ error: "Introuvable" }, { status: 404 });
    }
  }

  // Création atomique : base + colonnes + lignes initiales + vue par défaut.
  // Sans transaction, un échec intermédiaire laisserait une base orpheline
  // (sans colonnes ni vue), inutilisable et invisible à /bases/[id].
  const database = await db.transaction(async (tx) => {
    const [created] = await tx
      .insert(userDatabases)
      .values({ name, description, spaceId, createdBy: ctx.user.id })
      .returning();

    if (safeColumns && safeColumns.length > 0) {
      await tx.insert(userDatabaseColumns).values(
        safeColumns.map((col, i) => ({
          databaseId: created.id,
          name: col.name,
          type: col.type,
          config: col.config,
          position: i,
        }))
      );
    } else {
      await tx.insert(userDatabaseColumns).values([
        { databaseId: created.id, name: "ID", type: "number", position: 0, config: {} },
        { databaseId: created.id, name: "Nom", type: "text", position: 1, config: {} },
        {
          databaseId: created.id,
          name: "Statut",
          type: "select",
          position: 2,
          config: { options: ["À faire", "En cours", "Terminé"] },
        },
      ]);
    }

    // Toujours créer 3 lignes vides à la création — sinon l'utilisateur voit
    // un tableau sans aucune ligne et peut rater le bouton "Nouvelle ligne"
    // (rapporté lors de la création depuis un template).
    await setRowChangeContext(tx, SKIP_ROW_HISTORY);
    await tx.insert(userDatabaseRows).values([
      { databaseId: created.id, cells: {}, position: 0 },
      { databaseId: created.id, cells: {}, position: 1 },
      { databaseId: created.id, cells: {}, position: 2 },
    ]);

    // Vue par défaut (grid) — sans elle, /bases/[id] ne trouve aucune view à
    // rediriger et l'utilisateur tombe sur l'écran "pas encore de vue persistée".
    await tx.insert(userDatabaseViews).values({
      databaseId: created.id,
      name: "Tableau",
      type: "grid",
      isDefault: true,
      position: 0,
      scope: "shared",
      createdBy: ctx.user.id,
    });

    return created;
  });

  // Instrumentation onboarding : base créée hors espace démo
  recordIfRealSpace(ctx.user.id, "base", spaceId).catch(() => {});

  return NextResponse.json(database, { status: 201 });
}
