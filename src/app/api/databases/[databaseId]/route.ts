import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import {
  userDatabases,
  userDatabaseColumns,
  userDatabaseRows,
  userDatabaseGroups,
} from "@/lib/db/schema";
import { eq, sql } from "drizzle-orm";
import { requireOrgScoped, OrgScopeError } from "@/lib/auth/require-org-scoped";
import { z } from "zod";
import { unpairColumnsOfDeletedDatabase } from "@/lib/databases/relation-columns";

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ databaseId: string }> }
) {
  const { databaseId } = await params;
  try {
    await requireOrgScoped({ resource: { type: "database", id: databaseId }, minPermission: "viewer" });
  } catch (e) {
    if (e instanceof OrgScopeError) return e.response;
    throw e;
  }

  const [database] = await db
    .select()
    .from(userDatabases)
    .where(eq(userDatabases.id, databaseId))
    .limit(1);
  if (!database) {
    return NextResponse.json({ error: "Introuvable" }, { status: 404 });
  }

  const [columns, rows] = await Promise.all([
    db
      .select()
      .from(userDatabaseColumns)
      .where(eq(userDatabaseColumns.databaseId, databaseId))
      .orderBy(userDatabaseColumns.position),
    db
      .select()
      .from(userDatabaseRows)
      .where(eq(userDatabaseRows.databaseId, databaseId))
      .orderBy(userDatabaseRows.position),
  ]);

  return NextResponse.json({ ...database, columns, rows });
}

const updateSchema = z.object({
  name: z.string().min(1).optional(),
  description: z.string().optional(),
  groupId: z.string().uuid().nullable().optional(),
});

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ databaseId: string }> }
) {
  const { databaseId } = await params;
  try {
    await requireOrgScoped({
      resource: { type: "database", id: databaseId },
      minPermission: "editor",
    });
  } catch (e) {
    if (e instanceof OrgScopeError) return e.response;
    throw e;
  }

  const body = await request.json();
  const parsed = updateSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0].message },
      { status: 400 }
    );
  }

  // Intégrité : si on rattache la base à un groupe, ce groupe doit appartenir
  // au même espace que la base (sinon une base pourrait référencer un groupe
  // d'un autre espace de l'org — incohérence d'affichage).
  if (parsed.data.groupId) {
    const [base] = await db
      .select({ spaceId: userDatabases.spaceId })
      .from(userDatabases)
      .where(eq(userDatabases.id, databaseId))
      .limit(1);
    const [group] = await db
      .select({ spaceId: userDatabaseGroups.spaceId })
      .from(userDatabaseGroups)
      .where(eq(userDatabaseGroups.id, parsed.data.groupId))
      .limit(1);
    if (!group || !base || group.spaceId !== base.spaceId) {
      return NextResponse.json(
        { error: "Groupe invalide pour cet espace" },
        { status: 400 }
      );
    }
  }

  const [updated] = await db
    .update(userDatabases)
    .set({ ...parsed.data, updatedAt: new Date() })
    .where(eq(userDatabases.id, databaseId))
    .returning();

  if (!updated) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  return NextResponse.json(updated);
}

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ databaseId: string }> }
) {
  const { databaseId } = await params;
  try {
    await requireOrgScoped({
      resource: { type: "database", id: databaseId },
      minPermission: "editor",
    });
  } catch (e) {
    if (e instanceof OrgScopeError) return e.response;
    throw e;
  }

  // Les colonnes jumelles situées dans d'autres bases redeviennent des relations simples.
  await db.transaction(async (tx) => {
    // Même verrou que la création de colonne jumelée : pas de jumelage concurrent
    // pendant la lecture et le dé-jumelage.
    await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtextextended(${databaseId}, 0))`);
    await unpairColumnsOfDeletedDatabase(tx, databaseId);
    await tx.delete(userDatabases).where(eq(userDatabases.id, databaseId));
  });

  return NextResponse.json({ ok: true });
}
