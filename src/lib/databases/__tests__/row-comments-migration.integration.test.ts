/**
 * Migration 0056 (commentaires et taches de ligne). Requiert RELATIONS_TEST_DATABASE_URL ; ignore sinon.
 * La fixture est creee SANS database_row, tables ni index : la migration doit tout apporter.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { randomUUID } from "crypto";
import type { Pool } from "pg";
import { getTableColumns, type Table } from "drizzle-orm";
import { setupRowTasksFixture } from "./row-tasks-fixture";
import { Pool as PgPool } from "pg";
import { ensureRowCommentsAndTasks, ensureTaskKindRowValue } from "../../../../scripts/migrate-row-comments";
import { tasks, notifications } from "@/lib/db/schema";
import { databaseRowComments, databaseRowTaskEvents } from "@/lib/db/schema-row-activity";

const URL = process.env.RELATIONS_TEST_DATABASE_URL;
const DB_NAME = URL ? new globalThis.URL(URL).pathname.replace(/^\//, "") : "";
if (URL && !DB_NAME.includes("test")) {
  throw new Error(`RELATIONS_TEST_DATABASE_URL doit viser une base de test, reçu "${DB_NAME}"`);
}

const SCHEMA = "rh_l3_migration";

describe.skipIf(!URL)("ensureRowCommentsAndTasks", () => {
  let pool: Pool;
  let teardown: () => Promise<void>;
  let connectionString: string;

  beforeAll(async () => {
    const f = await setupRowTasksFixture(URL!, SCHEMA, { preMigrated: false });
    pool = f.pool;
    teardown = f.teardown;
    const u = new globalThis.URL(URL!);
    u.searchParams.set("options", `-c search_path=${SCHEMA}`);
    connectionString = u.toString();
  });
  afterAll(async () => {
    await teardown();
  });

  const cols = async (table: string) =>
    (
      await pool.query<{ column_name: string }>(
        "SELECT column_name FROM information_schema.columns WHERE table_schema = $1 AND table_name = $2",
        [SCHEMA, table],
      )
    ).rows.map((r) => r.column_name);

  it("la fixture de départ n'a ni database_row ni les nouvelles tables", async () => {
    const { rows } = await pool.query("SELECT unnest(enum_range(NULL::task_kind))::text AS v");
    expect(rows.map((r) => r.v)).not.toContain("database_row");
    expect(await cols("database_row_comments")).toEqual([]);
    expect(await cols("tasks")).not.toContain("database_id");
  });

  it("appliquée deux fois : idempotente, task_kind contient database_row", async () => {
    expect(await ensureRowCommentsAndTasks(connectionString)).toEqual({ applied: true });
    expect(await ensureRowCommentsAndTasks(connectionString)).toEqual({ applied: true });
    const { rows } = await pool.query("SELECT unnest(enum_range(NULL::task_kind))::text AS v");
    expect(rows.map((r) => r.v)).toContain("database_row");
  });

  it("crée row_task_event_kind, les deux tables et les 5 index", async () => {
    const t = await pool.query(
      `SELECT t.typname FROM pg_type t JOIN pg_namespace n ON n.oid = t.typnamespace
       WHERE n.nspname = $1 AND t.typname = 'row_task_event_kind'`,
      [SCHEMA],
    );
    expect(t.rowCount).toBe(1);
    expect((await cols("database_row_comments")).length).toBeGreaterThan(0);
    expect((await cols("database_row_task_events")).length).toBeGreaterThan(0);
    const { rows } = await pool.query<{ indexname: string }>(
      "SELECT indexname FROM pg_indexes WHERE schemaname = $1 AND indexname = ANY($2)",
      [
        SCHEMA,
        [
          "idx_tasks_database_row",
          "idx_row_comments_row",
          "idx_row_comments_deleted",
          "idx_row_task_events_row",
          "idx_row_task_events_task",
        ],
      ],
    );
    expect(rows.map((r) => r.indexname).sort()).toEqual([
      "idx_row_comments_deleted",
      "idx_row_comments_row",
      "idx_row_task_events_row",
      "idx_row_task_events_task",
      "idx_tasks_database_row",
    ]);
  });

  it("la contrainte refuse une tâche database_row sans database_id ou sans row_id", async () => {
    const user = randomUUID();
    const dbId = randomUUID();
    await pool.query("INSERT INTO users (id, name) VALUES ($1, 'U')", [user]);
    await pool.query("INSERT INTO user_databases (id, space_id) VALUES ($1, $2)", [dbId, randomUUID()]);
    const ins = (d: string | null, r: string | null) =>
      pool.query(
        "INSERT INTO tasks (kind, title, created_by, database_id, row_id) VALUES ('database_row', 't', $1, $2, $3)",
        [user, d, r],
      );
    await expect(ins(null, randomUUID())).rejects.toThrow(/tasks_database_row_ctx/);
    await expect(ins(dbId, null)).rejects.toThrow(/tasks_database_row_ctx/);
    await expect(ins(dbId, randomUUID())).resolves.toBeDefined();
  });

  it("fixture drift : colonnes alignées sur les schémas Drizzle", async () => {
    const expected = (t: Table) => Object.values(getTableColumns(t)).map((c) => c.name);
    for (const [name, table] of [
      ["notifications", notifications],
      ["database_row_comments", databaseRowComments],
      ["database_row_task_events", databaseRowTaskEvents],
    ] as const) {
      expect((await cols(name)).sort()).toEqual(expected(table).sort());
    }
    const taskCols = await cols("tasks");
    expect(taskCols).toContain("database_id");
    expect(taskCols).toContain("row_id");
    for (const c of expected(tasks)) expect(taskCols).toContain(c);
  });
});

describe.skipIf(!URL)("ensureRowCommentsAndTasks sans tables", () => {
  it("renvoie null si tasks n'existe pas", async () => {
    const f = await (await import("./row-history-fixture")).setupRowHistoryFixture(URL!, "rh_l3_migration_empty");
    try {
      const u = new globalThis.URL(URL!);
      u.searchParams.set("options", "-c search_path=rh_l3_migration_empty");
      expect(await ensureRowCommentsAndTasks(u.toString())).toBeNull();
    } finally {
      await f.teardown();
    }
  });
});

const PRE_SCHEMA = "rh_l3_prepush";
const FRESH_SCHEMA = "rh_l3_prepush_fresh";

describe.skipIf(!URL)("ensureTaskKindRowValue (avant drizzle-kit push)", () => {
  let pool: Pool;
  let teardown: () => Promise<void>;
  const withSchema = (schema: string) => {
    const u = new globalThis.URL(URL!);
    u.searchParams.set("options", `-c search_path=${schema}`);
    return u.toString();
  };

  beforeAll(async () => {
    const f = await setupRowTasksFixture(URL!, PRE_SCHEMA, { preMigrated: false });
    pool = f.pool;
    teardown = f.teardown;
  });
  afterAll(async () => {
    await teardown();
    const admin = new PgPool({ connectionString: URL });
    await admin.query(`DROP SCHEMA IF EXISTS ${FRESH_SCHEMA} CASCADE`);
    await admin.end();
  });

  it("ajoute database_row au type quand il en manque, de façon idempotente", async () => {
    const before = await pool.query("SELECT unnest(enum_range(NULL::task_kind))::text AS v");
    expect(before.rows.map((r) => r.v)).not.toContain("database_row");
    expect(await ensureTaskKindRowValue(withSchema(PRE_SCHEMA))).toEqual({ added: true });
    expect(await ensureTaskKindRowValue(withSchema(PRE_SCHEMA))).toEqual({ added: true });
    const after = await pool.query("SELECT unnest(enum_range(NULL::task_kind))::text AS v");
    expect(after.rows.map((r) => r.v)).toContain("database_row");
  });

  it("saute sans erreur quand le type n'existe pas encore (base fraîche)", async () => {
    const admin = new PgPool({ connectionString: URL });
    await admin.query(`DROP SCHEMA IF EXISTS ${FRESH_SCHEMA} CASCADE`);
    await admin.query(`CREATE SCHEMA ${FRESH_SCHEMA}`);
    await admin.end();
    expect(await ensureTaskKindRowValue(withSchema(FRESH_SCHEMA))).toEqual({ added: false });
  });
});
