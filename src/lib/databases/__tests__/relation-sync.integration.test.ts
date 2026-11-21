/**
 * Intégration de syncRelationInverses sur un vrai Postgres (jsonb, verrous).
 * Activé par RELATIONS_TEST_DATABASE_URL (base jetable, ex. loriax_relations_test) ;
 * ignoré sinon. Les tables minimales sont créées/recréées par le test.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { randomUUID } from "crypto";
import { Pool } from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import { sql } from "drizzle-orm";
import * as schema from "@/lib/db/schema";
import { syncRelationInverses } from "../relation-sync";

const URL = process.env.RELATIONS_TEST_DATABASE_URL;
const DB_NAME = URL ? new globalThis.URL(URL).pathname.replace(/^\//, "") : "";
if (URL && !DB_NAME.includes("test")) {
  throw new Error(`RELATIONS_TEST_DATABASE_URL doit viser une base de test (nom contenant "test"), reçu "${DB_NAME}"`);
}
const d = URL ? describe : describe.skip;

d("syncRelationInverses (Postgres)", () => {
  let pool: Pool;
  let db: ReturnType<typeof drizzle<typeof schema>>;
  const DB_A = randomUUID();
  const DB_B = randomUUID();
  const COL_A = randomUUID(); // relation A -> B
  const COL_B = randomUUID(); // jumelle B -> A
  const COL_PLAIN = randomUUID(); // relation sans jumelle
  const SPACE_A = randomUUID();
  const SPACE_B = randomUUID();
  const ORG = randomUUID();

  beforeAll(async () => {
    const admin = new Pool({ connectionString: URL });
    await admin.query("CREATE SCHEMA IF NOT EXISTS rs_test");
    await admin.end();
    pool = new Pool({ connectionString: URL, options: "-c search_path=rs_test" });
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
    await pool.end();
  });
  beforeEach(async () => {
    await pool.query("TRUNCATE user_database_rows, user_database_columns");
    await pool.query("TRUNCATE user_databases, spaces");
    await pool.query(
      `INSERT INTO spaces (id, organization_id) VALUES ($1,$3),($2,$3)`,
      [SPACE_A, SPACE_B, ORG]
    );
    await pool.query(`INSERT INTO user_databases (id, space_id) VALUES ($1,$3),($2,$4)`, [DB_A, DB_B, SPACE_A, SPACE_B]);
    await pool.query(
      `INSERT INTO user_database_columns (id, database_id, name, type, config) VALUES
       ($1,$3,'Vers B','relation',$7::jsonb),
       ($2,$4,'Vers A','relation',$8::jsonb),
       ($5,$3,'Sans jumelle','relation',$9::jsonb),
       ($6,$3,'Texte','text','{}')`,
      [
        COL_A, COL_B, DB_A, DB_B, COL_PLAIN, randomUUID(),
        JSON.stringify({ targetDatabaseId: DB_B, inverseColumnId: COL_B }),
        JSON.stringify({ targetDatabaseId: DB_A, inverseColumnId: COL_A }),
        JSON.stringify({ targetDatabaseId: DB_B }),
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
    return (await pool.query("SELECT cells FROM user_database_rows WHERE id=$1", [id])).rows[0].cells;
  }
  const sync = (rowId: string, before: Record<string, unknown>, after: Record<string, unknown>) =>
    db.transaction((tx) => syncRelationInverses(tx, { databaseId: DB_A, rowId, before, after }));

  it("ajoute et retire l'inverse symétriquement", async () => {
    const r = await addRow(DB_A);
    const p1 = await addRow(DB_B);
    const p2 = await addRow(DB_B, { [COL_B]: ["autre"] });
    await sync(r, {}, { [COL_A]: [p1, p2] });
    expect(await cellsOf(p1)).toEqual({ [COL_B]: [r] });
    expect(await cellsOf(p2)).toEqual({ [COL_B]: ["autre", r] });
    await sync(r, { [COL_A]: [p1, p2] }, { [COL_A]: [p2] });
    expect(await cellsOf(p1)).toEqual({ [COL_B]: [] });
    expect(await cellsOf(p2)).toEqual({ [COL_B]: ["autre", r] });
    await sync(r, { [COL_A]: [p2] }, { [COL_A]: [] });
    expect(await cellsOf(p2)).toEqual({ [COL_B]: ["autre"] });
  });

  it("est idempotent", async () => {
    const r = await addRow(DB_A);
    const p = await addRow(DB_B);
    await sync(r, {}, { [COL_A]: [p] });
    await sync(r, {}, { [COL_A]: [p] });
    expect(await cellsOf(p)).toEqual({ [COL_B]: [r] });
    await sync(r, { [COL_A]: [p] }, { [COL_A]: [] });
    await sync(r, { [COL_A]: [p] }, { [COL_A]: [] });
    expect(await cellsOf(p)).toEqual({ [COL_B]: [] });
  });

  it("ignore une ligne partenaire absente ou non uuid", async () => {
    const r = await addRow(DB_A);
    await expect(sync(r, {}, { [COL_A]: [randomUUID(), "pas-un-uuid"] })).resolves.toBeUndefined();
  });

  it("n'écrit jamais hors de la base cible", async () => {
    const r = await addRow(DB_A);
    const sameDb = await addRow(DB_A, { x: 1 });
    await sync(r, {}, { [COL_A]: [sameDb] });
    expect(await cellsOf(sameDb)).toEqual({ x: 1 });
  });

  it("ignore une colonne non jumelée ou absente de after", async () => {
    const r = await addRow(DB_A);
    const p = await addRow(DB_B);
    await sync(r, {}, { [COL_PLAIN]: [p] });
    await sync(r, { [COL_A]: [] }, {});
    expect(await cellsOf(p)).toEqual({});
  });

  it("ne rappelle pas la synchronisation (pas de boucle) et ne touche pas la ligne source", async () => {
    const r = await addRow(DB_A);
    const p = await addRow(DB_B);
    await sync(r, {}, { [COL_A]: [p] });
    expect(await cellsOf(r)).toEqual({});
  });

  it("annule tout si la transaction échoue", async () => {
    const r = await addRow(DB_A);
    const p = await addRow(DB_B);
    await expect(
      db.transaction(async (tx) => {
        await syncRelationInverses(tx, { databaseId: DB_A, rowId: r, before: {}, after: { [COL_A]: [p] } });
        await tx.execute(sql`SELECT 1/0`);
      })
    ).rejects.toThrow();
    expect(await cellsOf(p)).toEqual({});
  });

  it("ignore une paire dont la jumelle ne pointe pas en retour", async () => {
    await pool.query("UPDATE user_database_columns SET config=$2::jsonb WHERE id=$1", [
      COL_B, JSON.stringify({ targetDatabaseId: DB_B, inverseColumnId: COL_A }),
    ]);
    const r = await addRow(DB_A);
    const p = await addRow(DB_B);
    await sync(r, {}, { [COL_A]: [p] });
    expect(await cellsOf(p)).toEqual({});
  });

  it("ignore une jumelle supprimée (pas de clé orpheline)", async () => {
    await pool.query("DELETE FROM user_database_columns WHERE id=$1", [COL_B]);
    const r = await addRow(DB_A);
    const p = await addRow(DB_B);
    await sync(r, {}, { [COL_A]: [p] });
    expect(await cellsOf(p)).toEqual({});
  });

  it("ignore une jumelle qui n'est pas de type relation", async () => {
    await pool.query("UPDATE user_database_columns SET type='text' WHERE id=$1", [COL_B]);
    const r = await addRow(DB_A);
    const p = await addRow(DB_B);
    await sync(r, {}, { [COL_A]: [p] });
    expect(await cellsOf(p)).toEqual({});
  });

  it("n'écrit pas dans une base d'une autre organisation", async () => {
    await pool.query("UPDATE spaces SET organization_id=$2 WHERE id=$1", [SPACE_B, randomUUID()]);
    const r = await addRow(DB_A);
    const p = await addRow(DB_B);
    await sync(r, {}, { [COL_A]: [p] });
    expect(await cellsOf(p)).toEqual({});
  });

  it("ne prend pas de verrou de couple pour une paire invalide", async () => {
    await pool.query("DELETE FROM user_database_columns WHERE id=$1", [COL_B]);
    const { lockRelationPairs } = await import("../relation-sync");
    const key = `relpair:${[DB_A, DB_B].sort().join(":")}`;
    await db.transaction(async (tx) => {
      await lockRelationPairs(tx, DB_A);
      const other = await pool.query(
        "SELECT pg_try_advisory_xact_lock(hashtextextended($1, 0)) AS ok", [key]
      );
      expect(other.rows[0].ok).toBe(true);
    });
  });

  it("n'écrase jamais une cellule inverse existante non tableau", async () => {
    const r = await addRow(DB_A);
    const p = await addRow(DB_B, { [COL_B]: "texte" });
    await sync(r, {}, { [COL_A]: [p] });
    expect(await cellsOf(p)).toEqual({ [COL_B]: "texte" });
  });

  it("deux écritures croisées concurrentes ne s'interbloquent pas", async () => {
    const a1 = await addRow(DB_A);
    const a2 = await addRow(DB_A);
    const b1 = await addRow(DB_B);
    const b2 = await addRow(DB_B);
    // a1 -> [b1,b2] et a2 -> [b2,b1] : partenaires verrouillés dans le même ordre.
    await Promise.all(
      Array.from({ length: 10 }, () => [
        sync(a1, {}, { [COL_A]: [b1, b2] }),
        sync(a2, {}, { [COL_A]: [b2, b1] }),
      ]).flat()
    );
    expect((await cellsOf(b1))[COL_B].sort()).toEqual([a1, a2].sort());
    expect((await cellsOf(b2))[COL_B].sort()).toEqual([a1, a2].sort());
  });
});
