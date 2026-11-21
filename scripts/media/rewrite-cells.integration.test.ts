/**
 * Exécution réelle de rewrite-cells contre une base de test dédiée.
 * Requiert MEDIA_TEST_DATABASE_URL (base dont le nom contient "test") ; ignoré sinon.
 */
import { createHash, randomUUID } from "node:crypto";
import { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { rewriteCells } from "./rewrite-cells";
import { Report } from "./lib/report";

const URL_ = process.env.MEDIA_TEST_DATABASE_URL;
const DB_NAME = URL_ ? new URL(URL_).pathname.replace(/^\//, "") : "";
if (URL_ && !DB_NAME.includes("test")) {
  throw new Error(`MEDIA_TEST_DATABASE_URL doit viser une base de test, reçu "${DB_NAME}"`);
}
const SCHEMA = "mrc_cells";

describe.skipIf(!URL_)("rewrite-cells (base de test)", () => {
  let pool: Pool;
  const ORG = randomUUID();
  const OTHER_ORG = randomUUID();
  const SPACE = randomUUID();
  const DBID = randomUUID();
  const COL_IMG = randomUUID();
  const COL_ATT = randomUUID();
  const M1 = randomUUID();
  const SPACE_B = randomUUID();
  const SPACE_ORG = randomUUID();
  const M_ORG = randomUUID();
  const ROW3 = randomUUID();
  const ROW4 = randomUUID();
  const ROW = randomUUID();
  const ROW2 = randomUUID();

  const hash = async () => {
    const r = await pool.query("select id, cells, updated_at from user_database_rows order by id");
    return createHash("sha256").update(JSON.stringify(r.rows)).digest("hex");
  };

  beforeAll(async () => {
    const admin = new Pool({ connectionString: URL_ });
    await admin.query(`DROP SCHEMA IF EXISTS ${SCHEMA} CASCADE`);
    await admin.query(`CREATE SCHEMA ${SCHEMA}`);
    await admin.end();
    pool = new Pool({ connectionString: URL_, options: `-c search_path=${SCHEMA}` });
    await pool.query(`
      CREATE TABLE spaces (id uuid PRIMARY KEY, organization_id uuid NOT NULL, type text NOT NULL DEFAULT 'team', classification text);
      CREATE TABLE user_databases (id uuid PRIMARY KEY, space_id uuid NOT NULL);
      CREATE TABLE user_database_columns (id uuid PRIMARY KEY, database_id uuid NOT NULL, type text NOT NULL, position int NOT NULL DEFAULT 0);
      CREATE TABLE user_database_rows (id uuid PRIMARY KEY, database_id uuid NOT NULL, cells jsonb NOT NULL DEFAULT '{}', position int NOT NULL DEFAULT 0, updated_at timestamptz NOT NULL DEFAULT now());
      CREATE TABLE media (id uuid PRIMARY KEY, organization_id uuid NOT NULL, space_id uuid, filename text NOT NULL, mime_type text NOT NULL,
        size_bytes bigint NOT NULL, storage_key text NOT NULL UNIQUE, deleted_at timestamptz);
    `);
    await pool.query("insert into spaces values ($1,$2)", [SPACE, ORG]);
    await pool.query("insert into spaces values ($1,$3,'team','internal'),($2,$3,'organization','internal')", [SPACE_B, SPACE_ORG, ORG]);
    await pool.query("insert into user_databases values ($1,$2)", [DBID, SPACE]);
    await pool.query(
      "insert into media values ($1,$2,$3,'b.png','image/png',5,'otherspace',null),($4,$2,null,'c.png','image/png',5,'nospace',null),($5,$2,$6,'d.png','image/png',5,'orgwide',null),($7,$2,$3,'e.png','image/png',5,'trashed',now())",
      [randomUUID(), ORG, SPACE_B, randomUUID(), M_ORG, SPACE_ORG, randomUUID()]
    );
    await pool.query("insert into user_database_rows (id, database_id, cells) values ($1,$3,$4::jsonb),($2,$3,$5::jsonb)", [
      ROW3,
      ROW4,
      DBID,
      JSON.stringify({ [COL_IMG]: "/api/attachments/otherspace", [COL_ATT]: [{ key: "nospace" }, { key: "trashed" }] }),
      JSON.stringify({ [COL_IMG]: "/api/attachments/orgwide" }),
    ]);
    await pool.query("insert into user_database_columns values ($1,$2,'image',0),($3,$2,'attachment',1)", [COL_IMG, DBID, COL_ATT]);
    await pool.query("insert into media values ($1,$2,$3,'a.pdf','application/pdf',10,'k1',null)", [M1, ORG, SPACE]);
    await pool.query("insert into media values ($1,$2,null,'x.png','image/png',5,'foreign',null)", [randomUUID(), OTHER_ORG]);
    await pool.query("insert into user_database_rows (id, database_id, cells) values ($1,$3,$4::jsonb),($2,$3,$5::jsonb)", [
      ROW,
      ROW2,
      DBID,
      JSON.stringify({ [COL_IMG]: "/api/attachments/k1", [COL_ATT]: [{ key: "k1" }, { key: "zz" }, { filename: "a.pdf" }] }),
      JSON.stringify({ [COL_IMG]: "/api/attachments/foreign", [COL_ATT]: null }),
    ]);
  });

  afterAll(async () => {
    if (!pool) return;
    await pool.query(`DROP SCHEMA IF EXISTS ${SCHEMA} CASCADE`).catch(() => {});
    await pool.end();
  });

  it("simulation : aucune écriture", async () => {
    const before = await hash();
    const report = new Report();
    const r = await rewriteCells(pool, { apply: false, reportPath: "x" }, report);
    expect(r.written).toBe(0);
    expect(await hash()).toBe(before);
    expect(report.summary()["cell:image"].rewritten).toBe(2);
  });

  it("--apply réécrit le sûr, laisse le reste, puis une seconde passe ne change rien", async () => {
    const mode = { apply: true, reportPath: "x" };
    const first = await rewriteCells(pool, mode, new Report());
    expect(first.written).toBe(3);
    const { rows } = await pool.query("select id, cells from user_database_rows");
    const r1 = rows.find((r) => r.id === ROW).cells;
    expect(r1[COL_IMG]).toBe(`/api/media/${M1}`);
    expect(r1[COL_ATT]).toHaveLength(3);
    expect(r1[COL_ATT][0].mediaId).toBe(M1);
    expect(r1[COL_ATT][1]).toEqual({ key: "zz" });
    expect(r1[COL_ATT][2]).toEqual({ filename: "a.pdf" });
    expect(rows.find((r) => r.id === ROW2).cells[COL_IMG]).toBe("/api/attachments/foreign");
    const r3 = rows.find((r) => r.id === ROW3).cells;
    expect(r3[COL_IMG]).toBe("/api/attachments/otherspace");
    expect(r3[COL_ATT]).toEqual([{ key: "nospace" }, { key: "trashed" }]);
    expect(rows.find((r) => r.id === ROW4).cells[COL_IMG]).toBe(`/api/media/${M_ORG}`);

    const after = await hash();
    const second = new Report();
    const r2 = await rewriteCells(pool, mode, second);
    expect(r2.written).toBe(0);
    expect(await hash()).toBe(after);
    expect(second.summary()["cell:image"].rewritten).toBe(0);
  });
});
