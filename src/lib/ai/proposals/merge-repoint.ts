import { and, eq, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { userDatabaseColumns } from "@/lib/db/schema";
import { pairedRelationColumns } from "@/lib/databases/relation-sync";
import type { RepointedRelation } from "./types";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** Garde-fou : au-delà, la fusion est refusée plutôt que planifiée partiellement. */
export const REPOINT_MAX_ROWS = 500;

export class RepointLimitError extends Error {}

export type RepointScan = {
  repoints: RepointedRelation[];
  /** Lignes porteuses (cellules complètes), pour l'empreinte de fraîcheur. */
  holderRows: { id: string; cells: Record<string, unknown> }[];
};

function ids(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((v): v is string => typeof v === "string" && v !== "") : [];
}

/**
 * Relations unidirectionnelles (sans jumelle réciproque vérifiée, donc ignorées par la synchronisation d'inverse)
 * qui pointent vers une ligne retirée : lignes hors groupe de la même organisation à repointer vers la conservée.
 * `removedToKeep` : id d'une ligne retirée -> id de la ligne conservée de son groupe. Les lignes des groupes
 * sont aussi listées : buildMergeWrites écarte celles dont le groupe est retenu (cellules réunies sur la conservée).
 */
export async function scanUnidirectionalRepoints(
  databaseId: string,
  removedToKeep: Map<string, string>,
): Promise<RepointScan> {
  const removed = [...removedToKeep.keys()].filter((id) => UUID_RE.test(id));
  if (removed.length === 0) return { repoints: [], holderRows: [] };

  const own = await db
    .select({ id: userDatabaseColumns.id, type: userDatabaseColumns.type, config: userDatabaseColumns.config })
    .from(userDatabaseColumns)
    .where(and(eq(userDatabaseColumns.databaseId, databaseId), eq(userDatabaseColumns.type, "relation")));

  // Colonnes relation de la même organisation ciblant cette base.
  const res = await db.execute(sql`
    SELECT c.id AS id, c.database_id AS database_id, c.type AS type, c.config AS config
    FROM user_database_columns c
    JOIN user_databases d ON d.id = c.database_id
    JOIN spaces s ON s.id = d.space_id
    JOIN user_databases od ON od.id = ${databaseId}::uuid
    JOIN spaces os ON os.id = od.space_id
    WHERE c.type = 'relation'
      AND c.config ->> 'targetDatabaseId' = ${databaseId}::text
      AND s.organization_id = os.organization_id
  `);
  const cols = (Array.isArray(res) ? res : (res as { rows: unknown[] }).rows) as {
    id: string;
    database_id: string;
    type: string;
    config: unknown;
  }[];

  const ownById = new Map(own.map((c) => [c.id, c]));
  const unidirectional = cols.filter((c) => {
    const pair = pairedRelationColumns([{ id: c.id, type: c.type, config: c.config }])[0];
    if (!pair) return true;
    // Jumelle déclarée : elle n'est synchronisée que si la colonne inverse (de cette base) pointe en retour.
    const inv = ownById.get(pair.inverseColumnId);
    const invCfg = inv?.config as Record<string, unknown> | null | undefined;
    const reciprocal = invCfg?.targetDatabaseId === c.database_id && invCfg?.inverseColumnId === c.id;
    return !reciprocal;
  });

  const repoints: RepointedRelation[] = [];
  const holders = new Map<string, Record<string, unknown>>();
  for (const col of unidirectional) {
    if (!UUID_RE.test(col.id) || !UUID_RE.test(col.database_id)) continue;
    const found = await db.execute(sql`
      SELECT r.id AS id, r.cells AS cells
      FROM user_database_rows r
      WHERE r.database_id = ${col.database_id}::uuid
        AND jsonb_exists_any(r.cells -> ${col.id}::text, ${sql.raw(`ARRAY[${removed.map((r) => `'${r}'`).join(",")}]::text[]`)})
      ORDER BY r.id
    `);
    const rows = (Array.isArray(found) ? found : (found as { rows: unknown[] }).rows) as {
      id: string;
      cells: Record<string, unknown>;
    }[];
    for (const row of rows) {
      const before = ids(row.cells?.[col.id]);
      if (!before.some((id) => removedToKeep.has(id))) continue;
      repoints.push({ rowId: row.id, databaseId: col.database_id, columnId: col.id, before });
      holders.set(row.id, row.cells ?? {});
      if (holders.size > REPOINT_MAX_ROWS) {
        throw new RepointLimitError(
          `Plus de ${REPOINT_MAX_ROWS} lignes d'autres tables pointent vers des doublons à retirer : fusion refusée`,
        );
      }
    }
  }
  return { repoints, holderRows: [...holders].map(([id, cells]) => ({ id, cells })) };
}
