import { and, asc, eq, inArray } from "drizzle-orm";
import { db } from "@/lib/db";
import { userDatabaseRows } from "@/lib/db/schema";
import { DUPLICATE_SCAN_MAX_ROWS } from "./limits";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type LoadedRow = { id: string; cells: Record<string, unknown>; position: number };

/**
 * Charge toutes les lignes d'une base (ordre de position), ou `null` si la base
 * dépasse DUPLICATE_SCAN_MAX_ROWS : aucun résultat partiel n'est jamais rendu.
 */
export async function loadRowsWithGuard(databaseId: string): Promise<LoadedRow[] | null> {
  const raw = await db
    .select({
      id: userDatabaseRows.id,
      cells: userDatabaseRows.cells,
      position: userDatabaseRows.position,
    })
    .from(userDatabaseRows)
    .where(eq(userDatabaseRows.databaseId, databaseId))
    .orderBy(asc(userDatabaseRows.position))
    .limit(DUPLICATE_SCAN_MAX_ROWS + 1);
  if (raw.length > DUPLICATE_SCAN_MAX_ROWS) return null;
  return raw.map((r) => ({
    id: r.id,
    cells: (r.cells as Record<string, unknown>) ?? {},
    position: r.position,
  }));
}

/**
 * Charge des lignes par id, bornées à la base `databaseId` (une ligne d'une autre base ou d'une autre
 * organisation n'est jamais rendue). Les ids absents du résultat sont inconnus de cette base.
 */
export async function loadRowsByIds(databaseId: string, rowIds: string[]): Promise<LoadedRow[]> {
  // Un id qui n'est pas un uuid ne peut correspondre à aucune ligne (et ferait échouer la requête).
  const valid = rowIds.filter((id) => UUID_RE.test(id));
  if (valid.length === 0) return [];
  const raw = await db
    .select({
      id: userDatabaseRows.id,
      cells: userDatabaseRows.cells,
      position: userDatabaseRows.position,
    })
    .from(userDatabaseRows)
    .where(and(eq(userDatabaseRows.databaseId, databaseId), inArray(userDatabaseRows.id, valid)));
  return raw.map((r) => ({
    id: r.id,
    cells: (r.cells as Record<string, unknown>) ?? {},
    position: r.position,
  }));
}

/** Date de dernière modification (ms) des lignes demandées, bornées à la base `databaseId`. */
export async function loadRowTimestamps(databaseId: string, rowIds: string[]): Promise<Map<string, number>> {
  const valid = rowIds.filter((id) => UUID_RE.test(id));
  const out = new Map<string, number>();
  if (valid.length === 0) return out;
  const raw = await db
    .select({ id: userDatabaseRows.id, updatedAt: userDatabaseRows.updatedAt })
    .from(userDatabaseRows)
    .where(and(eq(userDatabaseRows.databaseId, databaseId), inArray(userDatabaseRows.id, valid)));
  for (const r of raw) out.set(r.id, r.updatedAt.getTime());
  return out;
}
