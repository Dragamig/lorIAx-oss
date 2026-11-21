/**
 * Événements de tâche de ligne. Requiert RELATIONS_TEST_DATABASE_URL ; ignore sinon.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { randomUUID } from "crypto";
import type { Pool } from "pg";
import { setupRowTasksFixture } from "./row-tasks-fixture";
import { updateTaskWithEvents } from "@/lib/tasks/update-task";
import type { DbExecutor } from "../row-writes";

const URL = process.env.RELATIONS_TEST_DATABASE_URL;
const DB_NAME = URL ? new globalThis.URL(URL).pathname.replace(/^\//, "") : "";
if (URL && !DB_NAME.includes("test")) {
  throw new Error(`RELATIONS_TEST_DATABASE_URL doit viser une base de test, reçu "${DB_NAME}"`);
}

describe.skipIf(!URL)("updateTaskWithEvents", () => {
  let pool: Pool;
  let exec: DbExecutor;
  let teardown: () => Promise<void>;
  const SPACE = randomUUID();
  const DB = randomUUID();
  const USER = randomUUID();
  const ROW = randomUUID();

  beforeAll(async () => {
    const f = await setupRowTasksFixture(URL!, "rh_l3_taskev");
    pool = f.pool;
    exec = f.db as unknown as DbExecutor;
    teardown = f.teardown;
  });
  afterAll(async () => {
    await teardown();
  });
  beforeEach(async () => {
    await pool.query("DELETE FROM tasks");
    await pool.query("DELETE FROM user_databases");
    await pool.query("DELETE FROM users");
    await pool.query("INSERT INTO users (id, name) VALUES ($1, 'Admin')", [USER]);
    await pool.query("INSERT INTO user_databases (id, space_id) VALUES ($1, $2)", [DB, SPACE]);
  });

  const rowTask = async (kind = "database_row") => {
    const r = await pool.query(
      kind === "database_row"
        ? `INSERT INTO tasks (kind, title, created_by, database_id, row_id)
           VALUES ('database_row', 't', $1, $2, $3) RETURNING id`
        : `INSERT INTO tasks (kind, title, created_by) VALUES ('${kind}', 't', $1) RETURNING id`,
      kind === "database_row" ? [USER, DB, ROW] : [USER],
    );
    return r.rows[0].id as string;
  };
  const events = async (id: string) =>
    (await pool.query("SELECT kind FROM database_row_task_events WHERE task_id = $1 ORDER BY created_at, id", [id])).rows.map(
      (r) => r.kind as string,
    );
  const set = (taskId: string, patch: Parameters<typeof updateTaskWithEvents>[1]["patch"], actor = USER) =>
    updateTaskWithEvents(exec, { taskId, actorUserId: actor, patch });

  it("cycle terminé, rouvert, terminé : trois événements dans l'ordre", async () => {
    const id = await rowTask();
    const a = await set(id, { status: "done" });
    expect(a?.eventKind).toBe("completed");
    await set(id, { status: "open" });
    await set(id, { status: "done" });
    expect(await events(id)).toEqual(["completed", "reopened", "completed"]);
  });

  it("cancelled, in_progress depuis open, échéance, titre, assigné : aucun événement", async () => {
    const id = await rowTask();
    await set(id, { status: "in_progress" });
    await set(id, { status: "cancelled" });
    const r = await set(id, { dueAt: new Date(), title: "autre", assigneeId: USER });
    expect(r?.updated.title).toBe("autre");
    expect(r?.updated.assigneeId).toBe(USER);
    expect(await events(id)).toEqual([]);
  });

  it("une tâche document_item ou gantt_event n'écrit aucun événement", async () => {
    for (const kind of ["document_item", "gantt_event"]) {
      const id = await rowTask(kind);
      const r = await set(id, { status: "done" });
      expect(r?.updated.status).toBe("done");
      expect(r?.eventKind).toBeNull();
      expect(await events(id)).toEqual([]);
    }
  });

  it("atomicité : si l'écriture de l'événement échoue (acteur inexistant violant la FK), le statut reste inchangé", async () => {
    const id = await rowTask();
    await expect(set(id, { status: "done" }, randomUUID())).rejects.toThrow();
    const st = (await pool.query("SELECT status FROM tasks WHERE id = $1", [id])).rows[0].status;
    expect(st).toBe("open");
    expect(await events(id)).toEqual([]);
  });

  it("deux updateTaskWithEvents concurrents vers done (Promise.all) : un seul événement completed", async () => {
    const id = await rowTask();
    await Promise.all([set(id, { status: "done" }), set(id, { status: "done" })]);
    expect(await events(id)).toEqual(["completed"]);
  });

  it("supprimer la tâche supprime ses événements (cascade)", async () => {
    const id = await rowTask();
    await set(id, { status: "done" });
    await pool.query("DELETE FROM tasks WHERE id = $1", [id]);
    const n = (await pool.query("SELECT count(*) AS n FROM database_row_task_events")).rows[0].n;
    expect(Number(n)).toBe(0);
  });

  it("tâche inexistante : renvoie null", async () => {
    expect(await set(randomUUID(), { status: "done" })).toBeNull();
  });
});
