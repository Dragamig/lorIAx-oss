/**
 * Événements de tâche de ligne : fil d'activité de la fiche. Écrits dans la
 * transaction qui modifie la tâche (voir `update-task.ts`).
 */
import { databaseRowTaskEvents, type RowTaskEventKind } from "@/lib/db/schema-row-activity";
import type { DbExecutor } from "@/lib/databases/row-writes";

export type TaskStatus = "open" | "in_progress" | "done" | "cancelled";

/**
 * Événement produit par un changement de statut. `created` n'est jamais produit ici
 * (la création appelle `recordTaskEvent` directement).
 */
export function taskEventKindFor(
  previous: TaskStatus | null,
  next: TaskStatus,
): RowTaskEventKind | null {
  if (next === "done" && previous !== "done") return "completed";
  if (previous === "done" && (next === "open" || next === "in_progress")) return "reopened";
  return null;
}

export async function recordTaskEvent(
  tx: DbExecutor,
  args: {
    taskId: string;
    databaseId: string;
    rowId: string;
    kind: RowTaskEventKind;
    actorUserId: string | null;
  },
): Promise<void> {
  await tx.insert(databaseRowTaskEvents).values({
    taskId: args.taskId,
    databaseId: args.databaseId,
    rowId: args.rowId,
    kind: args.kind,
    actorUserId: args.actorUserId,
  });
}
