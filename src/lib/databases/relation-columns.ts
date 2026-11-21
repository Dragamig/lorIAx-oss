/**
 * Gestion du cycle de vie des colonnes relation jumelées (création, dissolution,
 * suppression). Le jumelage vit dans `config.inverseColumnId` des deux colonnes.
 * Toutes les fonctions s'exécutent dans la transaction fournie par l'appelant ;
 * les contrôles de droits sont faits en amont par les routes.
 */
import { and, eq, inArray, sql } from "drizzle-orm";
import { userDatabaseColumns, userDatabaseRows } from "@/lib/db/schema";
import type { DbExecutor } from "./row-writes";
import { setRowChangeContext, SKIP_ROW_HISTORY } from "./row-change-context";

export class RelationColumnError extends Error {
  constructor(
    public readonly code: "inverse-name-exists",
    message: string
  ) {
    super(message);
  }
}

type Cfg = Record<string, unknown>;

/** Retire `inverseColumnId` d'une config fournie par un client (jamais accepté en entrée). */
export function stripInverseColumnId(config: unknown): Cfg {
  const cfg = { ...((config as Cfg | null) ?? {}) };
  delete cfg.inverseColumnId;
  return cfg;
}

/** Verrous advisory de base posés dans un ordre déterministe (pas d'interblocage croisé). */
async function lockDatabases(tx: DbExecutor, ids: string[]) {
  for (const id of [...new Set(ids)].sort()) {
    await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtextextended(${id}, 0))`);
  }
}

async function nextPosition(tx: DbExecutor, databaseId: string): Promise<number> {
  const [maxPos] = await tx
    .select({ max: sql<number>`COALESCE(MAX(${userDatabaseColumns.position}), -1)` })
    .from(userDatabaseColumns)
    .where(eq(userDatabaseColumns.databaseId, databaseId));
  return (maxPos?.max ?? -1) + 1;
}

export interface PairedCreation {
  column: typeof userDatabaseColumns.$inferSelect;
  inverse: typeof userDatabaseColumns.$inferSelect;
}

/**
 * Crée une colonne relation et sa jumelle dans la base cible, liées par
 * `inverseColumnId`. Lève `RelationColumnError("inverse-name-exists")` si le nom
 * de la jumelle existe déjà dans la base cible.
 */
export async function createPairedRelationColumn(
  tx: DbExecutor,
  input: {
    databaseId: string;
    targetDatabaseId: string;
    name: string;
    config?: Cfg;
    inverseName: string;
  }
): Promise<PairedCreation> {
  const { databaseId, targetDatabaseId, name, inverseName } = input;
  await lockDatabases(tx, [databaseId, targetDatabaseId]);

  const existing = await tx
    .select({ name: userDatabaseColumns.name })
    .from(userDatabaseColumns)
    .where(eq(userDatabaseColumns.databaseId, targetDatabaseId));
  const wanted = inverseName.trim().toLowerCase();
  if (existing.some((c) => c.name.trim().toLowerCase() === wanted)) {
    throw new RelationColumnError(
      "inverse-name-exists",
      `Une colonne nommée « ${inverseName} » existe déjà dans la base cible`
    );
  }

  const [column] = await tx
    .insert(userDatabaseColumns)
    .values({
      databaseId,
      name,
      type: "relation",
      config: { ...stripInverseColumnId(input.config), targetDatabaseId },
      position: await nextPosition(tx, databaseId),
    })
    .returning();

  const [inverse] = await tx
    .insert(userDatabaseColumns)
    .values({
      databaseId: targetDatabaseId,
      name: inverseName,
      type: "relation",
      config: { targetDatabaseId: databaseId, inverseColumnId: column.id },
      position: await nextPosition(tx, targetDatabaseId),
    })
    .returning();

  const [linked] = await tx
    .update(userDatabaseColumns)
    .set({ config: { ...(column.config as Cfg), inverseColumnId: inverse.id } })
    .where(eq(userDatabaseColumns.id, column.id))
    .returning();

  return { column: linked, inverse };
}

/** Jumelle réelle d'une colonne : existe et pointe en retour (sinon null). */
export async function findPairedInverse(
  tx: DbExecutor,
  column: { id: string; config: unknown }
) {
  const inverseId = (column.config as Cfg | null)?.inverseColumnId;
  if (typeof inverseId !== "string" || !inverseId) return null;
  const [inverse] = await tx
    .select()
    .from(userDatabaseColumns)
    .where(eq(userDatabaseColumns.id, inverseId))
    .limit(1);
  if (!inverse || (inverse.config as Cfg | null)?.inverseColumnId !== column.id) return null;
  return inverse;
}

/** La jumelle devient une relation simple (son `inverseColumnId` est retiré). */
export async function unpairInverse(tx: DbExecutor, inverseColumnId: string) {
  await tx
    .update(userDatabaseColumns)
    .set({
      config: sql`COALESCE(${userDatabaseColumns.config}, '{}'::jsonb) - 'inverseColumnId'`,
    })
    .where(eq(userDatabaseColumns.id, inverseColumnId));
}

async function purgeKey(tx: DbExecutor, databaseId: string, columnId: string) {
  await setRowChangeContext(tx, SKIP_ROW_HISTORY);
  await tx
    .update(userDatabaseRows)
    .set({ cells: sql`COALESCE(${userDatabaseRows.cells}, '{}'::jsonb) - ${columnId}::text` })
    .where(eq(userDatabaseRows.databaseId, databaseId));
}

/**
 * Supprime une colonne (jumelée ou non) et purge ses cellules. Pour une
 * colonne jumelée : `alsoDeleteInverse` supprime aussi la jumelle (et ses
 * cellules), sinon la jumelle devient une relation simple.
 */
export async function deleteColumnWithPair(
  tx: DbExecutor,
  input: { databaseId: string; columnId: string; alsoDeleteInverse: boolean }
): Promise<{ deletedInverseColumnId: string | null }> {
  const { databaseId, columnId, alsoDeleteInverse } = input;
  const [column] = await tx
    .select()
    .from(userDatabaseColumns)
    .where(eq(userDatabaseColumns.id, columnId))
    .limit(1);
  const inverse = column ? await findPairedInverse(tx, column) : null;

  if (inverse) {
    // Même ordre que les écrivains de lignes : verrou relpair du couple, puis bases.
    const [lo, hi] = [databaseId, inverse.databaseId].sort();
    await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtextextended(${`relpair:${lo}:${hi}`}, 0))`);
    await lockDatabases(tx, [databaseId, inverse.databaseId]);
    if (alsoDeleteInverse) {
      await tx.delete(userDatabaseColumns).where(eq(userDatabaseColumns.id, inverse.id));
      await purgeKey(tx, inverse.databaseId, inverse.id);
    } else {
      await unpairInverse(tx, inverse.id);
    }
  }

  await tx.delete(userDatabaseColumns).where(eq(userDatabaseColumns.id, columnId));
  await purgeKey(tx, databaseId, columnId);

  return { deletedInverseColumnId: inverse && alsoDeleteInverse ? inverse.id : null };
}

/**
 * Avant la suppression d'une base : dé-jumelle les colonnes situées dans
 * d'autres bases dont la jumelle appartient à la base supprimée.
 * Retourne le nombre de colonnes dé-jumelées.
 */
export async function unpairColumnsOfDeletedDatabase(
  tx: DbExecutor,
  databaseId: string
): Promise<number> {
  const own = await tx
    .select({ id: userDatabaseColumns.id })
    .from(userDatabaseColumns)
    .where(and(eq(userDatabaseColumns.databaseId, databaseId), eq(userDatabaseColumns.type, "relation")));
  if (own.length === 0) return 0;
  const done = await tx
    .update(userDatabaseColumns)
    .set({
      config: sql`COALESCE(${userDatabaseColumns.config}, '{}'::jsonb) - 'inverseColumnId'`,
    })
    .where(
      and(
        sql`${userDatabaseColumns.databaseId} <> ${databaseId}`,
        eq(userDatabaseColumns.type, "relation"),
        inArray(sql`${userDatabaseColumns.config}->>'inverseColumnId'`, own.map((c) => c.id))
      )
    )
    .returning({ id: userDatabaseColumns.id });
  return done.length;
}
