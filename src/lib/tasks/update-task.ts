/**
 * Écrivain transactionnel des tâches : verrouille la tâche, applique le patch et, pour une
 * tâche de ligne, écrit l'événement `completed` / `reopened` dans la même transaction.
 */
import { eq } from "drizzle-orm";
import { tasks, type Task } from "@/lib/db/schema";
import type { RowTaskEventKind } from "@/lib/db/schema-row-activity";
import type { DbExecutor } from "@/lib/databases/row-writes";
import { recordTaskEvent, taskEventKindFor, type TaskStatus } from "./record-task-event";

export type TaskPatch = {
  status?: TaskStatus;
  assigneeId?: string | null;
  dueAt?: Date | null;
  title?: string;
};

export async function updateTaskWithEvents(
  executor: DbExecutor,
  args: { taskId: string; actorUserId: string; patch: TaskPatch },
): Promise<{ previous: Task; updated: Task; eventKind: RowTaskEventKind | null } | null> {
  return executor.transaction(async (tx) => {
    const [previous] = await tx
      .select()
      .from(tasks)
      .where(eq(tasks.id, args.taskId))
      .for("update");
    if (!previous) return null;

    const { status, assigneeId, dueAt, title } = args.patch;
    const set: Partial<typeof tasks.$inferInsert> = { updatedAt: new Date() };
    if (status !== undefined) set.status = status;
    if (assigneeId !== undefined) set.assigneeId = assigneeId;
    if (dueAt !== undefined) set.dueAt = dueAt;
    if (title !== undefined) set.title = title;

    const [updated] = await tx.update(tasks).set(set).where(eq(tasks.id, args.taskId)).returning();

    let eventKind: RowTaskEventKind | null = null;
    if (previous.kind === "database_row" && status !== undefined) {
      eventKind = taskEventKindFor(previous.status, status);
      if (eventKind && previous.databaseId && previous.rowId) {
        await recordTaskEvent(tx, {
          taskId: previous.id,
          databaseId: previous.databaseId,
          rowId: previous.rowId,
          kind: eventKind,
          actorUserId: args.actorUserId,
        });
      }
    }
    return { previous, updated, eventKind };
  });
}
