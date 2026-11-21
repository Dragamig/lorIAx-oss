/**
 * Purge de l'historique des lignes supprimées. Requiert RELATIONS_TEST_DATABASE_URL ; ignore sinon.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { randomUUID } from "crypto";
import type { Pool } from "pg";
import { setupRowTasksFixture } from "./row-tasks-fixture";
import { purgeDeletedRowHistory } from "../row-history-purge";
import type { DbExecutor } from "../row-writes";

const URL = process.env.RELATIONS_TEST_DATABASE_URL;
const DB_NAME = URL ? new globalThis.URL(URL).pathname.replace(/^\//, "") : "";
if (URL && !DB_NAME.includes("test")) {
  throw new Error(`RELATIONS_TEST_DATABASE_URL doit viser une base de test, reçu "${DB_NAME}"`);
}

describe.skipIf(!URL)("purgeDeletedRowHistory", () => {
  let pool: Pool;
  let exec: DbExecutor;
  let teardown: () => Promise<void>;
  const SPACE = randomUUID();
  const DB = randomUUID();
  const USER = randomUUID();

  beforeAll(async () => {
    const f = await setupRowTasksFixture(URL!, "rh_purge");
    pool = f.pool;
    exec = f.db as unknown as DbExecutor;
    teardown = f.teardown;
  });
  afterAll(async () => {
    await teardown();
  });
  beforeEach(async () => {
    await pool.query("DELETE FROM database_row_task_events");
    await pool.query("DELETE FROM tasks");
    await pool.query("DELETE FROM database_row_comments");
    await pool.query("DELETE FROM notifications");
    await pool.query("DELETE FROM database_row_changes");
    await pool.query("DELETE FROM user_databases");
    await pool.query("DELETE FROM users");
    await pool.query("INSERT INTO users (id, name) VALUES ($1, 'U')", [USER]);
    await pool.query("INSERT INTO user_databases (id, space_id) VALUES ($1, $2)", [DB, SPACE]);
  });

  const entry = (row: string, kind: "created" | "updated" | "deleted", daysAgo: number) =>
    pool.query(
      `INSERT INTO database_row_changes (database_id, row_id, kind, source, batch_id, changes, created_at)
       VALUES ($1, $2, $3, 'ui', $4, '[]'::jsonb, now() - make_interval(days => $5))`,
      [DB, row, kind, randomUUID(), daysAgo]
    );
  const count = async (row?: string) =>
    Number(
      (
        await pool.query(
          "SELECT count(*) AS n FROM database_row_changes WHERE ($1::uuid IS NULL OR row_id = $1::uuid)",
          [row ?? null]
        )
      ).rows[0].n
    );
  const comment = (row: string, deletedDaysAgo: number | null = null) =>
    pool.query(
      `INSERT INTO database_row_comments (database_id, row_id, author_id, body, deleted_at)
       VALUES ($1, $2, $3, 'x', CASE WHEN $4::int IS NULL THEN NULL ELSE now() - make_interval(days => $4::int) END)`,
      [DB, row, USER, deletedDaysAgo]
    );
  const task = async (row: string) => {
    const { rows } = await pool.query(
      `INSERT INTO tasks (kind, title, created_by, database_id, row_id)
       VALUES ('database_row', 't', $1, $2, $3) RETURNING id`,
      [USER, DB, row]
    );
    await pool.query(
      `INSERT INTO database_row_task_events (task_id, database_id, row_id, kind) VALUES ($1, $2, $3, 'created')`,
      [rows[0].id, DB, row]
    );
  };
  const notif = (row: string) =>
    pool.query(
      `INSERT INTO notifications (user_id, type, title, message, database_id, row_id)
       VALUES ($1, 'task_assigned', 'Tâche assignée', 'Vous avez été assigné à : titre-confidentiel', $2, $3)`,
      [USER, DB, row]
    );
  const n = async (table: string, row: string) =>
    Number((await pool.query(`SELECT count(*) AS n FROM ${table} WHERE row_id = $1`, [row])).rows[0].n);
  const present = (row: string) =>
    pool.query("INSERT INTO user_database_rows (id, database_id) VALUES ($1, $2)", [row, DB]);

  it("ligne supprimée il y a 31 jours : toutes ses entrées purgées", async () => {
    const r = randomUUID();
    await entry(r, "created", 60);
    await entry(r, "updated", 45);
    await entry(r, "deleted", 31);
    const res = await purgeDeletedRowHistory(exec);
    expect(res.purged).toBe(3);
    expect(await count(r)).toBe(0);
  });

  it("supprimée il y a 29 jours : conservées", async () => {
    const r = randomUUID();
    await entry(r, "created", 60);
    await entry(r, "deleted", 29);
    expect((await purgeDeletedRowHistory(exec)).purged).toBe(0);
    expect(await count(r)).toBe(2);
  });

  it("supprimée il y a 31 jours puis restaurée (ligne présente) : conservées", async () => {
    const r = randomUUID();
    await entry(r, "created", 60);
    await entry(r, "deleted", 31);
    await present(r);
    const before = await count(r);
    expect((await purgeDeletedRowHistory(exec)).purged).toBe(0);
    expect(await count(r)).toBe(before);
  });

  it("supprimée il y a 40 jours, restaurée, supprimée à nouveau il y a 5 jours : conservées", async () => {
    const r = randomUUID();
    await entry(r, "deleted", 40);
    await entry(r, "created", 20);
    await entry(r, "deleted", 5);
    expect((await purgeDeletedRowHistory(exec)).purged).toBe(0);
    expect(await count(r)).toBe(3);
  });

  it("ligne vivante sans entrée deleted : conservée", async () => {
    const r = randomUUID();
    await entry(r, "created", 90);
    await present(r);
    const before = await count(r);
    expect((await purgeDeletedRowHistory(exec)).purged).toBe(0);
    expect(await count(r)).toBe(before);
  });

  it("plus de lots que batchSize : tout est purgé", async () => {
    for (let i = 0; i < 5; i++) {
      const r = randomUUID();
      await entry(r, "created", 50);
      await entry(r, "deleted", 40);
    }
    const res = await purgeDeletedRowHistory(exec, { batchSize: 2 });
    expect(res.purged).toBe(10);
    expect(await count()).toBe(0);
  });

  it("idempotente : second appel renvoie purged 0", async () => {
    const r = randomUUID();
    await entry(r, "deleted", 40);
    expect((await purgeDeletedRowHistory(exec)).purged).toBe(1);
    expect((await purgeDeletedRowHistory(exec)).purged).toBe(0);
  });

  it("verrou pris par une autre transaction : purged 0 sans erreur", async () => {
    const r = randomUUID();
    await entry(r, "deleted", 40);
    const other = await pool.connect();
    try {
      await other.query("BEGIN");
      await other.query("select pg_advisory_xact_lock(hashtextextended('row-history-purge', 0))");
      expect((await purgeDeletedRowHistory(exec)).purged).toBe(0);
      expect(await count(r)).toBe(1);
    } finally {
      await other.query("ROLLBACK");
      other.release();
    }
    expect((await purgeDeletedRowHistory(exec)).purged).toBe(1);
  });

  it("ligne supprimée il y a 31 jours : historique, commentaires, tâches et événements purgés ; il y a 29 jours : conservés", async () => {
    const old = randomUUID();
    const recent = randomUUID();
    for (const [r, d] of [[old, 31], [recent, 29]] as const) {
      await entry(r, "created", 60);
      await entry(r, "deleted", d);
      await comment(r);
      await task(r);
    }
    const res = await purgeDeletedRowHistory(exec);
    expect(res).toEqual({ purged: 2, comments: 1, tasks: 1, taskEvents: 1 });
    for (const t of ["database_row_changes", "database_row_comments", "tasks", "database_row_task_events"]) {
      expect(await n(t, old)).toBe(0);
    }
    expect(await n("database_row_comments", recent)).toBe(1);
    expect(await n("tasks", recent)).toBe(1);
    expect(await n("database_row_task_events", recent)).toBe(1);
  });

  it("notifications : celle de la ligne purgée disparaît, celle d'une autre ligne reste", async () => {
    const old = randomUUID();
    const other = randomUUID();
    await entry(old, "deleted", 31);
    await notif(old);
    await present(other);
    await notif(other);
    await purgeDeletedRowHistory(exec);
    expect(await n("notifications", old)).toBe(0);
    expect(await n("notifications", other)).toBe(1);
  });

  it("ligne restaurée : historique, commentaires, tâches et événements conservés", async () => {
    const r = randomUUID();
    await entry(r, "deleted", 31);
    await present(r);
    await comment(r);
    await task(r);
    const res = await purgeDeletedRowHistory(exec);
    expect(res).toEqual({ purged: 0, comments: 0, tasks: 0, taskEvents: 0 });
    expect(await n("database_row_comments", r)).toBe(1);
    expect(await n("tasks", r)).toBe(1);
    expect(await n("database_row_task_events", r)).toBe(1);
  });

  it("commentaire supprimé logiquement il y a 31 jours : purgé ; il y a 29 jours : conservé (ligne vivante)", async () => {
    const r = randomUUID();
    await present(r);
    await comment(r, 31);
    await comment(r, 29);
    await comment(r);
    const res = await purgeDeletedRowHistory(exec);
    expect(res.comments).toBe(1);
    expect(await n("database_row_comments", r)).toBe(2);
  });

  it("les tâches et événements des autres lignes ne sont pas touchés", async () => {
    const gone = randomUUID();
    const other = randomUUID();
    await entry(gone, "deleted", 40);
    await task(gone);
    await task(other);
    await purgeDeletedRowHistory(exec);
    expect(await n("tasks", gone)).toBe(0);
    expect(await n("tasks", other)).toBe(1);
    expect(await n("database_row_task_events", other)).toBe(1);
  });

  it("verrou pris : tout à zéro sans erreur, commentaires anciens conservés", async () => {
    const r = randomUUID();
    await present(r);
    await comment(r, 40);
    const other = await pool.connect();
    try {
      await other.query("BEGIN");
      await other.query("select pg_advisory_xact_lock(hashtextextended('row-history-purge', 0))");
      expect(await purgeDeletedRowHistory(exec)).toEqual({ purged: 0, comments: 0, tasks: 0, taskEvents: 0 });
      expect(await n("database_row_comments", r)).toBe(1);
    } finally {
      await other.query("ROLLBACK");
      other.release();
    }
  });
});
