import { and, asc, eq, inArray, sql } from "drizzle-orm";
import { tasks, users, type Task } from "@/lib/db/schema";
import { hasPermissionLevel } from "@/lib/auth/rbac";
import type { PermissionLevel } from "@/types";
import type { DbExecutor } from "./row-writes";

export type TaskStatus = Task["status"];

export type RowTaskDto = {
  id: string;
  title: string;
  status: TaskStatus;
  dueAt: string | null;
  assignee: { id: string; name: string } | null;
  createdBy: string;
  createdAt: string;
};

type RowArgs = { databaseId: string; rowId: string };
type TaskArgs = RowArgs & { taskId: string };

/** Filtre commun : toute requête est bornée par base, ligne et type database_row. */
const rowScope = ({ databaseId, rowId }: RowArgs) =>
  and(eq(tasks.kind, "database_row"), eq(tasks.databaseId, databaseId), eq(tasks.rowId, rowId));

const statusRank = sql`CASE ${tasks.status}
  WHEN 'open' THEN 0 WHEN 'in_progress' THEN 1 WHEN 'done' THEN 2 ELSE 3 END`;

const dtoColumns = {
  id: tasks.id,
  title: tasks.title,
  status: tasks.status,
  dueAt: tasks.dueAt,
  assigneeId: tasks.assigneeId,
  assigneeName: users.name,
  createdBy: tasks.createdBy,
  createdAt: tasks.createdAt,
};

function toRowTaskDto(r: {
  id: string;
  title: string;
  status: TaskStatus;
  dueAt: Date | null;
  assigneeId: string | null;
  assigneeName: string | null;
  createdBy: string;
  createdAt: Date;
}): RowTaskDto {
  return {
    id: r.id,
    title: r.title,
    status: r.status,
    dueAt: r.dueAt ? r.dueAt.toISOString() : null,
    assignee: r.assigneeId ? { id: r.assigneeId, name: r.assigneeName ?? "" } : null,
    createdBy: r.createdBy,
    createdAt: r.createdAt.toISOString(),
  };
}

/** Ouvertes, en cours, terminées, annulées ; puis échéance croissante (nulls en dernier), puis création. */
export async function listRowTasks(executor: DbExecutor, args: RowArgs): Promise<RowTaskDto[]> {
  const rows = await executor
    .select(dtoColumns)
    .from(tasks)
    .leftJoin(users, eq(users.id, tasks.assigneeId))
    .where(rowScope(args))
    .orderBy(statusRank, sql`${tasks.dueAt} ASC NULLS LAST`, asc(tasks.createdAt), asc(tasks.id));
  return rows.map(toRowTaskDto);
}

/** Une tâche au format de la liste ; nul si elle n'appartient pas à cette ligne de cette base. */
export async function getRowTaskDto(executor: DbExecutor, args: TaskArgs): Promise<RowTaskDto | null> {
  const [row] = await executor
    .select(dtoColumns)
    .from(tasks)
    .leftJoin(users, eq(users.id, tasks.assigneeId))
    .where(and(rowScope(args), eq(tasks.id, args.taskId)))
    .limit(1);
  return row ? toRowTaskDto(row) : null;
}

export async function countOpenRowTasks(executor: DbExecutor, args: RowArgs): Promise<number> {
  const [row] = await executor
    .select({ n: sql<number>`count(*)::int` })
    .from(tasks)
    .where(and(rowScope(args), inArray(tasks.status, ["open", "in_progress"])));
  return row?.n ?? 0;
}

/** Nul si la tâche n'appartient pas à cette ligne de cette base. */
export async function getRowTask(executor: DbExecutor, args: TaskArgs): Promise<Task | null> {
  const [row] = await executor
    .select()
    .from(tasks)
    .where(and(rowScope(args), eq(tasks.id, args.taskId)))
    .limit(1);
  return row ?? null;
}

/** Suppression réservée au créateur (editor au moins) ou à un admin d'espace ; événements en cascade. */
export async function deleteRowTask(
  executor: DbExecutor,
  args: TaskArgs & { actor: { userId: string; permission: PermissionLevel } },
): Promise<"deleted" | "not_found" | "forbidden"> {
  const task = await getRowTask(executor, args);
  if (!task) return "not_found";
  const { actor } = args;
  const allowed =
    actor.permission === "admin" ||
    (task.createdBy === actor.userId && hasPermissionLevel(actor.permission, "editor"));
  if (!allowed) return "forbidden";
  const deleted = await executor
    .delete(tasks)
    .where(and(rowScope(args), eq(tasks.id, args.taskId)))
    .returning({ id: tasks.id });
  return deleted.length ? "deleted" : "not_found";
}
