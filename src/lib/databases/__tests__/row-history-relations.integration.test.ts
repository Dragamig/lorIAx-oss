/**
 * Row history of partner rows written by syncRelationInverses (task 4).
 * Requires RELATIONS_TEST_DATABASE_URL; skipped otherwise.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { randomUUID } from "crypto";
import type { Pool } from "pg";
import { setupRowHistoryFixture } from "./row-history-fixture";
import { mergeDatabaseRowCells, deleteDatabaseRow, type DbExecutor } from "../row-writes";
import type { RowChangeContext } from "../row-change-context";

const URL = process.env.RELATIONS_TEST_DATABASE_URL;
const DB_NAME = URL ? new globalThis.URL(URL).pathname.replace(/^\//, "") : "";
if (URL && !DB_NAME.includes("test")) {
  throw new Error(`RELATIONS_TEST_DATABASE_URL doit viser une base de test, reçu "${DB_NAME}"`);
}

describe.skipIf(!URL)("row history of relation sync", () => {
  let pool: Pool;
  let db: DbExecutor;
  let teardown: () => Promise<void>;
  const ORG = randomUUID();
  const SPACE_A = randomUUID();
  const SPACE_B = randomUUID();
  const DB_A = randomUUID();
  const DB_B = randomUUID();
  const COL_A = randomUUID();
  const COL_B = randomUUID();
  const USER = randomUUID();
  const BATCH = randomUUID();

  const ui: RowChangeContext = { source: "ui", actorUserId: USER, batchId: BATCH };

  async function history(rowId?: string) {
    const r = await pool.query(
      "SELECT row_id, kind, source, actor_user_id, batch_id, changes FROM database_row_changes ORDER BY created_at, id"
    );
    return rowId ? r.rows.filter((e) => e.row_id === rowId) : r.rows;
  }
  async function addRow(databaseId: string, cells: Record<string, unknown> = {}) {
    const id = randomUUID();
    await pool.query("INSERT INTO user_database_rows (id, database_id, cells) VALUES ($1,$2,$3)", [
      id, databaseId, JSON.stringify(cells),
    ]);
    await pool.query("TRUNCATE database_row_changes");
    return id;
  }

  beforeAll(async () => {
    const f = await setupRowHistoryFixture(URL!, "rh_relations");
    pool = f.pool;
    db = f.db as unknown as DbExecutor;
    teardown = f.teardown;
  });
  afterAll(async () => {
    await teardown();
  });
  beforeEach(async () => {
    await pool.query(
      "TRUNCATE activity_log, database_row_changes, external_row_tracking, external_database_mappings, user_database_rows, user_database_columns, user_databases, spaces, users"
    );
    await pool.query("INSERT INTO users (id) VALUES ($1)", [USER]);
    await pool.query("INSERT INTO spaces (id, organization_id) VALUES ($1,$3),($2,$3)", [SPACE_A, SPACE_B, ORG]);
    await pool.query("INSERT INTO user_databases (id, space_id) VALUES ($1,$3),($2,$4)", [DB_A, DB_B, SPACE_A, SPACE_B]);
    await pool.query(
      `INSERT INTO user_database_columns (id, database_id, name, type, config) VALUES
       ($1,$3,'Vers B','relation',$5::jsonb), ($2,$4,'Vers A','relation',$6::jsonb)`,
      [
        COL_A, COL_B, DB_A, DB_B,
        JSON.stringify({ targetDatabaseId: DB_B, inverseColumnId: COL_B }),
        JSON.stringify({ targetDatabaseId: DB_A, inverseColumnId: COL_A }),
      ]
    );
  });

  it("ajout d'une relation : le partenaire reçoit relation_sync, même acteur et même batch", async () => {
    const r = await addRow(DB_A);
    const p = await addRow(DB_B);
    await mergeDatabaseRowCells(DB_A, r, { [COL_A]: [p] }, {}, db, ui);
    const h = await history(p);
    expect(h).toHaveLength(1);
    expect(h[0]).toMatchObject({ kind: "updated", source: "relation_sync", actor_user_id: USER, batch_id: BATCH });
    expect(h[0].changes).toEqual([expect.objectContaining({ columnId: COL_B, after: [r] })]);
    const own = await history(r);
    expect(own).toHaveLength(1);
    expect(own[0]).toMatchObject({ source: "ui", batch_id: BATCH });
  });

  it("retrait de la relation : after sans l'id", async () => {
    const p = await addRow(DB_B);
    const r = await addRow(DB_A, { [COL_A]: [p] });
    await pool.query("UPDATE user_database_rows SET cells = $2::jsonb WHERE id = $1", [p, JSON.stringify({ [COL_B]: [r] })]);
    await pool.query("TRUNCATE database_row_changes");
    await mergeDatabaseRowCells(DB_A, r, { [COL_A]: [] }, {}, db, ui);
    const h = await history(p);
    expect(h).toHaveLength(1);
    expect(h[0]).toMatchObject({ source: "relation_sync", actor_user_id: USER });
    expect(h[0].changes).toEqual([expect.objectContaining({ columnId: COL_B, before: [r], after: [] })]);
  });

  it("suppression : partenaires en relation_sync puis deleted en source ui", async () => {
    const p = await addRow(DB_B);
    const r = await addRow(DB_A, { [COL_A]: [p] });
    await pool.query("UPDATE user_database_rows SET cells = $2::jsonb WHERE id = $1", [p, JSON.stringify({ [COL_B]: [r] })]);
    await pool.query("TRUNCATE database_row_changes");
    await deleteDatabaseRow(DB_A, r, db, ui);
    expect(await history(p)).toEqual([expect.objectContaining({ kind: "updated", source: "relation_sync" })]);
    const own = await history(r);
    expect(own).toHaveLength(1);
    expect(own[0]).toMatchObject({ kind: "deleted", source: "ui", actor_user_id: USER, batch_id: BATCH });
  });

  it("partenaire déjà à jour : aucune entrée", async () => {
    const r = await addRow(DB_A);
    const p = await addRow(DB_B, { [COL_B]: [r] });
    await mergeDatabaseRowCells(DB_A, r, { [COL_A]: [p] }, {}, db, ui);
    expect(await history(p)).toHaveLength(0);
  });

  it("sans ctx : partenaire en relation_sync sans acteur, puis contexte absent", async () => {
    const r = await addRow(DB_A);
    const p = await addRow(DB_B);
    await mergeDatabaseRowCells(DB_A, r, { [COL_A]: [p] }, {}, db);
    const h = await history(p);
    expect(h).toHaveLength(1);
    expect(h[0]).toMatchObject({ source: "relation_sync", actor_user_id: null });
    const own = await history(r);
    expect(own[0]).toMatchObject({ source: "system" });
  });

  it("sans ctx : le contexte rétabli est absent pour la suite de la transaction", async () => {
    const r = await addRow(DB_A);
    const p = await addRow(DB_B);
    const q = await addRow(DB_B);
    await (db as unknown as { transaction: (f: (tx: DbExecutor) => Promise<void>) => Promise<void> }).transaction(
      async (tx) => {
        await mergeDatabaseRowCells(DB_A, r, { [COL_A]: [p] }, {}, tx);
        await tx.execute((await import("drizzle-orm")).sql`UPDATE user_database_rows SET cells = ${JSON.stringify({ [COL_B]: [randomUUID()] })}::jsonb WHERE id = ${q}::uuid`);
      }
    );
    expect(await history(p)).toEqual([expect.objectContaining({ source: "relation_sync" })]);
    const own = await history(q);
    expect(own).toHaveLength(1);
    expect(own[0]).toMatchObject({ source: "system", actor_user_id: null });
  });
});
