/**
 * Helper pur de création de tâche — modelé sur l'insert de
 * `sync-document-tasks.ts` mais sans upsert (pas de `nodeId` à réconcilier) :
 * une tâche autonome créée par un workflow `create_task`. Notifie l'assigné le
 * cas échéant. Suppose que l'appelant a vérifié les droits.
 */
import { db } from "@/lib/db";
import logger from "@/lib/logger";
import { tasks } from "@/lib/db/schema";
import type { DbExecutor } from "@/lib/databases/row-writes";
import { notifyTaskAssigned } from "./notify-task-assigned";
import { recordTaskEvent } from "./record-task-event";

export interface CreateTaskInput {
  title: string;
  /** userId créateur (FK tasks.created_by, NOT NULL). */
  createdBy: string;
  assigneeId?: string | null;
  dueAt?: Date | null;
  documentId?: string | null;
  /** Défaut `document_item`. `database_row` exige `databaseId` et `rowId`. */
  kind?: "document_item" | "database_row";
  databaseId?: string | null;
  rowId?: string | null;
}

export async function createTask(
  input: CreateTaskInput,
  executor: DbExecutor = db,
): Promise<{ id: string }> {
  const { title, createdBy, assigneeId, dueAt, documentId, databaseId, rowId } = input;
  const kind = input.kind ?? "document_item";

  const trimmedTitle = title.trim();
  if (!trimmedTitle) {
    throw new Error('Title cannot be empty');
  }
  if (kind === "database_row" && (!databaseId || !rowId)) {
    throw new Error('databaseId and rowId are required for a database_row task');
  }

  const created = await executor.transaction(async (tx) => {
    const [row] = await tx
      .insert(tasks)
      .values({
        kind,
        title: trimmedTitle,
        status: "open",
        assigneeId: assigneeId ?? null,
        dueAt: dueAt ?? null,
        documentId: documentId ?? null,
        databaseId: kind === "database_row" ? databaseId : null,
        rowId: kind === "database_row" ? rowId : null,
        createdBy,
      })
      .returning({ id: tasks.id });

    if (!row) {
      throw new Error('Failed to create task');
    }

    if (kind === "database_row") {
      await recordTaskEvent(tx, {
        taskId: row.id,
        databaseId: databaseId!,
        rowId: rowId!,
        kind: "created",
        actorUserId: createdBy,
      });
    }
    return row;
  });

  if (assigneeId) {
    // La tâche est déjà validée : un échec de notification ne doit pas faire croire à un échec d'écriture.
    try {
      await notifyTaskAssigned(created.id, assigneeId, createdBy);
    } catch (err) {
      logger.error({ err, taskId: created.id }, "Notification d'assignation de tâche en échec");
    }
  }

  return created;
}
