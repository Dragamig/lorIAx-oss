import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { userDatabaseColumns } from "@/lib/db/schema";
import { diffRelationIds, pairedRelationColumns } from "./relation-sync";
import { canTargetRelationDatabase } from "./relation-target-access";

export type RelationGuardResult = { ok: true } | { ok: false; status: 403; error: string };

export interface RelationWrite {
  cells: Record<string, unknown>;
  /** Valeur enregistrée de la ligne (PATCH) : seules les cibles ajoutées ou retirées sont contrôlées. */
  stored?: Record<string, unknown>;
}

/**
 * Une écriture de cellule relation jumelée modifie aussi les lignes de la base
 * cible (relation-sync). L'utilisateur doit donc pouvoir éditer cette base.
 * Contrôle fait avant toute écriture : refus 403, aucune écriture partielle.
 */
export async function validateRelationWrites(
  databaseId: string,
  writes: RelationWrite[]
): Promise<RelationGuardResult> {
  if (writes.length === 0) return { ok: true };
  const columns = await db
    .select({ id: userDatabaseColumns.id, type: userDatabaseColumns.type, config: userDatabaseColumns.config })
    .from(userDatabaseColumns)
    .where(eq(userDatabaseColumns.databaseId, databaseId));
  const paired = pairedRelationColumns(columns);
  if (paired.length === 0) return { ok: true };

  const checked = new Map<string, boolean>();
  for (const w of writes) {
    for (const pc of paired) {
      if (!(pc.columnId in w.cells)) continue;
      const { added, removed } = diffRelationIds(w.stored?.[pc.columnId], w.cells[pc.columnId]);
      if (added.length === 0 && removed.length === 0) continue;
      let ok = checked.get(pc.targetDatabaseId);
      if (ok === undefined) {
        ok = await canTargetRelationDatabase(pc.targetDatabaseId);
        checked.set(pc.targetDatabaseId, ok);
      }
      if (!ok) {
        return { ok: false, status: 403, error: "Accès refusé à la base cible de la relation" };
      }
    }
  }
  return { ok: true };
}
