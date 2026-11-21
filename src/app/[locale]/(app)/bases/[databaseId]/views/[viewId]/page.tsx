import { notFound } from "next/navigation";
import { db } from "@/lib/db";
import { and, eq, asc, inArray, sql } from "drizzle-orm";
import {
  userDatabases,
  userDatabaseColumns,
  userDatabaseRows,
} from "@/lib/db/schema";
import { listVisibleViews } from "@/lib/databases/view-access";
import { requireOrgScoped, OrgScopeError } from "@/lib/auth/require-org-scoped";
import { BaseViewer } from "@/components/bases/base-viewer";

interface PageProps {
  params: Promise<{ databaseId: string; viewId: string }>;
  searchParams: Promise<{ spaceId?: string }>;
}

export default async function DatabaseViewPage({ params }: PageProps) {
  const { databaseId, viewId } = await params;

  let userId: string;
  let readOnly = false;
  try {
    const ctx = await requireOrgScoped({ resource: { type: "database", id: databaseId }, minPermission: "viewer" });
    userId = ctx.user.id;
    readOnly = ctx.permission === "viewer";
  } catch (e) {
    if (e instanceof OrgScopeError) {
      notFound();
    }
    throw e;
  }

  // Charger database + columns + rows + views + view active en parallèle
  const [database, columns, rows, allViews] = await Promise.all([
    db
      .select()
      .from(userDatabases)
      .where(eq(userDatabases.id, databaseId))
      .limit(1)
      .then((r) => r[0]),
    db
      .select()
      .from(userDatabaseColumns)
      .where(eq(userDatabaseColumns.databaseId, databaseId))
      .orderBy(asc(userDatabaseColumns.position)),
    db
      .select()
      .from(userDatabaseRows)
      .where(eq(userDatabaseRows.databaseId, databaseId))
      .orderBy(asc(userDatabaseRows.position)),
    listVisibleViews(db, databaseId, userId),
  ]);

  if (!database) notFound();

  // Vue personnelle d'un autre = vue inexistante
  const activeView = allViews.find((v) => v.id === viewId);
  if (!activeView) notFound();

  // Tables liées par colonnes relation (bidirectionnel)
  const [outgoingCols, incomingCols] = await Promise.all([
    db
      .select({ config: userDatabaseColumns.config })
      .from(userDatabaseColumns)
      .where(
        and(
          eq(userDatabaseColumns.databaseId, databaseId),
          eq(userDatabaseColumns.type, "relation")
        )
      ),
    db
      .selectDistinct({ linkedId: userDatabaseColumns.databaseId })
      .from(userDatabaseColumns)
      .where(
        and(
          eq(userDatabaseColumns.type, "relation"),
          sql`${userDatabaseColumns.config}->>'targetDatabaseId' = ${databaseId}`
        )
      ),
  ]);

  const outgoingIds = outgoingCols
    .map((c) => (c.config as { targetDatabaseId?: string } | null)?.targetDatabaseId)
    .filter((id): id is string => !!id && id !== databaseId);

  const incomingIds = incomingCols
    .map((r) => r.linkedId)
    .filter((id): id is string => !!id && id !== databaseId);

  const relatedIds = [...new Set([...outgoingIds, ...incomingIds])];

  const siblingTables =
    relatedIds.length > 0
      ? await db
          .select({
            id: userDatabases.id,
            name: userDatabases.name,
            icon: userDatabases.icon,
            position: userDatabases.position,
          })
          .from(userDatabases)
          .where(inArray(userDatabases.id, [databaseId, ...relatedIds]))
          .orderBy(asc(userDatabases.position), asc(userDatabases.name))
      : [];


  return (
    <BaseViewer
      database={{
        id: database.id,
        name: database.name,
        description: database.description,
        spaceId: database.spaceId,
      }}
      columns={columns.map((c) => ({
        id: c.id,
        databaseId: c.databaseId,
        name: c.name,
        type: c.type,
        position: c.position,
        config: (c.config ?? {}) as Record<string, unknown>,
        createdAt: c.createdAt.toISOString(),
      }))}
      rows={rows.map((r) => ({
        id: r.id,
        databaseId: r.databaseId,
        cells: (r.cells ?? {}) as Record<string, unknown>,
        position: r.position,
        createdAt: r.createdAt.toISOString(),
        updatedAt: r.updatedAt.toISOString(),
      }))}
      views={allViews.map((v) => ({
        id: v.id,
        name: v.name,
        type: v.type,
        isDefault: v.isDefault,
        position: v.position,
        scope: (v.scope === "personal" ? "personal" : "shared") as "personal" | "shared",
        createdBy: v.createdBy ?? null,
        config: (v.config ?? {}) as Record<string, unknown>,
      }))}
      activeViewId={viewId}
      viewerId={userId}
      readOnly={readOnly}
      spaceIdParam={database.spaceId}
      siblingTables={siblingTables.map((t) => ({
        id: t.id,
        name: t.name,
        icon: t.icon ?? null,
      }))}
    />
  );
}
