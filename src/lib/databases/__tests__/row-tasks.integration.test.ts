/**
 * Lecture et suppression des tâches d'une ligne. Requiert RELATIONS_TEST_DATABASE_URL ; ignore sinon.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { randomUUID } from "crypto";
import type { Pool } from "pg";
import { setupRowTasksFixture } from "./row-tasks-fixture";
import { listRowTasks, countOpenRowTasks, getRowTask, getRowTaskDto, deleteRowTask } from "../row-tasks";
import type { DbExecutor } from "../row-writes";

const URL = process.env.RELATIONS_TEST_DATABASE_URL;
const DB_NAME = URL ? new globalThis.URL(URL).pathname.replace(/^\//, "") : "";
if (URL && !DB_NAME.includes("test")) {
  throw new Error(`RELATIONS_TEST_DATABASE_URL doit viser une base de test, reçu "${DB_NAME}"`);
}

describe.skipIf(!URL)("row-tasks", () => {
  let pool: Pool;
  let exec: DbExecutor;
  let teardown: () => Promise<void>;
  const SPACE = randomUUID();
  const DB = randomUUID();
  const DB2 = randomUUID();
  const ROW = randomUUID();
  const ROW2 = randomUUID();
  const CREATOR = randomUUID();
  const OTHER = randomUUID();
  const ASSIGNEE = randomUUID();

  beforeAll(async () => {
    const f = await setupRowTasksFixture(URL!, "rh_l3_tasks");
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
    await pool.query("INSERT INTO users (id, name) VALUES ($1, 'Créateur'), ($2, 'Autre'), ($3, 'Alice')", [
      CREATOR,
      OTHER,
      ASSIGNEE,
    ]);
    await pool.query("INSERT INTO user_databases (id, space_id) VALUES ($1, $3), ($2, $3)", [DB, DB2, SPACE]);
  });

  async function add(
    title: string,
    o: { db?: string; row?: string; status?: string; due?: string | null; assignee?: string | null; kind?: string; createdAt?: string } = {},
  ) {
    const kind = o.kind ?? "database_row";
    const r = await pool.query(
      `INSERT INTO tasks (kind, title, status, due_at, assignee_id, created_by, database_id, row_id, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, COALESCE($9::timestamptz, now())) RETURNING id`,
      [
        kind,
        title,
        o.status ?? "open",
        o.due ?? null,
        o.assignee ?? null,
        CREATOR,
        kind === "database_row" ? (o.db ?? DB) : null,
        kind === "database_row" ? (o.row ?? ROW) : null,
        o.createdAt ?? null,
      ],
    );
    return r.rows[0].id as string;
  }
  const args = { databaseId: DB, rowId: ROW };

  it("liste uniquement les tâches de la ligne, pas celles d'une autre ligne ni d'une autre base", async () => {
    await add("a");
    await add("autre ligne", { row: ROW2 });
    await add("autre base", { db: DB2 });
    await add("document", { kind: "document_item" });
    const list = await listRowTasks(exec, args);
    expect(list.map((t) => t.title)).toEqual(["a"]);
  });

  it("ordre ouvertes, en cours, terminées, annulées, puis échéance croissante nulls en dernier, puis création", async () => {
    await add("annulee", { status: "cancelled" });
    await add("terminee", { status: "done" });
    await add("en cours", { status: "in_progress" });
    await add("ouverte sans echeance 1", { createdAt: "2026-01-01" });
    await add("ouverte sans echeance 2", { createdAt: "2026-01-02" });
    await add("ouverte tard", { due: "2026-12-01T00:00:00Z" });
    await add("ouverte tot", { due: "2026-03-01T00:00:00Z" });
    const list = await listRowTasks(exec, args);
    expect(list.map((t) => t.title)).toEqual([
      "ouverte tot",
      "ouverte tard",
      "ouverte sans echeance 1",
      "ouverte sans echeance 2",
      "en cours",
      "terminee",
      "annulee",
    ]);
  });

  it("assignee résolu avec son nom, dates en ISO", async () => {
    await add("t", { assignee: ASSIGNEE, due: "2026-03-01T00:00:00Z" });
    await add("sans");
    const list = await listRowTasks(exec, args);
    const t = list.find((x) => x.title === "t")!;
    expect(t.assignee).toEqual({ id: ASSIGNEE, name: "Alice" });
    expect(t.dueAt).toBe("2026-03-01T00:00:00.000Z");
    expect(t.createdBy).toBe(CREATOR);
    expect(typeof t.createdAt).toBe("string");
    expect(list.find((x) => x.title === "sans")!.assignee).toBeNull();
  });

  it("getRowTaskDto : même forme que la liste, null hors de la ligne", async () => {
    const id = await add("t", { assignee: ASSIGNEE, due: "2026-03-01T00:00:00Z" });
    const dto = await getRowTaskDto(exec, { ...args, taskId: id });
    expect(dto).toEqual((await listRowTasks(exec, args)).find((x) => x.id === id));
    expect(dto?.assignee).toEqual({ id: ASSIGNEE, name: "Alice" });
    expect(await getRowTaskDto(exec, { databaseId: DB, rowId: ROW2, taskId: id })).toBeNull();
  });

  it("countOpenRowTasks ignore terminées et annulées", async () => {
    await add("o");
    await add("p", { status: "in_progress" });
    await add("d", { status: "done" });
    await add("c", { status: "cancelled" });
    await add("autre", { row: ROW2 });
    expect(await countOpenRowTasks(exec, args)).toBe(2);
  });

  it("getRowTask d'une autre ligne ou base : null", async () => {
    const id = await add("a");
    expect((await getRowTask(exec, { ...args, taskId: id }))?.id).toBe(id);
    expect(await getRowTask(exec, { databaseId: DB, rowId: ROW2, taskId: id })).toBeNull();
    expect(await getRowTask(exec, { databaseId: DB2, rowId: ROW, taskId: id })).toBeNull();
    const doc = await add("doc", { kind: "document_item" });
    expect(await getRowTask(exec, { ...args, taskId: doc })).toBeNull();
  });

  it("deleteRowTask par le créateur, par un admin, forbidden pour un autre éditeur, not_found pour une autre ligne", async () => {
    const a = await add("a");
    const b = await add("b");
    const c = await add("c");
    expect(
      await deleteRowTask(exec, { ...args, taskId: a, actor: { userId: OTHER, permission: "editor" } }),
    ).toBe("forbidden");
    expect(
      await deleteRowTask(exec, { ...args, taskId: a, actor: { userId: CREATOR, permission: "viewer" } }),
    ).toBe("forbidden");
    expect(
      await deleteRowTask(exec, { ...args, taskId: a, actor: { userId: CREATOR, permission: "editor" } }),
    ).toBe("deleted");
    expect(
      await deleteRowTask(exec, { ...args, taskId: b, actor: { userId: OTHER, permission: "admin" } }),
    ).toBe("deleted");
    expect(
      await deleteRowTask(exec, { databaseId: DB, rowId: ROW2, taskId: c, actor: { userId: CREATOR, permission: "admin" } }),
    ).toBe("not_found");
    expect(
      await deleteRowTask(exec, { ...args, taskId: a, actor: { userId: CREATOR, permission: "editor" } }),
    ).toBe("not_found");
    expect(await getRowTask(exec, { ...args, taskId: c })).not.toBeNull();
  });

  it("suppression : événements en cascade", async () => {
    const id = await add("a");
    await pool.query(
      "INSERT INTO database_row_task_events (task_id, database_id, row_id, kind, actor_user_id) VALUES ($1, $2, $3, 'created', $4)",
      [id, DB, ROW, CREATOR],
    );
    await deleteRowTask(exec, { ...args, taskId: id, actor: { userId: CREATOR, permission: "editor" } });
    const r = await pool.query("SELECT count(*) AS n FROM database_row_task_events WHERE task_id = $1", [id]);
    expect(Number(r.rows[0].n)).toBe(0);
  });
});
