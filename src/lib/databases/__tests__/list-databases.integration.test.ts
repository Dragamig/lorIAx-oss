/**
 * Service de lecture des bases contre la vraie base : cloisonnement par organisation et par espace,
 * exclusion des archivees et supprimees. Requiert RELATIONS_TEST_DATABASE_URL ; ignore sinon.
 */
import { describe, it, expect, vi, beforeAll, afterAll, beforeEach } from "vitest";
import { randomUUID } from "crypto";
import type { Pool } from "pg";
import { setupRowHistoryFixture } from "./row-history-fixture";

const h = vi.hoisted(() => ({ db: undefined as unknown }));

vi.mock("@/lib/db", () => ({
  db: new Proxy({}, { get: (_t, k) => (h.db as Record<string | symbol, unknown>)[k] }),
}));

import { listAccessibleDatabases, getDatabaseColumns, getDatabaseSummary } from "../list-databases";

const URL = process.env.RELATIONS_TEST_DATABASE_URL;
const DB_NAME = URL ? new globalThis.URL(URL).pathname.replace(/^\//, "") : "";
if (URL && !DB_NAME.includes("test")) {
  throw new Error(`RELATIONS_TEST_DATABASE_URL doit viser une base de test, reçu "${DB_NAME}"`);
}

describe.skipIf(!URL)("list-databases", () => {
  let pool: Pool;
  let teardown: () => Promise<void>;
  const ORG_A = randomUUID();
  const ORG_B = randomUUID();
  const SPACE_A = randomUUID();
  const SPACE_A2 = randomUUID();
  const SPACE_B = randomUUID();
  const DB_A = randomUUID();
  const DB_A_ARCHIVED = randomUUID();
  const DB_A_DELETED = randomUUID();
  const DB_A2 = randomUUID();
  const DB_B = randomUUID();

  beforeAll(async () => {
    const f = await setupRowHistoryFixture(URL!, "rh_list_dbs");
    pool = f.pool;
    teardown = f.teardown;
    h.db = f.db;
    await pool.query(`
      ALTER TABLE spaces ADD COLUMN name varchar(255) NOT NULL DEFAULT '';
      ALTER TABLE user_databases ADD COLUMN name varchar(255) NOT NULL DEFAULT '';
      ALTER TABLE user_databases ADD COLUMN archived_at timestamptz;
      ALTER TABLE user_databases ADD COLUMN deleted_at timestamptz;
    `);
  });
  afterAll(async () => {
    await teardown();
  });

  beforeEach(async () => {
    await pool.query("DELETE FROM user_database_columns");
    await pool.query("DELETE FROM user_databases");
    await pool.query("DELETE FROM spaces");
    await pool.query(
      "INSERT INTO spaces (id, organization_id, name) VALUES ($1,$2,'Espace A'),($3,$2,'Espace A2'),($4,$5,'Espace B')",
      [SPACE_A, ORG_A, SPACE_A2, SPACE_B, ORG_B],
    );
    await pool.query(
      `INSERT INTO user_databases (id, space_id, name, archived_at, deleted_at) VALUES
        ($1,$6,'Clients',NULL,NULL),
        ($2,$6,'Archivee',now(),NULL),
        ($3,$6,'Supprimee',NULL,now()),
        ($4,$7,'Hors liste',NULL,NULL),
        ($5,$8,'Autre org',NULL,NULL)`,
      [DB_A, DB_A_ARCHIVED, DB_A_DELETED, DB_A2, DB_B, SPACE_A, SPACE_A2, SPACE_B],
    );
    await pool.query("INSERT INTO user_database_rows (database_id) VALUES ($1),($1),($1)", [DB_A]);
  });

  it("liste une base de l'organisation avec son espace et son nombre de lignes", async () => {
    const res = await listAccessibleDatabases({ orgId: ORG_A, spaceIds: [SPACE_A] });
    expect(res).toEqual([
      { id: DB_A, name: "Clients", spaceId: SPACE_A, spaceName: "Espace A", rowCount: 3 },
    ]);
  });

  it("exclut les bases archivees et supprimees", async () => {
    const ids = (await listAccessibleDatabases({ orgId: ORG_A, spaceIds: [SPACE_A] })).map((d) => d.id);
    expect(ids).not.toContain(DB_A_ARCHIVED);
    expect(ids).not.toContain(DB_A_DELETED);
  });

  it("ne rend jamais une base d'une autre organisation, meme avec son espace dans spaceIds", async () => {
    const res = await listAccessibleDatabases({ orgId: ORG_A, spaceIds: [SPACE_A, SPACE_B] });
    expect(res.map((d) => d.id)).toEqual([DB_A]);
  });

  it("ne rend pas une base hors spaceIds", async () => {
    const res = await listAccessibleDatabases({ orgId: ORG_A, spaceIds: [SPACE_A] });
    expect(res.map((d) => d.id)).not.toContain(DB_A2);
  });

  it("rend [] pour spaceIds vide", async () => {
    expect(await listAccessibleDatabases({ orgId: ORG_A, spaceIds: [] })).toEqual([]);
  });

  it("getDatabaseColumns rend les colonnes dans l'ordre", async () => {
    await pool.query(
      `INSERT INTO user_database_columns (database_id, name, type, position) VALUES
        ($1,'Email','email',1),($1,'Nom','text',0)`,
      [DB_A],
    );
    const cols = await getDatabaseColumns(DB_A);
    expect(cols.map((c) => [c.name, c.type])).toEqual([["Nom", "text"], ["Email", "email"]]);
  });

  it("getDatabaseSummary rend le nom et le nombre de lignes, null si inconnue", async () => {
    expect(await getDatabaseSummary(DB_A)).toEqual({ id: DB_A, name: "Clients", rowCount: 3 });
    expect(await getDatabaseSummary(randomUUID())).toBeNull();
  });
});
