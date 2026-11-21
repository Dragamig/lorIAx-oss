import { db } from "@/lib/db";
import { tasks } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import { createNotification } from "@/lib/notifications";

export async function notifyTaskAssigned(
  taskId: string,
  assigneeId: string,
  actorId: string
): Promise<void> {
  const [task] = await db
    .select({
      id: tasks.id,
      title: tasks.title,
      documentId: tasks.documentId,
      databaseId: tasks.databaseId,
      rowId: tasks.rowId,
    })
    .from(tasks)
    .where(eq(tasks.id, taskId))
    .limit(1);

  if (!task) return;

  await createNotification({
    userId: assigneeId,
    type: "task_assigned",
    title: "Tâche assignée",
    message: `Vous avez été assigné à : ${task.title}`,
    documentId: task.documentId ?? undefined,
    databaseId: task.databaseId ?? undefined,
    rowId: task.rowId ?? undefined,
    actorId,
  });
}
