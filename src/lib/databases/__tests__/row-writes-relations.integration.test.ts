/**
 * Intégration de row-writes + synchronisation des relations jumelées sur un
 * vrai Postgres. Activé par RELATIONS_TEST_DATABASE_URL ; ignoré sinon.
 * Les tables vivent dans un schéma dédié (rw_test) pour ne pas entrer en
 * collision avec les autres tests d'intégration lancés en parallèle.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { randomUUID } from "crypto";
import { Pool } from "pg";
import { sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import * as schema from "@/lib/db/schema";
import {
  createDatabaseRow,
  mergeDatabaseRowCells,
  fillEmptyRowCells,
  deleteDatabaseRow,
} from "../row-writes";

const URL = process.env.RELATIONS_TEST_DATABASE_URL;
const DB_NAME = URL ? new globalThis.URL(URL).pathname.replace(/^\//, "") : "";
if (URL && !DB_NAME.includes("test")) {
  throw new Error(`RELATIONS_TEST_DATABASE_URL doit viser une base de test (nom contenant "test"), reçu "${DB_NAME}"`);
}
const d = URL ? describe : describe.skip;

d("row-writes + relations jumelées (Postgres)", () => {
  let pool: Pool;
  let db: ReturnType<typeof drizzle<typeof schema>>;
  const DB_A = randomUUID();
  const DB_B = randomUUID();
  const COL_A = randomUUID(); // A -> B
  const COL_B = randomUUID(); // B -> A (jumelle)
  const SPACE_A = randomUUID();
  const SPACE_B = randomUUID();
  const ORG = randomUUID();

  beforeAll(async () => {
    const admin = new Pool({ connectionString: URL });
    await admin.query("CREATE SCHEMA IF NOT EXISTS rw_test");
    await admin.end();
    pool = new Pool({ connectionString: URL, options: "-c search_path=rw_test" });
    db = drizzle(pool, { schema });
    await pool.query(`
      DROP TABLE IF EXISTS user_database_rows; DROP TABLE IF EXISTS user_database_columns;
      DROP TABLE IF EXISTS user_databases; DROP TABLE IF EXISTS spaces;
      CREATE TABLE spaces (id uuid PRIMARY KEY, organization_id uuid);
      CREATE TABLE user_databases (id uuid PRIMARY KEY, space_id uuid NOT NULL);
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
    await pool.query("DROP TRIGGER IF EXISTS boom ON user_database_rows");
    await pool.end();
  });
  beforeEach(async () => {
    await pool.query("DROP TRIGGER IF EXISTS boom ON user_database_rows");
    await pool.query("TRUNCATE user_database_rows, user_database_columns");
    await pool.query("TRUNCATE user_databases, spaces");
    await pool.query(
      `INSERT INTO spaces (id, organization_id) VALUES ($1,$3),($2,$3)`,
      [SPACE_A, SPACE_B, ORG]
    );
    await pool.query(`INSERT INTO user_databases (id, space_id) VALUES ($1,$3),($2,$4)`, [DB_A, DB_B, SPACE_A, SPACE_B]);
    await pool.query(
      `INSERT INTO user_database_columns (id, database_id, name, type, config) VALUES
       ($1,$3,'Vers B','relation',$5::jsonb),
       ($2,$4,'Vers A','relation',$6::jsonb)`,
      [
        COL_A, COL_B, DB_A, DB_B,
        JSON.stringify({ targetDatabaseId: DB_B, inverseColumnId: COL_B }),
        JSON.stringify({ targetDatabaseId: DB_A, inverseColumnId: COL_A }),
      ]
    );
  });

  async function addRow(databaseId: string, cells: Record<string, unknown> = {}) {
    const id = randomUUID();
    await pool.query("INSERT INTO user_database_rows (id, database_id, cells) VALUES ($1,$2,$3)", [
      id, databaseId, JSON.stringify(cells),
    ]);
    return id;
  }
  async function cellsOf(id: string) {
    return (await pool.query("SELECT cells FROM user_database_rows WHERE id=$1", [id])).rows[0]?.cells;
  }

  it("création : la ligne liée reçoit l'inverse", async () => {
    const p = await addRow(DB_B);
    const row = await createDatabaseRow(DB_A, { [COL_A]: [p] }, db);
    expect(await cellsOf(p)).toEqual({ [COL_B]: [row.id] });
  });

  it("merge en remplacement : retire l'ancien, ajoute le nouveau", async () => {
    const p1 = await addRow(DB_B);
    const p2 = await addRow(DB_B);
    const row = await createDatabaseRow(DB_A, { [COL_A]: [p1] }, db);
    await mergeDatabaseRowCells(DB_A, row.id, { [COL_A]: [p2] }, {}, db);
    expect(await cellsOf(p1)).toEqual({ [COL_B]: [] });
    expect(await cellsOf(p2)).toEqual({ [COL_B]: [row.id] });
  });

  it("merge en append : union, l'existant est conservé", async () => {
    const p1 = await addRow(DB_B);
    const p2 = await addRow(DB_B);
    const row = await createDatabaseRow(DB_A, { [COL_A]: [p1] }, db);
    await mergeDatabaseRowCells(DB_A, row.id, { [COL_A]: [p2] }, { appendColumns: [COL_A] }, db);
    expect((await cellsOf(row.id))[COL_A]).toEqual([p1, p2]);
    expect(await cellsOf(p1)).toEqual({ [COL_B]: [row.id] });
    expect(await cellsOf(p2)).toEqual({ [COL_B]: [row.id] });
  });

  it("merge sur ligne absente : undefined, rien d'écrit", async () => {
    const p = await addRow(DB_B);
    expect(await mergeDatabaseRowCells(DB_A, randomUUID(), { [COL_A]: [p] }, {}, db)).toBeUndefined();
    expect(await cellsOf(p)).toEqual({});
  });

  it("fill_empty : n'écrit l'inverse que pour les colonnes réellement remplies", async () => {
    const p1 = await addRow(DB_B);
    const p2 = await addRow(DB_B);
    const row = await createDatabaseRow(DB_A, { [COL_A]: [p1] }, db);
    // COL_A déjà remplie : la valeur entrante est ignorée, p2 ne reçoit rien.
    const res = await fillEmptyRowCells(DB_A, row.id, { [COL_A]: [p2] }, {}, db);
    expect(res?.filledColumns).toEqual([]);
    expect(await cellsOf(p2)).toEqual({});
    expect(await cellsOf(p1)).toEqual({ [COL_B]: [row.id] });
    // Ligne vide : la colonne est remplie, l'inverse suit.
    const empty = await addRow(DB_A);
    await fillEmptyRowCells(DB_A, empty, { [COL_A]: [p2] }, {}, db);
    expect(await cellsOf(p2)).toEqual({ [COL_B]: [empty] });
  });

  it("deleteDatabaseRow : purge les inverses puis supprime", async () => {
    const p = await addRow(DB_B);
    const row = await createDatabaseRow(DB_A, { [COL_A]: [p] }, db);
    expect(await deleteDatabaseRow(DB_A, row.id, db)).toBe(true);
    expect(await cellsOf(row.id)).toBeUndefined();
    expect(await cellsOf(p)).toEqual({ [COL_B]: [] });
    expect(await deleteDatabaseRow(DB_A, row.id, db)).toBe(false);
  });

  it("deleteDatabaseRow refuse une ligne d'une autre base", async () => {
    const other = await addRow(DB_B);
    expect(await deleteDatabaseRow(DB_A, other, db)).toBe(false);
    expect(await cellsOf(other)).toBeDefined();
  });

  it("l'écriture inverse échoue : l'écriture principale est annulée", async () => {
    const p = await addRow(DB_B);
    const row = await createDatabaseRow(DB_A, {}, db);
    await pool.query(`
      CREATE OR REPLACE FUNCTION rw_test.boom_fn() RETURNS trigger AS $$
      BEGIN RAISE EXCEPTION 'boom'; END; $$ LANGUAGE plpgsql;
      CREATE TRIGGER boom BEFORE UPDATE ON user_database_rows
        FOR EACH ROW WHEN (NEW.database_id = '${DB_B}') EXECUTE FUNCTION rw_test.boom_fn();
    `);
    await expect(mergeDatabaseRowCells(DB_A, row.id, { [COL_A]: [p] }, {}, db)).rejects.toThrow();
    expect(await cellsOf(row.id)).toEqual({});
    expect(await cellsOf(p)).toEqual({});
  });

  it("écritures croisées concurrentes : pas d'interblocage, cohérence finale", async () => {
    for (let i = 0; i < 15; i++) {
      const a = await addRow(DB_A);
      const b = await addRow(DB_B);
      await Promise.all([
        mergeDatabaseRowCells(DB_A, a, { [COL_A]: [b] }, {}, db),
        mergeDatabaseRowCells(DB_B, b, { [COL_B]: [a] }, {}, db),
      ]);
      expect((await cellsOf(a))[COL_A]).toEqual([b]);
      expect((await cellsOf(b))[COL_B]).toEqual([a]);
    }
  });

  it("createDatabaseRow concurrents et repli sous verrou de correspondance : pas d'interblocage", async () => {
    const jobs: Promise<unknown>[] = [];
    for (let i = 0; i < 15; i++) {
      jobs.push(createDatabaseRow(DB_A, {}, db));
      jobs.push(
        // Même séquence que withMatchLock (verrou de correspondance) puis repli sur createDatabaseRow.
        db.transaction(async (tx) => {
          await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtextextended(${`match:${DB_A}:${COL_A}:k${i}`}, 0))`);
          return createDatabaseRow(DB_A, {}, tx);
        })
      );
      jobs.push(createDatabaseRow(DB_B, {}, db));
    }
    await expect(Promise.all(jobs)).resolves.toBeDefined();
  });
});
