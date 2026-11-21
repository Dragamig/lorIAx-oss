/**
 * Lecture fusionnée de l'activité d'une ligne. Requiert RELATIONS_TEST_DATABASE_URL ; ignore sinon.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { randomUUID } from "crypto";
import type { Pool } from "pg";
import { setupRowTasksFixture } from "./row-tasks-fixture";
import { listRowActivity } from "../row-activity-read";
import { InvalidHistoryCursorError, encodeHistoryCursor } from "../row-history-read";
import type { DbExecutor } from "../row-writes";

const URL = process.env.RELATIONS_TEST_DATABASE_URL;
const DB_NAME = URL ? new globalThis.URL(URL).pathname.replace(/^\//, "") : "";
if (URL && !DB_NAME.includes("test")) {
  throw new Error(`RELATIONS_TEST_DATABASE_URL doit viser une base de test, reçu "${DB_NAME}"`);
}

describe.skipIf(!URL)("listRowActivity", () => {
  let pool: Pool;
  let exec: DbExecutor;
  let teardown: () => Promise<void>;
  const ORG = randomUUID();
  const OTHER_ORG = randomUUID();
  const SPACE = randomUUID();
  const DB = randomUUID();
  const DB2 = randomUUID();
  const ROW = randomUUID();
  const ROW2 = randomUUID();
  const ME = randomUUID();
  const OUTSIDER = randomUUID();
  const T0 = "2026-01-01T10:00:00.123456+00";

  beforeAll(async () => {
    const f = await setupRowTasksFixture(URL!, "rh_l3_activity");
    pool = f.pool;
    exec = f.db as unknown as DbExecutor;
    teardown = f.teardown;
  });
  afterAll(async () => {
    await teardown();
  });
  beforeEach(async () => {
    for (const t of ["database_row_task_events", "database_row_comments", "database_row_changes", "tasks"]) {
      await pool.query(`DELETE FROM ${t}`);
    }
    await pool.query("DELETE FROM user_databases");
    await pool.query("DELETE FROM spaces");
    await pool.query("DELETE FROM organization_members");
    await pool.query("DELETE FROM users");
    await pool.query("INSERT INTO spaces (id, organization_id) VALUES ($1, $2)", [SPACE, ORG]);
    await pool.query("INSERT INTO user_databases (id, space_id) VALUES ($1, $3), ($2, $3)", [DB, DB2, SPACE]);
    await pool.query("INSERT INTO users (id, name) VALUES ($1, 'Alice'), ($2, 'Zed')", [ME, OUTSIDER]);
    await pool.query("INSERT INTO organization_members (organization_id, user_id) VALUES ($1, $2)", [ORG, ME]);
    await pool.query("INSERT INTO organization_members (organization_id, user_id) VALUES ($1, $2)", [OTHER_ORG, OUTSIDER]);
  });

  const list = (extra: { cursor?: string; limit?: number; db?: string; row?: string } = {}) =>
    listRowActivity(exec, {
      databaseId: extra.db ?? DB,
      rowId: extra.row ?? ROW,
      orgId: ORG,
      cursor: extra.cursor,
      limit: extra.limit ?? 20,
    });

  const change = (at: string, o: { id?: string; db?: string; row?: string; actor?: string | null } = {}) =>
    pool.query(
      `INSERT INTO database_row_changes (id, database_id, row_id, kind, source, actor_user_id, batch_id, changes, created_at)
       VALUES ($1, $2, $3, 'updated', 'ui', $4, gen_random_uuid(), '[]'::jsonb, $5)`,
      [o.id ?? randomUUID(), o.db ?? DB, o.row ?? ROW, o.actor === undefined ? ME : o.actor, at],
    );
  const comment = (at: string, o: { id?: string; db?: string; row?: string; author?: string | null; deleted?: boolean } = {}) =>
    pool.query(
      `INSERT INTO database_row_comments (id, database_id, row_id, author_id, body, mentions, created_at, deleted_at)
       VALUES ($1, $2, $3, $4, 'secret', $5::jsonb, $6, $7)`,
      [
        o.id ?? randomUUID(), o.db ?? DB, o.row ?? ROW, o.author === undefined ? ME : o.author,
        JSON.stringify([ME]), at, o.deleted ? at : null,
      ],
    );
  const task = async (title = "Tâche") => {
    const id = randomUUID();
    await pool.query(
      "INSERT INTO tasks (id, kind, title, created_by, database_id, row_id) VALUES ($1, 'database_row', $2, $3, $4, $5)",
      [id, title, ME, DB, ROW],
    );
    return id;
  };
  const event = (taskId: string, kind: string, at: string, o: { id?: string; db?: string; row?: string; actor?: string | null } = {}) =>
    pool.query(
      `INSERT INTO database_row_task_events (id, task_id, database_id, row_id, kind, actor_user_id, created_at)
       VALUES ($1, $2, $3, $4, $5::row_task_event_kind, $6, $7)`,
      [o.id ?? randomUUID(), taskId, o.db ?? DB, o.row ?? ROW, kind, o.actor === undefined ? ME : o.actor, at],
    );

  it("fusionne historique, commentaires et événements de tâche triés created_at desc puis id desc", async () => {
    const t = await task();
    await change("2026-01-01T10:00:01Z");
    await comment("2026-01-01T10:00:03Z");
    await event(t, "created", "2026-01-01T10:00:02Z");
    const { items } = await list();
    expect(items.map((i) => i.type)).toEqual(["comment", "task_created", "change"]);
    expect(items[0]).toMatchObject({ actor: { id: ME, name: "Alice" } });
  });

  it("60 éléments de même created_at répartis sur les trois sources, pages de 20 : aucun doublon ni trou", async () => {
    const t = await task();
    const expected: string[] = [];
    for (let i = 0; i < 20; i++) {
      const a = randomUUID(), b = randomUUID(), c = randomUUID();
      await change(T0, { id: a });
      await comment(T0, { id: b });
      await event(t, "completed", T0, { id: c });
      expected.push(a, b, c);
    }
    const seen: string[] = [];
    let cursor: string | undefined;
    let pages = 0;
    do {
      const r = await list({ cursor, limit: 20 });
      seen.push(...r.items.map((i) => i.id));
      cursor = r.nextCursor ?? undefined;
      pages++;
    } while (cursor && pages < 10);
    expect(pages).toBe(3);
    expect(new Set(seen).size).toBe(60);
    expect([...seen].sort()).toEqual([...expected].sort());
    expect(seen).toEqual([...seen].sort().reverse());
  });

  it("nextCursor nul sur la dernière page", async () => {
    await change("2026-01-01T10:00:01Z");
    await change("2026-01-01T10:00:02Z");
    const p1 = await list({ limit: 1 });
    expect(p1.nextCursor).not.toBeNull();
    const p2 = await list({ limit: 1, cursor: p1.nextCursor! });
    expect(p2.items).toHaveLength(1);
    expect(p2.nextCursor).toBeNull();
  });

  it("curseur falsifié : InvalidHistoryCursorError", async () => {
    await expect(list({ cursor: "zzz" })).rejects.toBeInstanceOf(InvalidHistoryCursorError);
  });

  it.each(["2026-02-31T00:00:00.000000Z", "9999-99-99T99:99:99.000000Z"])(
    "curseur à date impossible %s : InvalidHistoryCursorError, pas d'erreur SQL",
    async (t) => {
      const cursor = encodeHistoryCursor(t, randomUUID());
      await expect(list({ cursor })).rejects.toBeInstanceOf(InvalidHistoryCursorError);
    },
  );

  it("commentaire supprimé : sans corps", async () => {
    await comment("2026-01-01T10:00:01Z", { deleted: true });
    const [c] = (await list()).items;
    expect(c).toMatchObject({ type: "comment", body: null, mentions: [], deleted: true });
    expect(JSON.stringify(c)).not.toContain("secret");
  });

  it("événements created, completed, reopened avec le titre courant de la tâche", async () => {
    const t = await task("Ancien");
    await event(t, "created", "2026-01-01T10:00:01Z");
    await event(t, "completed", "2026-01-01T10:00:02Z");
    await event(t, "reopened", "2026-01-01T10:00:03Z");
    await pool.query("UPDATE tasks SET title = 'Nouveau' WHERE id = $1", [t]);
    const { items } = await list();
    expect(items.map((i) => i.type)).toEqual(["task_reopened", "task_completed", "task_created"]);
    for (const i of items) expect(i).toMatchObject({ taskId: t, taskTitle: "Nouveau" });
  });

  it("tâche supprimée : événements disparus, taskTitle jamais d'un autre enregistrement", async () => {
    const t = await task("A");
    const other = await task("B");
    await event(t, "created", "2026-01-01T10:00:01Z");
    await event(other, "created", "2026-01-01T10:00:02Z");
    await pool.query("DELETE FROM tasks WHERE id = $1", [t]);
    const { items } = await list();
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({ taskId: other, taskTitle: "B" });
  });

  it("une autre base ou une autre ligne ne fuit pas dans aucune des trois branches", async () => {
    const t = await task();
    for (const o of [{ db: DB2 }, { row: ROW2 }]) {
      await change("2026-01-01T10:00:01Z", o);
      await comment("2026-01-01T10:00:01Z", o);
      await event(t, "created", "2026-01-01T10:00:01Z", o);
    }
    expect((await list()).items).toHaveLength(0);
    expect((await list({ db: DB2 })).items).toHaveLength(3);
    expect(await listRowActivity(exec, { databaseId: DB, rowId: ROW, orgId: OTHER_ORG, limit: 20 })).toMatchObject({ items: [] });
  });

  it("acteur hors organisation : actor nul", async () => {
    const t = await task();
    await change("2026-01-01T10:00:01Z", { actor: OUTSIDER });
    await comment("2026-01-01T10:00:02Z", { author: OUTSIDER });
    await event(t, "created", "2026-01-01T10:00:03Z", { actor: OUTSIDER });
    const { items } = await list();
    expect(items).toHaveLength(3);
    for (const i of items) expect(i.actor).toBeNull();
  });

  it("auteur supprimé : actor nul et commentaire listé", async () => {
    await comment("2026-01-01T10:00:01Z");
    await pool.query("DELETE FROM users WHERE id = $1", [ME]);
    const { items } = await list();
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({ type: "comment", actor: null, body: "secret" });
  });

  it("ligne supprimée : activité lisible", async () => {
    // Aucune ligne dans user_database_rows : seul le couple (database_id, row_id) compte.
    await change("2026-01-01T10:00:01Z");
    expect((await list()).items).toHaveLength(1);
  });
});
