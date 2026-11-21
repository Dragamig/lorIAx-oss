/**
 * createTask pour les tâches de ligne. Requiert RELATIONS_TEST_DATABASE_URL ; ignore sinon.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { randomUUID } from "crypto";
import type { Pool } from "pg";
import { setupRowTasksFixture } from "./row-tasks-fixture";
import { createTask } from "@/lib/tasks/create-task";
import type { DbExecutor } from "../row-writes";

const URL = process.env.RELATIONS_TEST_DATABASE_URL;
const DB_NAME = URL ? new globalThis.URL(URL).pathname.replace(/^\//, "") : "";
if (URL && !DB_NAME.includes("test")) {
  throw new Error(`RELATIONS_TEST_DATABASE_URL doit viser une base de test, reçu "${DB_NAME}"`);
}

describe.skipIf(!URL)("createTask", () => {
  let pool: Pool;
  let exec: DbExecutor;
  let teardown: () => Promise<void>;
  const SPACE = randomUUID();
  const DB = randomUUID();
  const USER = randomUUID();
  const ROW = randomUUID();

  beforeAll(async () => {
    const f = await setupRowTasksFixture(URL!, "rh_l3_taskcreate");
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

  const events = async (id: string) =>
    (await pool.query("SELECT kind, actor_user_id FROM database_row_task_events WHERE task_id = $1", [id])).rows;
  const taskCount = async () => Number((await pool.query("SELECT count(*) AS n FROM tasks")).rows[0].n);

  it("crée une tâche database_row avec database_id, row_id et un événement created acteur le créateur", async () => {
    const { id } = await createTask(
      { title: " Appeler ", createdBy: USER, kind: "database_row", databaseId: DB, rowId: ROW },
      exec,
    );
    const t = (await pool.query("SELECT * FROM tasks WHERE id = $1", [id])).rows[0];
    expect(t.kind).toBe("database_row");
    expect(t.title).toBe("Appeler");
    expect(t.database_id).toBe(DB);
    expect(t.row_id).toBe(ROW);
    expect(t.due_at).toBeNull();
    expect(await events(id)).toEqual([{ kind: "created", actor_user_id: USER }]);
  });

  it("database_row sans rowId : lève une erreur, rien n'est écrit", async () => {
    await expect(
      createTask({ title: "x", createdBy: USER, kind: "database_row", databaseId: DB }, exec),
    ).rejects.toThrow();
    expect(await taskCount()).toBe(0);
  });

  it("un titre vide lève l'erreur existante", async () => {
    await expect(createTask({ title: "  ", createdBy: USER }, exec)).rejects.toThrow("Title cannot be empty");
  });

  it("l'événement created disparaît avec la tâche", async () => {
    const { id } = await createTask(
      { title: "x", createdBy: USER, kind: "database_row", databaseId: DB, rowId: ROW },
      exec,
    );
    await pool.query("DELETE FROM tasks WHERE id = $1", [id]);
    expect(await events(id)).toEqual([]);
  });

  it("tâche document_item : comportement inchangé, aucun événement", async () => {
    const { id } = await createTask({ title: "doc", createdBy: USER }, exec);
    const t = (await pool.query("SELECT kind, database_id, row_id FROM tasks WHERE id = $1", [id])).rows[0];
    expect(t).toEqual({ kind: "document_item", database_id: null, row_id: null });
    expect(await events(id)).toEqual([]);
  });
});
