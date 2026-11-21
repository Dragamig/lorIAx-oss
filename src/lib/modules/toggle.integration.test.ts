/**
 * Intégration de la bascule atomique sur un vrai Postgres. Activé par
 * RELATIONS_TEST_DATABASE_URL (base jetable dont le nom contient "test") ;
 * ignoré sinon. La table est créée dans un schéma dédié.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { Pool } from "pg";
import { PgDialect } from "drizzle-orm/pg-core";
import { buildModuleToggleQuery, resolveToggleKey } from "./toggle";
import { getModuleManifests } from "./registry";

const URL_ = process.env.RELATIONS_TEST_DATABASE_URL;
const DB_NAME = URL_ ? new URL(URL_).pathname.replace(/^\//, "") : "";
if (URL_ && !DB_NAME.includes("test")) {
  throw new Error(`RELATIONS_TEST_DATABASE_URL doit viser une base de test, reçu "${DB_NAME}"`);
}
const d = URL_ ? describe : describe.skip;

d("setModuleToggle (Postgres)", () => {
  let pool: Pool;
  const run = async (m: ReturnType<typeof getModuleManifests>[number], v: boolean) => {
    const q = new PgDialect().sqlToQuery(buildModuleToggleQuery(m, v));
    await pool.query(q.sql, q.params);
  };

  beforeAll(async () => {
    const admin = new Pool({ connectionString: URL_ });
    await admin.query("CREATE SCHEMA IF NOT EXISTS tg_test");
    await admin.end();
    pool = new Pool({ connectionString: URL_, options: "-c search_path=tg_test" });
    await pool.query(`DROP TABLE IF EXISTS system_settings;
      CREATE TABLE system_settings (key varchar(100) PRIMARY KEY, value jsonb NOT NULL,
      updated_at timestamptz NOT NULL DEFAULT now())`);
  });
  afterAll(async () => {
    await pool?.query("DROP TABLE IF EXISTS system_settings");
    await pool?.end();
  });

  it("crée, merge sans écraser et remplace une valeur non objet", async () => {
    const m = getModuleManifests()[0];
    const key = resolveToggleKey(m);
    const field = m.toggleField ?? "enabled";
    await run(m, true);
    await pool.query("UPDATE system_settings SET value = value || '{\"url\":\"x\"}'::jsonb WHERE key=$1", [key]);
    await run(m, false);
    let r = await pool.query("SELECT value FROM system_settings WHERE key=$1", [key]);
    expect(r.rows[0].value).toEqual({ url: "x", [field]: false });
    await pool.query("UPDATE system_settings SET value='true'::jsonb WHERE key=$1", [key]);
    await run(m, true);
    r = await pool.query("SELECT value FROM system_settings WHERE key=$1", [key]);
    expect(r.rows[0].value).toEqual({ [field]: true });
  });
});
