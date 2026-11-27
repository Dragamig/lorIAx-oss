/**
 * Source "ai" de l'historique de ligne. Requiert RELATIONS_TEST_DATABASE_URL ; ignore sinon.
 * Schema dedie rh_ai_source.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { randomUUID } from "crypto";
import type { Pool } from "pg";
import { setupRowHistoryFixture } from "./row-history-fixture";

const URL = process.env.RELATIONS_TEST_DATABASE_URL;
const DB_NAME = URL ? new globalThis.URL(URL).pathname.replace(/^\//, "") : "";
if (URL && !DB_NAME.includes("test")) {
  throw new Error(`RELATIONS_TEST_DATABASE_URL doit viser une base de test, reçu "${DB_NAME}"`);
}

describe.skipIf(!URL)("row history source ai", () => {
  let pool: Pool;
  let teardown: () => Promise<void>;
  const DB = randomUUID();
  const SPACE = randomUUID();
  const USER = randomUUID();
  const COL_A = randomUUID();

  beforeAll(async () => {
    const f = await setupRowHistoryFixture(URL!, "rh_ai_source");
    pool = f.pool;
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
      "INSERT INTO user_database_columns (id, database_id, name, type, position) VALUES ($1, $2, 'Nom', 'text', 0)",
      [COL_A, DB]
    );
  });

  it("une écriture avec source ai est historisée avec l'humain comme acteur", async () => {
    const c = await pool.connect();
    try {
      await c.query("BEGIN");
      await c.query("select set_config('loriax.row_ctx', $1, true)", [
        JSON.stringify({ source: "ai", actorUserId: USER }),
      ]);
      await c.query("INSERT INTO user_database_rows (id, database_id, cells) VALUES ($1, $2, $3)", [
        randomUUID(),
        DB,
        JSON.stringify({ [COL_A]: "Acme" }),
      ]);
      await c.query("COMMIT");
    } finally {
      c.release();
    }
    const rows = (await pool.query("SELECT source, actor_user_id FROM database_row_changes")).rows;
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ source: "ai", actor_user_id: USER });
  });
});
