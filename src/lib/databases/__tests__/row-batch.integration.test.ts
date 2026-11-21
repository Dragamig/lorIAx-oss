/**
 * Opérations de lignes en lot sur un vrai Postgres. Activé par
 * RELATIONS_TEST_DATABASE_URL ; ignoré sinon. Schéma dédié (rb_test).
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { randomUUID } from "crypto";
import { Pool } from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import * as schema from "@/lib/db/schema";
import {
  deleteDatabaseRows,
  restoreDatabaseRows,
  duplicateDatabaseRows,
  reorderDatabaseRows,
  RowBatchError,
} from "../row-batch";

const URL = process.env.RELATIONS_TEST_DATABASE_URL;
const DB_NAME = URL ? new globalThis.URL(URL).pathname.replace(/^\//, "") : "";
if (URL && !DB_NAME.includes("test")) {
  throw new Error(`RELATIONS_TEST_DATABASE_URL doit viser une base de test, reçu "${DB_NAME}"`);
}
const d = URL ? describe : describe.skip;

d("row-batch (Postgres)", () => {
  let pool: Pool;
  let db: ReturnType<typeof drizzle<typeof schema>>;
  const DB_A = randomUUID();
  const DB_B = randomUUID();
  const OTHER = randomUUID();
  const COL_A = randomUUID();
  const COL_B = randomUUID();
  const COL_NUM = randomUUID();
  const COL_TXT = randomUUID();
  const SPACE = randomUUID();
  const ORG = randomUUID();
  const ALLOW = { canAccessRelationTarget: async () => true };

  beforeAll(async () => {
    const admin = new Pool({ connectionString: URL });
    await admin.query("CREATE SCHEMA IF NOT EXISTS rb_test");
    await admin.end();
    pool = new Pool({ connectionString: URL, options: "-c search_path=rb_test" });
    db = drizzle(pool, { schema });
    await pool.query(`
      DROP TABLE IF EXISTS external_row_tracking; DROP TABLE IF EXISTS external_database_mappings;
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
      CREATE TABLE external_database_mappings (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_database_id uuid NOT NULL);
      CREATE TABLE external_row_tracking (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        mapping_id uuid NOT NULL REFERENCES external_database_mappings(id) ON DELETE CASCADE,
        loriax_row_id uuid NOT NULL REFERENCES user_database_rows(id) ON DELETE CASCADE,
        external_row_id varchar(512) NOT NULL, content_hash varchar(64),
        last_external_change_at timestamptz,
        created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now());
    `);
  });
  afterAll(async () => {
    await pool.end();
  });
  beforeEach(async () => {
    await pool.query("TRUNCATE external_row_tracking, external_database_mappings, user_database_rows, user_database_columns, user_databases, spaces");
    await pool.query(`INSERT INTO spaces (id, organization_id) VALUES ($1,$2)`, [SPACE, ORG]);
    await pool.query(`INSERT INTO user_databases (id, space_id) VALUES ($1,$3),($2,$3)`, [DB_A, DB_B, SPACE]);
    await pool.query(
      `INSERT INTO user_database_columns (id, database_id, name, type, config) VALUES
       ($1,$5,'Vers B','relation',$7::jsonb),
       ($2,$6,'Vers A','relation',$8::jsonb),
       ($3,$5,'N','autonumber','{}'),
       ($4,$5,'T','text','{}')`,
      [
        COL_A, COL_B, COL_NUM, COL_TXT, DB_A, DB_B,
        JSON.stringify({ targetDatabaseId: DB_B, inverseColumnId: COL_B }),
        JSON.stringify({ targetDatabaseId: DB_A, inverseColumnId: COL_A }),
      ]
    );
  });

  async function addRow(databaseId: string, position: number, cells: Record<string, unknown> = {}) {
    const id = randomUUID();
    await pool.query(
      "INSERT INTO user_database_rows (id, database_id, cells, position) VALUES ($1,$2,$3,$4)",
      [id, databaseId, JSON.stringify(cells), position]
    );
    return id;
  }
  async function order(databaseId: string) {
    const r = await pool.query(
      "SELECT id, position FROM user_database_rows WHERE database_id=$1 ORDER BY position",
      [databaseId]
    );
    return r.rows as { id: string; position: number }[];
  }
  async function cellsOf(id: string) {
    return (await pool.query("SELECT cells FROM user_database_rows WHERE id=$1", [id])).rows[0]?.cells;
  }

  describe("deleteDatabaseRows", () => {
    it("supprime en lot, renvoie l'état avant et nettoie les inverses", async () => {
      const p = await addRow(DB_B, 0);
      const r1 = await addRow(DB_A, 0, { [COL_TXT]: "a", [COL_A]: [p] });
      const r2 = await addRow(DB_A, 1, { [COL_TXT]: "b" });
      await pool.query("UPDATE user_database_rows SET cells=$2 WHERE id=$1", [p, JSON.stringify({ [COL_B]: [r1] })]);
      const out = await deleteDatabaseRows(DB_A, [r1, r2], db);
      expect(out).toEqual([
        { id: r1, cells: { [COL_TXT]: "a", [COL_A]: [p] }, position: 0, tracking: [] },
        { id: r2, cells: { [COL_TXT]: "b" }, position: 1, tracking: [] },
      ]);
      expect(await order(DB_A)).toEqual([]);
      expect(await cellsOf(p)).toEqual({ [COL_B]: [] });
    });

    it("refuse tout le lot si une ligne appartient à une autre base", async () => {
      const mine = await addRow(DB_A, 0);
      const foreign = await addRow(DB_B, 0);
      await expect(deleteDatabaseRows(DB_A, [mine, foreign], db)).rejects.toMatchObject({ code: "not_found" });
      await expect(deleteDatabaseRows(DB_A, [randomUUID()], db)).rejects.toBeInstanceOf(RowBatchError);
      expect((await order(DB_A)).map((r) => r.id)).toEqual([mine]);
      expect((await order(DB_B)).map((r) => r.id)).toEqual([foreign]);
    });
  });

  describe("restoreDatabaseRows", () => {
    it("réinsère avec même id et même position, et reconstitue les inverses", async () => {
      const p = await addRow(DB_B, 0);
      const r0 = await addRow(DB_A, 0);
      const r1 = await addRow(DB_A, 1, { [COL_A]: [p] });
      const r2 = await addRow(DB_A, 2);
      await pool.query("UPDATE user_database_rows SET cells=$2 WHERE id=$1", [p, JSON.stringify({ [COL_B]: [r1] })]);
      const [snap] = await deleteDatabaseRows(DB_A, [r1], db);
      expect(await cellsOf(p)).toEqual({ [COL_B]: [] });
      const out = (await restoreDatabaseRows(DB_A, [snap], db, ALLOW)).rows;
      expect(out).toEqual([{ id: r1, position: 1 }]);
      expect((await order(DB_A)).map((r) => r.id)).toEqual([r0, r1, r2]);
      expect(await cellsOf(p)).toEqual({ [COL_B]: [r1] });
    });

    it("décale les positions en cas de collision", async () => {
      const a = await addRow(DB_A, 0);
      const b = await addRow(DB_A, 1);
      const id = randomUUID();
      const out = (await restoreDatabaseRows(DB_A, [{ id, cells: {}, position: 1 }], db)).rows;
      expect(out).toEqual([{ id, position: 1 }]);
      expect(await order(DB_A)).toEqual([
        { id: a, position: 0 },
        { id, position: 1 },
        { id: b, position: 2 },
      ]);
    });

    it("refus générique (invalid) si un id existe déjà, sans rien écrire", async () => {
      const a = await addRow(DB_A, 0);
      const fresh = randomUUID();
      await expect(
        restoreDatabaseRows(
          DB_A,
          [{ id: fresh, cells: {}, position: 5 }, { id: a, cells: {}, position: 0 }],
          db
        )
      ).rejects.toMatchObject({ code: "invalid", message: "Restauration impossible" });
      expect((await order(DB_A)).map((r) => r.id)).toEqual([a]);
    });

    it("collision d'id dans une autre base : même refus générique", async () => {
      const foreign = await addRow(DB_B, 0);
      await expect(
        restoreDatabaseRows(DB_A, [{ id: foreign, cells: {}, position: 0 }], db)
      ).rejects.toMatchObject({ code: "invalid", message: "Restauration impossible" });
      expect(await order(DB_A)).toEqual([]);
    });

    it("autonumber déjà pris : réattribue max+1 ; formules et clés inconnues écartées", async () => {
      await addRow(DB_A, 0, { [COL_NUM]: 1 });
      await addRow(DB_A, 1, { [COL_NUM]: 5 });
      const id = randomUUID();
      const FORMULA = randomUUID();
      await pool.query(`INSERT INTO user_database_columns (id, database_id, name, type) VALUES ($1,$2,'F','formula')`, [FORMULA, DB_A]);
      await restoreDatabaseRows(
        DB_A,
        [{ id, cells: { [COL_NUM]: 1, [COL_TXT]: "x", [FORMULA]: 9, [randomUUID()]: "ghost" }, position: 2 }],
        db
      );
      expect(await cellsOf(id)).toEqual({ [COL_NUM]: 6, [COL_TXT]: "x" });
    });

    it("autonumber libre : valeur conservée", async () => {
      await addRow(DB_A, 0, { [COL_NUM]: 1 });
      const id = randomUUID();
      await restoreDatabaseRows(DB_A, [{ id, cells: { [COL_NUM]: 2 }, position: 1 }], db);
      expect(await cellsOf(id)).toEqual({ [COL_NUM]: 2 });
    });

    it("réinsère le suivi de synchro externe de cette base uniquement", async () => {
      const mine = randomUUID();
      const foreignMap = randomUUID();
      await pool.query(`INSERT INTO external_database_mappings (id, user_database_id) VALUES ($1,$2),($3,$4)`, [mine, DB_A, foreignMap, DB_B]);
      const r = await addRow(DB_A, 0);
      await pool.query(
        `INSERT INTO external_row_tracking (mapping_id, loriax_row_id, external_row_id, content_hash, last_external_change_at)
         VALUES ($1,$2,'ext-1','h1','2026-01-02T03:04:05.000Z')`,
        [mine, r]
      );
      const [snap] = await deleteDatabaseRows(DB_A, [r], db);
      expect(snap.tracking).toEqual([
        { mappingId: mine, externalRowId: "ext-1", contentHash: "h1", lastExternalChangeAt: "2026-01-02T03:04:05.000Z" },
      ]);
      expect((await pool.query("SELECT 1 FROM external_row_tracking")).rowCount).toBe(0);
      const forged = { ...snap, tracking: [...snap.tracking!, { mappingId: foreignMap, externalRowId: "x", contentHash: null, lastExternalChangeAt: null }] };
      await restoreDatabaseRows(DB_A, [forged], db);
      const t = await pool.query("SELECT mapping_id, external_row_id, content_hash FROM external_row_tracking WHERE loriax_row_id=$1", [r]);
      expect(t.rows).toEqual([{ mapping_id: mine, external_row_id: "ext-1", content_hash: "h1" }]);
    });

    it("relations : ne garde que les cibles de la base cible et accessibles", async () => {
      const okTarget = await addRow(DB_B, 0);
      const wrongBase = await addRow(DB_A, 0);
      const missing = randomUUID();
      const id = randomUUID();
      const cells = { [COL_A]: [okTarget, wrongBase, missing, 42] };
      await restoreDatabaseRows(DB_A, [{ id, cells, position: 1 }], db, ALLOW);
      expect(await cellsOf(id)).toEqual({ [COL_A]: [okTarget] });
      expect(await cellsOf(okTarget)).toEqual({ [COL_B]: [id] });

      const id2 = randomUUID();
      await restoreDatabaseRows(DB_A, [{ id: id2, cells: { [COL_A]: [okTarget] }, position: 2 }], db, {
        canAccessRelationTarget: async () => false,
      });
      expect(await cellsOf(id2)).toEqual({ [COL_A]: [] });
      const id3 = randomUUID();
      await restoreDatabaseRows(DB_A, [{ id: id3, cells: { [COL_A]: [okTarget] }, position: 3 }], db);
      expect(await cellsOf(id3)).toEqual({ [COL_A]: [] });
    });

    it("idempotent : tous les ids déjà présents dans cette base aux mêmes positions", async () => {
      const a = await addRow(DB_A, 0);
      const b = await addRow(DB_A, 1);
      const out = await restoreDatabaseRows(
        DB_A,
        [{ id: b, cells: {}, position: 1 }, { id: a, cells: {}, position: 0 }],
        db
      );
      expect(out).toEqual({
        rows: [{ id: a, position: 0 }, { id: b, position: 1 }],
        alreadyRestored: true,
      });
      await expect(
        restoreDatabaseRows(DB_A, [{ id: a, cells: {}, position: 7 }], db)
      ).rejects.toMatchObject({ code: "invalid" });
    });
  });

  describe("verrous", () => {
    it("delete / reorder / duplicate / restore concurrents ne s'interbloquent pas", async () => {
      const ids: string[] = [];
      for (let i = 0; i < 8; i++) ids.push(await addRow(DB_A, i));
      const results = await Promise.allSettled([
        reorderDatabaseRows(DB_A, ids.slice(0, 4).reverse(), null, db),
        duplicateDatabaseRows(DB_A, ids.slice(2, 6), db),
        deleteDatabaseRows(DB_A, ids.slice(5, 8), db),
        reorderDatabaseRows(DB_A, ids.slice(0, 3), ids[7], db).catch((e) => {
          if (e instanceof RowBatchError) return [];
          throw e;
        }),
      ]);
      for (const r of results) {
        if (r.status === "rejected") {
          expect(String((r.reason as { code?: string }).code)).not.toBe("40P01");
        }
      }
    });
  });

  describe("restore : bornes", () => {
    it("accepte la position maximale sans débordement", async () => {
      const id = randomUUID();
      const out = await restoreDatabaseRows(DB_A, [{ id, cells: {}, position: 1_000_000 }], db);
      expect(out.rows).toEqual([{ id, position: 1_000_000 }]);
    });
  });

  describe("duplicateDatabaseRows", () => {
    it("insère chaque copie juste après son original et décale la suite", async () => {
      const a = await addRow(DB_A, 0, { [COL_TXT]: "a" });
      const b = await addRow(DB_A, 1, { [COL_TXT]: "b" });
      const c = await addRow(DB_A, 2, { [COL_TXT]: "c" });
      const out = await duplicateDatabaseRows(DB_A, [c, a], db);
      expect(out.map((r) => r.sourceId)).toEqual([a, c]);
      const [ca, cc] = out;
      expect(ca.cells[COL_TXT]).toBe("a");
      expect((await order(DB_A)).map((r) => r.id)).toEqual([a, ca.id, b, c, cc.id]);
      expect((await order(DB_A)).map((r) => r.position)).toEqual([0, 1, 2, 3, 4]);
      expect([ca.position, cc.position]).toEqual([1, 4]);
    });

    it("donne un nouveau numéro aux colonnes autonumber", async () => {
      const a = await addRow(DB_A, 0, { [COL_NUM]: 1 });
      const b = await addRow(DB_A, 1, { [COL_NUM]: 2 });
      const out = await duplicateDatabaseRows(DB_A, [a, b], db);
      expect(out.map((r) => r.cells[COL_NUM])).toEqual([3, 4]);
    });

    it("404 si une ligne n'appartient pas à la base", async () => {
      const foreign = await addRow(DB_B, 0);
      await expect(duplicateDatabaseRows(DB_A, [foreign], db)).rejects.toMatchObject({ code: "not_found" });
      expect(await order(DB_B)).toHaveLength(1);
    });
  });

  describe("reorderDatabaseRows", () => {
    async function seed() {
      const ids: string[] = [];
      for (let i = 0; i < 5; i++) ids.push(await addRow(DB_A, i * 10));
      return ids;
    }

    it("déplace le groupe, dans l'ordre donné, avant la cible, positions denses", async () => {
      const [a, b, c, d2, e] = await seed();
      const out = await reorderDatabaseRows(DB_A, [d2, b], c, db);
      expect(out).toEqual([a, d2, b, c, e].map((id, position) => ({ id, position })));
      expect(await order(DB_A)).toEqual(out);
    });

    it("beforeRowId null place le groupe à la fin", async () => {
      const [a, b, c, d2, e] = await seed();
      const out = await reorderDatabaseRows(DB_A, [a, c], null, db);
      expect(out.map((r) => r.id)).toEqual([b, d2, e, a, c]);
      expect((await order(DB_A)).map((r) => r.id)).toEqual([b, d2, e, a, c]);
    });

    it("refuse une ligne étrangère ou un beforeRowId inclus dans le lot", async () => {
      const [a, b] = await seed();
      const foreign = await addRow(DB_B, 0);
      await expect(reorderDatabaseRows(DB_A, [foreign], null, db)).rejects.toMatchObject({ code: "not_found" });
      await expect(reorderDatabaseRows(DB_A, [a], foreign, db)).rejects.toMatchObject({ code: "not_found" });
      await expect(reorderDatabaseRows(DB_A, [a, b], a, db)).rejects.toMatchObject({ code: "invalid" });
      void OTHER;
    });
  });
});
