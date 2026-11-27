import { and, asc, eq, inArray, isNull, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import {
  spaces,
  userDatabases,
  userDatabaseColumns,
} from "@/lib/db/schema";

export type AccessibleDatabase = {
  id: string;
  name: string;
  spaceId: string;
  spaceName: string;
  rowCount: number;
};

export type DatabaseColumn = { id: string; name: string; type: string };

export type DatabaseSummary = { id: string; name: string; rowCount: number };

/**
 * Bases actives (ni archivées ni supprimées) des espaces donnés, bornées à
 * l'organisation. Le filtre organisation s'applique en plus de `spaceIds` :
 * un espace d'une autre organisation n'est jamais rendu.
 */
export async function listAccessibleDatabases(args: {
  orgId: string;
  spaceIds: string[];
}): Promise<AccessibleDatabase[]> {
  if (args.spaceIds.length === 0) return [];
  const rows = await db
    .select({
      id: userDatabases.id,
      name: userDatabases.name,
      spaceId: userDatabases.spaceId,
      spaceName: spaces.name,
      rowCount: sql<number>`(select count(*)::int from user_database_rows r where r.database_id = user_databases.id)`,
    })
    .from(userDatabases)
    .innerJoin(spaces, eq(spaces.id, userDatabases.spaceId))
    .where(
      and(
        eq(spaces.organizationId, args.orgId),
        inArray(userDatabases.spaceId, args.spaceIds),
        isNull(userDatabases.archivedAt),
        isNull(userDatabases.deletedAt),
      ),
    )
    .orderBy(asc(spaces.name), asc(userDatabases.name));
  return rows.map((r) => ({ ...r, rowCount: Number(r.rowCount) }));
}

/** Colonnes d'une base, dans l'ordre d'affichage. Le contrôle d'accès reste à l'appelant. */
export async function getDatabaseColumns(databaseId: string): Promise<DatabaseColumn[]> {
  return db
    .select({
      id: userDatabaseColumns.id,
      name: userDatabaseColumns.name,
      type: userDatabaseColumns.type,
    })
    .from(userDatabaseColumns)
    .where(eq(userDatabaseColumns.databaseId, databaseId))
    .orderBy(asc(userDatabaseColumns.position), asc(userDatabaseColumns.createdAt));
}

/** Nom et nombre de lignes d'une base (pour describe_database). Le contrôle d'accès reste à l'appelant. */
export async function getDatabaseSummary(databaseId: string): Promise<DatabaseSummary | null> {
  const [row] = await db
    .select({
      id: userDatabases.id,
      name: userDatabases.name,
      rowCount: sql<number>`(select count(*)::int from user_database_rows r where r.database_id = user_databases.id)`,
    })
    .from(userDatabases)
    .where(eq(userDatabases.id, databaseId))
    .limit(1);
  return row ? { ...row, rowCount: Number(row.rowCount) } : null;
}
