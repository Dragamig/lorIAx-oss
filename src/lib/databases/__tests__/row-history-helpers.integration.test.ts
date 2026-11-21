/**
 * Row history written through the real write helpers with a row context
 * (task 3). Requires RELATIONS_TEST_DATABASE_URL; skipped otherwise.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { randomUUID } from "crypto";
import { sql } from "drizzle-orm";
import type { Pool } from "pg";
import { setupRowHistoryFixture } from "./row-history-fixture";
import {
  createDatabaseRow,
  mergeDatabaseRowCells,
  deleteDatabaseRow,
  fillEmptyRowCells,
  type DbExecutor,
} from "../row-writes";
import { deleteDatabaseRows, restoreDatabaseRows, duplicateDatabaseRows } from "../row-batch";
import { setRowChangeContext, SKIP_ROW_HISTORY, type RowChangeContext } from "../row-change-context";

const URL = process.env.RELATIONS_TEST_DATABASE_URL;
const DB_NAME = URL ? new globalThis.URL(URL).pathname.replace(/^\//, "") : "";
if (URL && !DB_NAME.includes("test")) {
  throw new Error(`RELATIONS_TEST_DATABASE_URL doit viser une base de test, reçu "${DB_NAME}"`);
}

describe.skipIf(!URL)("row history via helpers", () => {
  let pool: Pool;
  let db: DbExecutor;
  let teardown: () => Promise<void>;
  const DB = randomUUID();
  const SPACE = randomUUID();
  const USER = randomUUID();
  const COL_A = randomUUID();
  const COL_B = randomUUID();
  const BATCH = randomUUID();

  const ui = (extra: Partial<RowChangeContext> = {}): RowChangeContext => ({
    source: "ui",
    actorUserId: USER,
    batchId: BATCH,
    ...extra,
  });

  async function history() {
    const r = await pool.query(
      "SELECT row_id, kind, source, actor_user_id, batch_id, changes FROM database_row_changes ORDER BY created_at, id"
    );
    return r.rows;
  }

  beforeAll(async () => {
    const f = await setupRowHistoryFixture(URL!, "rh_helpers");
    pool = f.pool;
    db = f.db as unknown as DbExecutor;
    teardown = f.teardown;
  });
  afterAll(async () => {
    await teardown();
  });
  beforeEach(async () => {
    await pool.query(
      "TRUNCATE activity_log, database_row_changes, external_row_tracking, external_database_mappings, user_database_rows, user_database_columns, user_databases, users"
    );
    await pool.query("INSERT INTO users (id) VALUES ($1)", [USER]);
    await pool.query("INSERT INTO user_databases (id, space_id) VALUES ($1, $2)", [DB, SPACE]);
    await pool.query(
      `INSERT INTO user_database_columns (id, database_id, name, type, position) VALUES
        ($1, $3, 'Nom', 'text', 0), ($2, $3, 'Montant', 'number', 1)`,
      [COL_A, COL_B, DB]
    );
  });

  it("createDatabaseRow avec ctx ui : created, acteur et batch du contexte", async () => {
    const row = await createDatabaseRow(DB, { [COL_A]: "x" }, db, ui());
    const h = await history();
    expect(h).toHaveLength(1);
    expect(h[0]).toMatchObject({ row_id: row.id, kind: "created", source: "ui", actor_user_id: USER, batch_id: BATCH });
  });

  it("mergeDatabaseRowCells : updated avec diff avant et après", async () => {
    const row = await createDatabaseRow(DB, { [COL_A]: "x" }, db, ui());
    await mergeDatabaseRowCells(DB, row.id, { [COL_A]: "y" }, {}, db, ui());
    const h = (await history()).filter((e) => e.kind === "updated");
    expect(h).toHaveLength(1);
    expect(h[0].changes).toEqual([
      expect.objectContaining({ columnId: COL_A, before: "x", after: "y" }),
    ]);
  });

  it("deleteDatabaseRow : deleted avec les cellules en before", async () => {
    const row = await createDatabaseRow(DB, { [COL_A]: "x" }, db, ui());
    expect(await deleteDatabaseRow(DB, row.id, db, ui())).toBe(true);
    const h = (await history()).filter((e) => e.kind === "deleted");
    expect(h).toHaveLength(1);
    expect(h[0].changes).toEqual([expect.objectContaining({ columnId: COL_A, before: "x" })]);
  });

  it("deleteDatabaseRows : plusieurs lignes, un seul batch_id", async () => {
    const a = await createDatabaseRow(DB, { [COL_A]: "a" }, db);
    const b = await createDatabaseRow(DB, { [COL_A]: "b" }, db);
    await pool.query("TRUNCATE database_row_changes");
    await deleteDatabaseRows(DB, [a.id, b.id], db, { source: "ui", actorUserId: USER });
    const h = await history();
    expect(h).toHaveLength(2);
    expect(new Set(h.map((e) => e.batch_id)).size).toBe(1);
    expect(h.every((e) => e.kind === "deleted" && e.source === "ui")).toBe(true);
  });

  it("duplicateDatabaseRows : created par copie, source du contexte", async () => {
    const a = await createDatabaseRow(DB, { [COL_A]: "a" }, db);
    const b = await createDatabaseRow(DB, { [COL_A]: "b" }, db);
    await pool.query("TRUNCATE database_row_changes");
    const copies = await duplicateDatabaseRows(DB, [a.id, b.id], db, ui());
    const h = await history();
    expect(copies).toHaveLength(2);
    expect(h).toHaveLength(2);
    expect(h.every((e) => e.kind === "created" && e.source === "ui" && e.batch_id === BATCH)).toBe(true);
    expect(h.map((e) => e.row_id).sort()).toEqual(copies.map((c) => c.id).sort());
  });

  it("fillEmptyRowCells : updated limité aux cellules remplies", async () => {
    const row = await createDatabaseRow(DB, { [COL_A]: "keep" }, db);
    await pool.query("TRUNCATE database_row_changes");
    const res = await fillEmptyRowCells(DB, row.id, { [COL_A]: "ignored", [COL_B]: 5 }, {}, db, ui());
    expect(res?.filledColumns).toEqual([COL_B]);
    const h = await history();
    expect(h).toHaveLength(1);
    expect(h[0].changes).toEqual([expect.objectContaining({ columnId: COL_B, after: 5 })]);
  });

  it("appel sans ctx : entrée system", async () => {
    await createDatabaseRow(DB, { [COL_A]: "x" }, db);
    const h = await history();
    expect(h).toHaveLength(1);
    expect(h[0]).toMatchObject({ kind: "created", source: "system", actor_user_id: null });
  });

  it("restoreDatabaseRows ctx restore : l'historique antérieur est conservé et une entrée created source restore s'ajoute", async () => {
    const row = await createDatabaseRow(DB, { [COL_A]: "x" }, db, ui());
    const [snap] = await deleteDatabaseRows(DB, [row.id], db, ui());
    await restoreDatabaseRows(DB, [snap], db, {}, { source: "restore", actorUserId: USER });
    const h = await history();
    expect(h.map((e) => `${e.kind}:${e.source}`)).toEqual(["created:ui", "deleted:ui", "created:restore"]);
    expect(h.every((e) => e.row_id === row.id)).toBe(true);
  });

  it("échec injecté après l'écriture dans la transaction englobante : ni ligne ni historique", async () => {
    await expect(
      db.transaction(async (tx) => {
        await createDatabaseRow(DB, { [COL_A]: "x" }, tx, ui());
        throw new Error("boom");
      })
    ).rejects.toThrow("boom");
    expect((await pool.query("SELECT 1 FROM user_database_rows")).rowCount).toBe(0);
    expect(await history()).toHaveLength(0);
  });

  it("deux mergeDatabaseRowCells simultanés (Promise.all) sur deux colonnes : deux entrées, le before de la seconde contient la valeur de la première", async () => {
    const row = await createDatabaseRow(DB, {}, db);
    await pool.query("TRUNCATE database_row_changes");
    await Promise.all([
      mergeDatabaseRowCells(DB, row.id, { [COL_A]: "a" }, {}, db, ui()),
      mergeDatabaseRowCells(DB, row.id, { [COL_B]: 2 }, {}, db, ui()),
    ]);
    const h = await history();
    expect(h).toHaveLength(2);
    const [first, second] = h;
    const firstCol = first.changes[0].columnId as string;
    const secondChanges = second.changes as Array<{ columnId: string; before: unknown; after: unknown }>;
    expect(secondChanges).toHaveLength(1);
    expect(secondChanges[0].columnId).not.toBe(firstCol);
    const final = (await pool.query("SELECT cells FROM user_database_rows WHERE id = $1", [row.id])).rows[0].cells;
    expect(final).toEqual({ [COL_A]: "a", [COL_B]: 2 });
    // Row lock serializes: the second write started from the first one's result.
    const firstAfter = first.changes[0].after;
    expect(final[firstCol]).toEqual(firstAfter);
    // The second entry's before is null for its own column; the first column's value is already in the row.
    expect(secondChanges[0].before).toBeNull();
  });

  it("contexte hérité : dans une transaction englobante, un second helper sans ctx hérite du contexte du premier", async () => {
    await db.transaction(async (tx) => {
      await createDatabaseRow(DB, { [COL_A]: "a" }, tx, ui());
      await createDatabaseRow(DB, { [COL_A]: "b" }, tx);
    });
    const h = await history();
    expect(h).toHaveLength(2);
    expect(h.every((e) => e.source === "ui" && e.actor_user_id === USER && e.batch_id === BATCH)).toBe(true);
  });

  it("un skip posé dans une transaction n'écrit aucune entrée pour les lignes insérées par la création de base", async () => {
    await db.transaction(async (tx) => {
      await setRowChangeContext(tx, SKIP_ROW_HISTORY);
      for (let position = 0; position < 3; position++) {
        await tx.execute(
          sql`INSERT INTO user_database_rows (database_id, cells, position) VALUES (${DB}, '{}'::jsonb, ${position})`
        );
      }
    });
    const rows = await pool.query("SELECT count(*)::int AS n FROM user_database_rows WHERE database_id = $1", [DB]);
    expect(rows.rows[0].n).toBe(3);
    expect(await history()).toHaveLength(0);
  });
});
