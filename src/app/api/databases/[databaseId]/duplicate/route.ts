import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import {
  userDatabases,
  userDatabaseColumns,
  userDatabaseRows,
  userDatabaseViews,
} from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import { setRowChangeContext, SKIP_ROW_HISTORY } from "@/lib/databases/row-change-context";
import { cloneColumnConfig } from "@/lib/databases/relation-sync";
import { requireOrgScoped, OrgScopeError } from "@/lib/auth/require-org-scoped";
import { listVisibleViews } from "@/lib/databases/view-access";
import { neutralizeUnreadableMediaCells } from "@/lib/databases/attachment-cell-guard";

export async function POST(
  _request: Request,
  { params }: { params: Promise<{ databaseId: string }> }
) {
  const { databaseId } = await params;

  let ctx;
  try {
    ctx = await requireOrgScoped({
      resource: { type: "database", id: databaseId },
      minPermission: "editor",
    });
  } catch (e) {
    if (e instanceof OrgScopeError) return e.response;
    throw e;
  }

  const [source] = await db
    .select()
    .from(userDatabases)
    .where(eq(userDatabases.id, databaseId))
    .limit(1);
  if (!source) return NextResponse.json({ error: "Introuvable" }, { status: 404 });

  // Garde des cellules médias : le clone reste dans l'espace et l'organisation
  // de la source, mais celui qui duplique ne doit pas obtenir une référence à un
  // média qu'il ne peut pas lire lui-même. Les références illisibles sont
  // neutralisées (image vidée, pièce retirée) avant la copie.
  const typeRows = await db
    .select({ id: userDatabaseColumns.id, type: userDatabaseColumns.type })
    .from(userDatabaseColumns)
    .where(eq(userDatabaseColumns.databaseId, databaseId));
  const columnTypes = Object.fromEntries(typeRows.map((c) => [c.id, c.type]));
  const rawRows = await db
    .select()
    .from(userDatabaseRows)
    .where(eq(userDatabaseRows.databaseId, databaseId))
    .orderBy(userDatabaseRows.position);
  const safeCells = await neutralizeUnreadableMediaCells(
    columnTypes,
    rawRows.map((r) => (r.cells as Record<string, unknown>) ?? {}),
    ctx.user,
    ctx.orgId
  );
  const sourceRows = rawRows.map((r, i) => ({ ...r, cells: safeCells[i] }));

  // Transaction explicite : la duplication ne doit jamais laisser de clone
  // partiel (database sans colonnes / colonnes sans lignes / vues orphelines).
  const clone = await db.transaction(async (tx) => {
    const [inserted] = await tx
      .insert(userDatabases)
      .values({
        spaceId: source.spaceId,
        groupId: source.groupId,
        name: `${source.name} (copie)`,
        description: source.description,
        icon: source.icon,
        createdBy: ctx.user.id,
      })
      .returning();

    const sourceColumns = await tx
      .select()
      .from(userDatabaseColumns)
      .where(eq(userDatabaseColumns.databaseId, databaseId))
      .orderBy(userDatabaseColumns.position);

    const columnIdMap = new Map<string, string>();
    if (sourceColumns.length > 0) {
      const insertedColumns = await tx
        .insert(userDatabaseColumns)
        .values(
          sourceColumns.map((c) => ({
            databaseId: inserted.id,
            name: c.name,
            type: c.type,
            position: c.position,
            config: cloneColumnConfig(c.type, c.config),
          }))
        )
        .returning();
      sourceColumns.forEach((c, i) => columnIdMap.set(c.id, insertedColumns[i].id));
    }

    if (sourceRows.length > 0) {
      await setRowChangeContext(tx, SKIP_ROW_HISTORY);
      await tx.insert(userDatabaseRows).values(
        sourceRows.map((r) => {
          const remappedCells: Record<string, unknown> = {};
          const cells = (r.cells as Record<string, unknown>) ?? {};
          for (const [oldColId, value] of Object.entries(cells)) {
            const newColId = columnIdMap.get(oldColId);
            if (newColId) remappedCells[newColId] = value;
          }
          return {
            databaseId: inserted.id,
            cells: remappedCells,
            position: r.position,
          };
        })
      );
    }

    // Seules les vues visibles de l'appelant sont lues : les personnelles d'un autre ne sont ni lues ni copiées.
    const sourceViews = await listVisibleViews(tx, databaseId, ctx.user.id);

    if (sourceViews.length > 0) {
      await tx.insert(userDatabaseViews).values(
        sourceViews.map((v) => ({
          databaseId: inserted.id,
          name: v.name,
          type: v.type,
          config: v.config ?? {},
          isDefault: v.isDefault,
          position: v.position,
          scope: v.scope,
          createdBy: ctx.user.id,
        }))
      );
    } else {
      await tx.insert(userDatabaseViews).values({
        databaseId: inserted.id,
        name: "Tableau",
        type: "grid",
        isDefault: true,
        position: 0,
        scope: "shared",
        createdBy: ctx.user.id,
      });
    }

    return inserted;
  });

  return NextResponse.json(clone, { status: 201 });
}
