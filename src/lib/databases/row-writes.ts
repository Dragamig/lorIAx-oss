/**
 * Écritures de lignes d'une base utilisateur — logique partagée.
 *
 * Extrait de `api/databases/[databaseId]/rows/route.ts` afin d'être réutilisé
 * par les actions d'automatisation create_row / update_row sans dupliquer la
 * gestion du verrou advisory, des colonnes autonumber et du merge atomique.
 *
 * IMPORTANT : ces helpers n'émettent AUCUN déclencheur d'automatisation. Le
 * dispatch (row_created / row_updated / value_changed) reste de la
 * responsabilité de l'appelant HTTP. Les actions d'automatisation appellent ces
 * helpers volontairement SANS dispatcher, pour éviter les boucles
 * (create_row → row_created → create_row → …).
 */
import { db } from "@/lib/db";
import { userDatabaseRows, userDatabaseColumns } from "@/lib/db/schema";
import { and, asc, eq, sql } from "drizzle-orm";
import { columnsToFill } from "./cell-compare";
import { lockRelationPairs, syncRelationInverses } from "./relation-sync";
import { setRowChangeContext, type RowChangeContext } from "./row-change-context";

type Row = typeof userDatabaseRows.$inferSelect;

/** Exécuteur Drizzle : la connexion globale ou une transaction en cours. */
export type DbExecutor = typeof db | Parameters<Parameters<typeof db.transaction>[0]>[0];

/**
 * Garde de médias (cellules `attachment` et `image`) : appliquée avant toute
 * écriture quand le contexte porte un `mediaGuard`. Import différé : le garde
 * lit lui-même les types de colonnes de ce module.
 */
export async function enforceMediaGuard(
  databaseId: string,
  cells: Record<string, unknown>,
  ctx?: RowChangeContext,
  known?: Record<string, unknown>
): Promise<void> {
  if (!ctx?.mediaGuard) return;
  const { assertMediaCells } = await import("./attachment-cell-guard");
  await assertMediaCells(databaseId, cells, ctx.mediaGuard, known);
}

/**
 * Sérialise les « chercher puis créer/fusionner » concurrents sur une même
 * valeur de correspondance : ouvre une transaction, prend un verrou advisory
 * sur (databaseId, columnId, valeur normalisée : trim + minuscules, comme
 * `findRowByCellValue`) puis exécute `fn` avec la transaction. Le verrou est
 * relâché au commit.
 */
export async function withMatchLock<T>(
  databaseId: string,
  columnId: string,
  value: string,
  fn: (tx: DbExecutor) => Promise<T>
): Promise<T> {
  const key = `match:${databaseId}:${columnId}:${value.trim().toLowerCase()}`;
  return db.transaction(async (tx) => {
    await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtextextended(${key}, 0))`);
    return fn(tx);
  });
}

/**
 * Insère une ligne dans une base. Sérialise les inserts concurrents via
 * pg_advisory_xact_lock(databaseId) → MAX(position) et MAX(autonumber) calculés
 * sous verrou exclusif (pas de doublons). Les colonnes autonumber non fournies
 * sont auto-incrémentées.
 */
export async function createDatabaseRow(
  databaseId: string,
  cellsInput: Record<string, unknown>,
  executor: DbExecutor = db,
  ctx?: RowChangeContext
): Promise<Row> {
  await enforceMediaGuard(databaseId, cellsInput, ctx);
  const cells: Record<string, unknown> = { ...cellsInput };

  return executor.transaction(async (tx) => {
    if (ctx) await setRowChangeContext(tx, ctx);
    // Ordre de verrous unique : relpair AVANT le verrou de la base (les autres
    // écrivains prennent relpair puis des verrous de ligne, jamais l'inverse).
    await lockRelationPairs(tx, databaseId);
    await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtextextended(${databaseId}, 0))`);

    const [maxPos] = await tx
      .select({ max: sql<number>`COALESCE(MAX(${userDatabaseRows.position}), -1)` })
      .from(userDatabaseRows)
      .where(eq(userDatabaseRows.databaseId, databaseId));

    const autoCols = await tx
      .select()
      .from(userDatabaseColumns)
      .where(
        and(
          eq(userDatabaseColumns.databaseId, databaseId),
          eq(userDatabaseColumns.type, "autonumber")
        )
      );

    if (autoCols.length > 0) {
      const existingRows = await tx
        .select({ cells: userDatabaseRows.cells })
        .from(userDatabaseRows)
        .where(eq(userDatabaseRows.databaseId, databaseId));

      for (const col of autoCols) {
        if (typeof cells[col.id] === "number" && Number.isFinite(cells[col.id] as number)) continue;
        const cfg = (col.config as Record<string, unknown> | null) ?? {};
        const start = typeof cfg.startNumber === "number" ? cfg.startNumber : 1;
        let maxExisting: number | null = null;
        for (const r of existingRows) {
          const v = (r.cells as Record<string, unknown> | null)?.[col.id];
          if (typeof v === "number" && Number.isFinite(v)) {
            maxExisting = maxExisting == null ? v : Math.max(maxExisting, v);
          }
        }
        cells[col.id] = maxExisting != null ? maxExisting + 1 : start;
      }
    }

    const [inserted] = await tx
      .insert(userDatabaseRows)
      .values({
        databaseId,
        cells,
        position: (maxPos?.max ?? -1) + 1,
      })
      .returning();
    await syncRelationInverses(tx, {
      databaseId,
      rowId: inserted.id,
      before: {},
      after: (inserted.cells as Record<string, unknown> | null) ?? {},
      ctx,
    });
    return inserted;
  });
}

/**
 * Merge atomique des cellules d'une ligne (opérateur jsonb `||` sous le verrou
 * de ligne natif Postgres). Le filtre databaseId conserve le garde-fou org :
 * impossible de modifier une ligne d'une autre base. Renvoie `undefined` si la
 * ligne n'existe pas dans cette base.
 */
export async function mergeDatabaseRowCells(
  databaseId: string,
  rowId: string,
  cells: Record<string, unknown>,
  opts: { appendColumns?: string[] } = {},
  executor: DbExecutor = db,
  ctx?: RowChangeContext
): Promise<Row | undefined> {
  await enforceMediaGuard(databaseId, cells, ctx);
  const appendColumns = (opts.appendColumns ?? []).filter(
    (c) => Array.isArray(cells[c]) && c in cells
  );
  const replaced: Record<string, unknown> = { ...cells };
  for (const c of appendColumns) delete replaced[c];

  // Un seul UPDATE : l'union (sans doublon, ordre conservé) est calculée côté SQL
  // sur la version verrouillée de la ligne, donc aucune écriture concurrente perdue.
  let expr = sql`COALESCE(${userDatabaseRows.cells}, '{}'::jsonb) || ${JSON.stringify(replaced)}::jsonb`;
  for (const c of appendColumns) {
    const incoming = JSON.stringify(cells[c]);
    expr = sql`${expr} || jsonb_build_object(${c}::text, (
      SELECT COALESCE(jsonb_agg(u.v ORDER BY u.ord), '[]'::jsonb) FROM (
        SELECT DISTINCT ON (t.v) t.v, t.ord FROM jsonb_array_elements_text(
          (CASE WHEN jsonb_typeof(${userDatabaseRows.cells} -> ${c}::text) = 'array'
                THEN ${userDatabaseRows.cells} -> ${c}::text ELSE '[]'::jsonb END) || ${incoming}::jsonb
        ) WITH ORDINALITY AS t(v, ord) ORDER BY t.v, t.ord
      ) u
    ))`;
  }

  return executor.transaction(async (tx) => {
    if (ctx) await setRowChangeContext(tx, ctx);
    await lockRelationPairs(tx, databaseId);
    const [existing] = await tx
      .select({ cells: userDatabaseRows.cells })
      .from(userDatabaseRows)
      .where(and(eq(userDatabaseRows.id, rowId), eq(userDatabaseRows.databaseId, databaseId)))
      .for("update");
    if (!existing) return undefined;
    const [updated] = await tx
      .update(userDatabaseRows)
      .set({ cells: expr, updatedAt: new Date() })
      .where(and(eq(userDatabaseRows.id, rowId), eq(userDatabaseRows.databaseId, databaseId)))
      .returning();
    if (updated) {
      await syncRelationInverses(tx, {
        databaseId,
        rowId,
        before: (existing.cells as Record<string, unknown> | null) ?? {},
        after: (updated.cells as Record<string, unknown> | null) ?? {},
        ctx,
      });
    }
    return updated;
  });
}

/**
 * Supprime une ligne et retire son id des cellules inverses des lignes liées
 * (relations jumelées), dans la même transaction. Renvoie `false` si la ligne
 * n'existe pas dans cette base. N'émet aucun déclencheur d'automatisation.
 */
export async function deleteDatabaseRow(
  databaseId: string,
  rowId: string,
  executor: DbExecutor = db,
  ctx?: RowChangeContext
): Promise<boolean> {
  return executor.transaction(async (tx) => {
    if (ctx) await setRowChangeContext(tx, ctx);
    await lockRelationPairs(tx, databaseId);
    const [existing] = await tx
      .select({ cells: userDatabaseRows.cells })
      .from(userDatabaseRows)
      .where(and(eq(userDatabaseRows.id, rowId), eq(userDatabaseRows.databaseId, databaseId)))
      .for("update");
    if (!existing) return false;
    const before = (existing.cells as Record<string, unknown> | null) ?? {};
    const after = Object.fromEntries(Object.keys(before).map((k) => [k, []]));
    await syncRelationInverses(tx, { databaseId, rowId, before, after, ctx });
    await tx
      .delete(userDatabaseRows)
      .where(and(eq(userDatabaseRows.id, rowId), eq(userDatabaseRows.databaseId, databaseId)));
    return true;
  });
}

/** Types des colonnes d'une base, indexés par id de colonne. */
export async function loadColumnTypes(databaseId: string): Promise<Record<string, string>> {
  const cols = await db
    .select({ id: userDatabaseColumns.id, type: userDatabaseColumns.type })
    .from(userDatabaseColumns)
    .where(eq(userDatabaseColumns.databaseId, databaseId));
  return Object.fromEntries(cols.map((c) => [c.id, c.type]));
}

/**
 * Cherche, en SQL (jsonb), la plus ancienne ligne dont la cellule `columnId`
 * égale `value`, sans casse ni espaces de bord. Une cellule non textuelle est
 * comparée via sa représentation texte. Valeur vide : aucune recherche.
 */
export async function findRowByCellValue(
  databaseId: string,
  columnId: string,
  value: string,
  executor: DbExecutor = db
): Promise<Row | undefined> {
  const needle = value.trim().toLowerCase();
  if (!needle) return undefined;
  const [found] = await executor
    .select()
    .from(userDatabaseRows)
    .where(
      and(
        eq(userDatabaseRows.databaseId, databaseId),
        sql`lower(btrim(${userDatabaseRows.cells} ->> ${columnId})) = ${needle}`
      )
    )
    .orderBy(asc(userDatabaseRows.createdAt), asc(userDatabaseRows.position))
    .limit(1);
  return found;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Lit une ligne par identifiant, bornée à la base `databaseId` : une ligne
 * d'une autre base n'est jamais renvoyée. Identifiant qui n'est pas un uuid :
 * aucune requête.
 */
export async function findRowById(
  databaseId: string,
  rowId: string,
  executor: DbExecutor = db
): Promise<Row | undefined> {
  const id = rowId.trim();
  if (!UUID_RE.test(id)) return undefined;
  const [found] = await executor
    .select()
    .from(userDatabaseRows)
    .where(and(eq(userDatabaseRows.id, id), eq(userDatabaseRows.databaseId, databaseId)))
    .limit(1);
  return found;
}

/**
 * Complète les seules cellules vides d'une ligne, en un seul UPDATE : la ligne
 * est verrouillée (FOR UPDATE), la fusion jsonb ne prend une clé entrante que si
 * elle est absente ou vide dans l'existant, donc aucune écriture concurrente
 * perdue ni valeur existante écrasée. Les colonnes en `appendColumns` sont
 * unies (sans doublon). Renvoie la ligne et les colonnes réellement remplies,
 * ou `undefined` si la ligne n'existe pas dans cette base.
 */
export async function fillEmptyRowCells(
  databaseId: string,
  rowId: string,
  cells: Record<string, unknown>,
  opts: { appendColumns?: string[] } = {},
  executor: DbExecutor = db,
  ctx?: RowChangeContext
): Promise<{ row: Row; filledColumns: string[] } | undefined> {
  await enforceMediaGuard(databaseId, cells, ctx);
  const appendColumns = (opts.appendColumns ?? []).filter((c) => Array.isArray(cells[c]));
  const plain: Record<string, unknown> = { ...cells };
  for (const c of appendColumns) delete plain[c];

  let expr = sql`COALESCE(o.cells, '{}'::jsonb) || COALESCE((
    SELECT jsonb_object_agg(e.key, e.value) FROM jsonb_each(${JSON.stringify(plain)}::jsonb) e
    WHERE NOT (
      CASE
        WHEN jsonb_typeof(e.value) = 'null' THEN true
        WHEN jsonb_typeof(e.value) = 'string' THEN btrim(e.value #>> '{}') = ''
        WHEN jsonb_typeof(e.value) = 'array' THEN jsonb_array_length(e.value) = 0
        ELSE false END
    ) AND (
      o.cells -> e.key IS NULL
      OR jsonb_typeof(o.cells -> e.key) = 'null'
      OR (jsonb_typeof(o.cells -> e.key) = 'string' AND btrim(o.cells ->> e.key) = '')
      OR (jsonb_typeof(o.cells -> e.key) = 'array' AND jsonb_array_length(o.cells -> e.key) = 0)
    )
  ), '{}'::jsonb)`;
  for (const c of appendColumns) {
    const incoming = JSON.stringify(cells[c]);
    expr = sql`${expr} || jsonb_build_object(${c}::text, (
      SELECT COALESCE(jsonb_agg(u.v ORDER BY u.ord), '[]'::jsonb) FROM (
        SELECT DISTINCT ON (t.v) t.v, t.ord FROM jsonb_array_elements_text(
          (CASE WHEN jsonb_typeof(o.cells -> ${c}::text) = 'array'
                THEN o.cells -> ${c}::text ELSE '[]'::jsonb END) || ${incoming}::jsonb
        ) WITH ORDINALITY AS t(v, ord) ORDER BY t.v, t.ord
      ) u
    ))`;
  }

  return executor.transaction(async (tx) => {
  if (ctx) await setRowChangeContext(tx, ctx);
  await lockRelationPairs(tx, databaseId);
  const result = await tx.execute(sql`
    UPDATE user_database_rows r
    SET cells = ${expr}, updated_at = now()
    FROM (
      SELECT id, cells FROM user_database_rows
      WHERE id = ${rowId} AND database_id = ${databaseId} FOR UPDATE
    ) o
    WHERE r.id = o.id
    RETURNING r.id, r.database_id AS "databaseId", r.cells, r.position,
      r.created_at AS "createdAt", r.updated_at AS "updatedAt", o.cells AS "oldCells"
  `);
  const rows = (Array.isArray(result) ? result : (result as { rows: unknown[] }).rows) as Array<
    Row & { oldCells: Record<string, unknown> | null }
  >;
  const found = rows[0];
  if (!found) return undefined;
  const { oldCells, ...row } = found;
  await syncRelationInverses(tx, {
    databaseId,
    rowId,
    before: oldCells ?? {},
    after: (row.cells as Record<string, unknown> | null) ?? {},
    ctx,
  });
  return { row: row as Row, filledColumns: columnsToFill(oldCells, cells, appendColumns) };
  });
}
