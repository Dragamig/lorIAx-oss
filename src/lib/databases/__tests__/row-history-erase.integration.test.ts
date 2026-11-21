/**
 * Effacement RGPD de l'historique d'une ligne. Requiert RELATIONS_TEST_DATABASE_URL ; ignore sinon.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { randomUUID } from "crypto";
import type { Pool } from "pg";
import { setupRowTasksFixture } from "./row-tasks-fixture";
import { eraseRowHistory } from "../row-history-read";
import type { DbExecutor } from "../row-writes";

const URL = process.env.RELATIONS_TEST_DATABASE_URL;
const DB_NAME = URL ? new globalThis.URL(URL).pathname.replace(/^\//, "") : "";
if (URL && !DB_NAME.includes("test")) {
  throw new Error(`RELATIONS_TEST_DATABASE_URL doit viser une base de test, reçu "${DB_NAME}"`);
}

describe.skipIf(!URL)("eraseRowHistory", () => {
  let pool: Pool;
  let exec: DbExecutor;
  let teardown: () => Promise<void>;
  const SPACE = randomUUID();
  const DB = randomUUID();
  const USER = randomUUID();
  const ROW = randomUUID();
  const OTHER = randomUUID();

  beforeAll(async () => {
    const f = await setupRowTasksFixture(URL!, "rh_erase");
    pool = f.pool;
    exec = f.db as unknown as DbExecutor;
    teardown = f.teardown;
  });
  afterAll(async () => {
    await teardown();
  });
  beforeEach(async () => {
    await pool.query("DELETE FROM activity_log");
    await pool.query("DELETE FROM database_row_task_events");
    await pool.query("DELETE FROM tasks");
    await pool.query("DELETE FROM database_row_comments");
    await pool.query("DELETE FROM notifications");
    await pool.query("DELETE FROM database_row_changes");
    await pool.query("DELETE FROM user_databases");
    await pool.query("DELETE FROM users");
    await pool.query("INSERT INTO users (id, name) VALUES ($1, 'Admin')", [USER]);
    await pool.query("INSERT INTO user_databases (id, space_id) VALUES ($1, $2)", [DB, SPACE]);
  });

  const entry = (row: string) =>
    pool.query(
      `INSERT INTO database_row_changes (database_id, row_id, kind, source, batch_id, changes)
       VALUES ($1, $2, 'updated', 'ui', $3, '[{"after":"secret"}]'::jsonb)`,
      [DB, row, randomUUID()]
    );
  const comment = (row: string, deleted = false) =>
    pool.query(
      `INSERT INTO database_row_comments (database_id, row_id, author_id, body, deleted_at)
       VALUES ($1, $2, $3, 'texte-confidentiel', ${deleted ? "now()" : "NULL"})`,
      [DB, row, USER]
    );
  const task = async (row: string) => {
    const { rows } = await pool.query(
      `INSERT INTO tasks (kind, title, created_by, database_id, row_id)
       VALUES ('database_row', 'titre-confidentiel', $1, $2, $3) RETURNING id`,
      [USER, DB, row]
    );
    await pool.query(
      `INSERT INTO database_row_task_events (task_id, database_id, row_id, kind, actor_user_id)
       VALUES ($1, $2, $3, 'created', $4)`,
      [rows[0].id, DB, row, USER]
    );
  };
  const n = async (table: string, row: string) =>
    Number((await pool.query(`SELECT count(*) AS n FROM ${table} WHERE row_id = $1`, [row])).rows[0].n);
  const count = async (row: string) =>
    Number((await pool.query("SELECT count(*) AS n FROM database_row_changes WHERE row_id = $1", [row])).rows[0].n);

  it("supprime toutes les entrées de la ligne, qu'elle existe encore ou non, et laisse celles des autres lignes", async () => {
    await entry(ROW);
    await entry(ROW);
    await entry(OTHER);
    const res = await eraseRowHistory(exec, { databaseId: DB, rowId: ROW, userId: USER });
    expect(res).toEqual({ erased: 2, comments: 0, tasks: 0, taskEvents: 0 });
    expect(await count(ROW)).toBe(0);
    expect(await count(OTHER)).toBe(1);
  });

  it("écrit une entrée activity_log sans valeurs de cellules (metadata ne contient que databaseId et erased)", async () => {
    await entry(ROW);
    await eraseRowHistory(exec, { databaseId: DB, rowId: ROW, userId: USER });
    const { rows } = await pool.query("SELECT * FROM activity_log");
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      user_id: USER,
      action: "row_history.erased",
      entity_type: "database_row",
      entity_id: ROW,
    });
    expect(rows[0].metadata).toEqual({ databaseId: DB, erased: 1, comments: 0, tasks: 0, taskEvents: 0 });
    expect(JSON.stringify(rows[0])).not.toContain("secret");
  });

  it("consigne l'effacement même sans aucune entrée (erased 0)", async () => {
    const res = await eraseRowHistory(exec, { databaseId: DB, rowId: ROW, userId: USER });
    expect(res).toEqual({ erased: 0, comments: 0, tasks: 0, taskEvents: 0 });
    expect((await pool.query("SELECT metadata FROM activity_log")).rows[0].metadata.erased).toBe(0);
  });

  it("échec d'insertion activity_log : les entrées ne sont pas supprimées (transaction)", async () => {
    await entry(ROW);
    await pool.query("ALTER TABLE activity_log ADD CONSTRAINT always_fail CHECK (false) NOT VALID");
    try {
      await expect(eraseRowHistory(exec, { databaseId: DB, rowId: ROW, userId: USER })).rejects.toThrow();
    } finally {
      await pool.query("ALTER TABLE activity_log DROP CONSTRAINT always_fail");
    }
    expect(await count(ROW)).toBe(1);
  });

  it("supprime historique, commentaires dont supprimés logiquement, tâches de la ligne et leurs événements, laisse les autres lignes", async () => {
    await entry(ROW);
    await comment(ROW);
    await comment(ROW, true);
    await task(ROW);
    await pool.query(
      `INSERT INTO notifications (user_id, type, title, message, database_id, row_id)
       VALUES ($1, 'task_assigned', 'Tâche assignée', 'Vous avez été assigné à : titre-confidentiel', $2, $3)`,
      [USER, DB, ROW]
    );
    await entry(OTHER);
    await comment(OTHER);
    await task(OTHER);
    await pool.query(
      `INSERT INTO notifications (user_id, type, title, message, database_id, row_id)
       VALUES ($1, 'task_assigned', 'Tâche assignée', 'autre ligne', $2, $3)`,
      [USER, DB, OTHER]
    );
    const res = await eraseRowHistory(exec, { databaseId: DB, rowId: ROW, userId: USER });
    expect(res).toEqual({ erased: 1, comments: 2, tasks: 1, taskEvents: 1 });
    for (const t of ["database_row_changes", "database_row_comments", "tasks", "database_row_task_events", "notifications"]) {
      expect(await n(t, ROW)).toBe(0);
    }
    expect(await n("database_row_comments", OTHER)).toBe(1);
    expect(await n("tasks", OTHER)).toBe(1);
    expect(await n("database_row_task_events", OTHER)).toBe(1);
    expect(await n("database_row_changes", OTHER)).toBe(1);
    expect(await n("notifications", OTHER)).toBe(1);
  });

  it("activity_log contient les comptes et aucun texte de commentaire ni titre de tâche", async () => {
    await comment(ROW);
    await task(ROW);
    await eraseRowHistory(exec, { databaseId: DB, rowId: ROW, userId: USER });
    const { rows } = await pool.query("SELECT * FROM activity_log");
    expect(rows[0].metadata).toEqual({ databaseId: DB, erased: 0, comments: 1, tasks: 1, taskEvents: 1 });
    const dump = JSON.stringify(rows[0]);
    expect(dump).not.toContain("confidentiel");
  });

  it("échec d'insertion activity_log : commentaires, tâches et événements ne sont pas supprimés", async () => {
    await comment(ROW);
    await task(ROW);
    await pool.query("ALTER TABLE activity_log ADD CONSTRAINT always_fail2 CHECK (false) NOT VALID");
    try {
      await expect(eraseRowHistory(exec, { databaseId: DB, rowId: ROW, userId: USER })).rejects.toThrow();
    } finally {
      await pool.query("ALTER TABLE activity_log DROP CONSTRAINT always_fail2");
    }
    expect(await n("database_row_comments", ROW)).toBe(1);
    expect(await n("tasks", ROW)).toBe(1);
    expect(await n("database_row_task_events", ROW)).toBe(1);
  });
});
