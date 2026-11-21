/**
 * Suppression d'un compte : ses vues personnelles sont supprimees, ses vues partagees subsistent.
 * Requiert RELATIONS_TEST_DATABASE_URL ; ignore sinon.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { randomUUID } from "crypto";
import type { Pool } from "pg";
import { setupViewsFixture } from "./views-fixture";
import { deletePersonalViewsOf } from "../view-cleanup";
import type { DbExecutor } from "../row-writes";

const URL = process.env.RELATIONS_TEST_DATABASE_URL;
const DB_NAME = URL ? new globalThis.URL(URL).pathname.replace(/^\//, "") : "";
if (URL && !DB_NAME.includes("test")) {
  throw new Error(`RELATIONS_TEST_DATABASE_URL doit viser une base de test, reçu "${DB_NAME}"`);
}

describe.skipIf(!URL)("deletePersonalViewsOf", () => {
  let pool: Pool;
  let exec: DbExecutor;
  let teardown: () => Promise<void>;
  const SPACE = randomUUID();
  const DB = randomUUID();
  const GONE = randomUUID();
  const OTHER = randomUUID();

  beforeAll(async () => {
    const f = await setupViewsFixture(URL!, "rh_l4_userdel");
    pool = f.pool;
    exec = f.db as unknown as DbExecutor;
    teardown = f.teardown;
  });
  afterAll(async () => {
    await teardown();
  });
  beforeEach(async () => {
    await pool.query("DELETE FROM user_database_views");
    await pool.query("DELETE FROM user_databases");
    await pool.query("DELETE FROM users");
    await pool.query("INSERT INTO users (id, name) VALUES ($1, 'Parti'), ($2, 'Reste')", [GONE, OTHER]);
    await pool.query("INSERT INTO user_databases (id, space_id) VALUES ($1, $2)", [DB, SPACE]);
    await pool.query(
      `INSERT INTO user_database_views (database_id, name, scope, created_by) VALUES
       ($1, 'perso parti', 'personal', $2), ($1, 'partagee parti', 'shared', $2), ($1, 'perso autre', 'personal', $3)`,
      [DB, GONE, OTHER],
    );
  });

  const names = async () =>
    (await pool.query("SELECT name FROM user_database_views ORDER BY name")).rows.map((r) => r.name as string);

  it("les vues personnelles de l'utilisateur sont supprimées", async () => {
    await deletePersonalViewsOf(exec, GONE);
    expect(await names()).not.toContain("perso parti");
  });
  it("ses vues partagées subsistent", async () => {
    await deletePersonalViewsOf(exec, GONE);
    expect(await names()).toContain("partagee parti");
  });
  it("les vues personnelles des autres subsistent", async () => {
    await deletePersonalViewsOf(exec, GONE);
    expect(await names()).toContain("perso autre");
  });
  it("idempotent : deux appels, aucune erreur", async () => {
    await deletePersonalViewsOf(exec, GONE);
    await expect(deletePersonalViewsOf(exec, GONE)).resolves.toBeUndefined();
    expect(await names()).toEqual(["partagee parti", "perso autre"]);
  });
});
