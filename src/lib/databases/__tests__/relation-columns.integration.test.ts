/**
 * Cycle de vie des colonnes relation jumelées sur un vrai Postgres.
 * Activé par RELATIONS_TEST_DATABASE_URL ; ignoré sinon. Schéma dédié rc_test.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { randomUUID } from "crypto";
import { Pool } from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import * as schema from "@/lib/db/schema";
import {
  createPairedRelationColumn,
  deleteColumnWithPair,
  unpairColumnsOfDeletedDatabase,
  RelationColumnError,
} from "../relation-columns";

const URL = process.env.RELATIONS_TEST_DATABASE_URL;
const d = URL ? describe : describe.skip;

d("relation-columns (Postgres)", () => {
  let pool: Pool;
  let db: ReturnType<typeof drizzle<typeof schema>>;
  const DB_A = randomUUID();
  const DB_B = randomUUID();
  const DB_C = randomUUID();

  beforeAll(async () => {
    const admin = new Pool({ connectionString: URL });
    await admin.query("CREATE SCHEMA IF NOT EXISTS rc_test");
    await admin.end();
    pool = new Pool({ connectionString: URL, options: "-c search_path=rc_test" });
    db = drizzle(pool, { schema });
    await pool.query(`
      DROP TABLE IF EXISTS user_database_rows; DROP TABLE IF EXISTS user_database_columns;
      CREATE TABLE user_database_columns (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(), database_id uuid NOT NULL,
        name varchar(255) NOT NULL, type text NOT NULL DEFAULT 'text',
        position integer NOT NULL DEFAULT 0, config jsonb DEFAULT '{}',
        created_at timestamptz NOT NULL DEFAULT now());
      CREATE TABLE user_database_rows (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(), database_id uuid NOT NULL,
        cells jsonb NOT NULL DEFAULT '{}', position integer NOT NULL DEFAULT 0,
        created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now());
    `);
  });
  afterAll(async () => {
    await pool.end();
  });
  beforeEach(async () => {
    await pool.query("TRUNCATE user_database_rows, user_database_columns");
  });

  async function col(id: string) {
    return (await pool.query("SELECT * FROM user_database_columns WHERE id=$1", [id])).rows[0];
  }
  async function pair() {
    return db.transaction((tx) =>
      createPairedRelationColumn(tx, {
        databaseId: DB_A, targetDatabaseId: DB_B, name: "Vers B", inverseName: "Vers A",
      })
    );
  }
  async function addRow(databaseId: string, cells: Record<string, unknown>) {
    const id = randomUUID();
    await pool.query("INSERT INTO user_database_rows (id, database_id, cells) VALUES ($1,$2,$3)", [
      id, databaseId, JSON.stringify(cells),
    ]);
    return id;
  }
  async function cellsOf(id: string) {
    return (await pool.query("SELECT cells FROM user_database_rows WHERE id=$1", [id])).rows[0].cells;
  }

  it("crée les deux colonnes liées par inverseColumnId", async () => {
    const { column, inverse } = await pair();
    expect((await col(column.id)).config).toEqual({ targetDatabaseId: DB_B, inverseColumnId: inverse.id });
    expect((await col(inverse.id)).config).toEqual({ targetDatabaseId: DB_A, inverseColumnId: column.id });
    expect((await col(inverse.id)).database_id).toBe(DB_B);
  });

  it("ignore un inverseColumnId fourni par le client", async () => {
    const { column } = await db.transaction((tx) =>
      createPairedRelationColumn(tx, {
        databaseId: DB_A, targetDatabaseId: DB_B, name: "X", inverseName: "Y",
        config: { inverseColumnId: randomUUID() },
      })
    );
    const cfg = (await col(column.id)).config;
    expect(cfg.inverseColumnId).not.toBeUndefined();
    expect((await col(cfg.inverseColumnId)).name).toBe("Y");
  });

  it("refuse un nom d'inverse déjà pris (insensible à la casse) et ne crée rien", async () => {
    await pool.query("INSERT INTO user_database_columns (database_id, name) VALUES ($1,'vers a')", [DB_B]);
    await expect(pair()).rejects.toBeInstanceOf(RelationColumnError);
    expect((await pool.query("SELECT count(*)::int n FROM user_database_columns")).rows[0].n).toBe(1);
  });

  it("suppression avec alsoDeleteInverse : supprime les deux et purge les cellules", async () => {
    const { column, inverse } = await pair();
    const a = await addRow(DB_A, { [column.id]: ["x"], keep: 1 });
    const b = await addRow(DB_B, { [inverse.id]: ["y"], keep: 2 });
    const r = await db.transaction((tx) =>
      deleteColumnWithPair(tx, { databaseId: DB_A, columnId: column.id, alsoDeleteInverse: true })
    );
    expect(r.deletedInverseColumnId).toBe(inverse.id);
    expect(await col(column.id)).toBeUndefined();
    expect(await col(inverse.id)).toBeUndefined();
    expect(await cellsOf(a)).toEqual({ keep: 1 });
    expect(await cellsOf(b)).toEqual({ keep: 2 });
  });

  it("suppression sans alsoDeleteInverse : l'inverse devient simple et garde ses cellules", async () => {
    const { column, inverse } = await pair();
    const b = await addRow(DB_B, { [inverse.id]: ["y"] });
    const r = await db.transaction((tx) =>
      deleteColumnWithPair(tx, { databaseId: DB_A, columnId: column.id, alsoDeleteInverse: false })
    );
    expect(r.deletedInverseColumnId).toBeNull();
    expect(await col(column.id)).toBeUndefined();
    expect((await col(inverse.id)).config).toEqual({ targetDatabaseId: DB_A });
    expect(await cellsOf(b)).toEqual({ [inverse.id]: ["y"] });
  });

  it("suppression d'une jumelle : attend le verrou relpair du couple", async () => {
    const { column } = await pair();
    const key = `relpair:${[DB_A, DB_B].sort().join(":")}`;
    const holder = await pool.connect();
    await holder.query("BEGIN");
    await holder.query("SELECT pg_advisory_xact_lock(hashtextextended($1, 0))", [key]);
    let done = false;
    const p = db
      .transaction((tx) =>
        deleteColumnWithPair(tx, { databaseId: DB_A, columnId: column.id, alsoDeleteInverse: true })
      )
      .then(() => {
        done = true;
      });
    await new Promise((r) => setTimeout(r, 400));
    expect(done).toBe(false);
    await holder.query("COMMIT");
    holder.release();
    await p;
    expect(done).toBe(true);
  });

  it("suppression d'une colonne non jumelée : comportement inchangé", async () => {
    const [{ id }] = (await pool.query(
      "INSERT INTO user_database_columns (database_id, name) VALUES ($1,'t') RETURNING id", [DB_A]
    )).rows;
    const a = await addRow(DB_A, { [id]: "v", k: 1 });
    await db.transaction((tx) =>
      deleteColumnWithPair(tx, { databaseId: DB_A, columnId: id, alsoDeleteInverse: true })
    );
    expect(await cellsOf(a)).toEqual({ k: 1 });
  });

  it("ne touche pas une colonne qui prétend être la jumelle sans pointer en retour", async () => {
    const { column, inverse } = await pair();
    await pool.query("UPDATE user_database_columns SET config='{}' WHERE id=$1", [inverse.id]);
    const r = await db.transaction((tx) =>
      deleteColumnWithPair(tx, { databaseId: DB_A, columnId: column.id, alsoDeleteInverse: true })
    );
    expect(r.deletedInverseColumnId).toBeNull();
    expect(await col(inverse.id)).toBeDefined();
  });

  it("suppression d'une base : dé-jumelle les colonnes des autres bases seulement", async () => {
    const { column: ab, inverse: ba } = await pair(); // A<->B
    const { column: cb } = await db.transaction((tx) =>
      createPairedRelationColumn(tx, { databaseId: DB_C, targetDatabaseId: DB_B, name: "C->B", inverseName: "B->C" })
    );
    const n = await db.transaction((tx) => unpairColumnsOfDeletedDatabase(tx, DB_B));
    expect(n).toBe(2);
    expect((await col(ab.id)).config).toEqual({ targetDatabaseId: DB_B });
    expect((await col(cb.id)).config).toEqual({ targetDatabaseId: DB_B });
    expect((await col(ba.id)).config.inverseColumnId).toBe(ab.id); // colonnes de B intactes (supprimées par cascade)
  });
});
