import type { JSONContent } from "@tiptap/core";
import { db } from "@/lib/db";
import { tasks } from "@/lib/db/schema";
import { and, eq, notInArray, sql } from "drizzle-orm";
import { notifyTaskAssigned } from "./notify-task-assigned";

export interface ExtractedTaskItem {
  nodeId: string;
  title: string;
  checked: boolean;
  status: "open" | "in_progress" | "done";
  assigneeId: string | null;
}

export function extractTaskItems(node: JSONContent): ExtractedTaskItem[] {
  const result: ExtractedTaskItem[] = [];

  if (node.type === "taskItem") {
    const nodeId = (node.attrs?.nodeId as string | null) ?? null;
    if (!nodeId) return result;

    const checked = (node.attrs?.checked as boolean) ?? false;
    const rawStatus = node.attrs?.status as string | undefined;
    const status: "open" | "in_progress" | "done" =
      rawStatus === "in_progress" || rawStatus === "done" ? rawStatus : checked ? "done" : "open";
    const explicitAssigneeId = (node.attrs?.assigneeId as string | null) ?? null;

    let title = "";
    let mentionUserId: string | null = null;

    if (node.content) {
      for (const child of node.content) {
        if (child.type === "paragraph" && child.content) {
          for (const inline of child.content) {
            if (inline.type === "text") {
              title += inline.text ?? "";
            } else if (inline.type === "mention") {
              title += `@${(inline.attrs?.label as string) ?? ""}`;
              if (!mentionUserId && inline.attrs?.id) {
                mentionUserId = inline.attrs.id as string;
              }
            }
          }
        }
      }
    }

    result.push({
      nodeId,
      title: title.trim() || "Tâche sans titre",
      checked,
      status,
      assigneeId: explicitAssigneeId ?? mentionUserId,
    });
    return result;
  }

  if (node.content) {
    for (const child of node.content) {
      result.push(...extractTaskItems(child));
    }
  }

  return result;
}

export async function syncDocumentTasks(
  documentId: string,
  doc: JSONContent,
  createdBy: string
): Promise<void> {
  const items = extractTaskItems(doc);
  const nodeIds = items.map((i) => i.nodeId);

  // Charger toutes les tâches existantes en une seule requête
  const existingTasks = await db
    .select({ id: tasks.id, nodeId: tasks.nodeId, title: tasks.title, assigneeId: tasks.assigneeId })
    .from(tasks)
    .where(eq(tasks.documentId, documentId));

  // Réconciliation par titre : nodeIds absents = tâches dont le nodeId a changé (round-trip Markdown)
  // On restaure leur assigneeId pour éviter la perte lors d'un reload
  const staleByTitle = new Map<string, string>();
  for (const t of existingTasks) {
    if (t.assigneeId && (!t.nodeId || !nodeIds.includes(t.nodeId))) {
      staleByTitle.set(t.title, t.assigneeId);
    }
  }

  for (const item of items) {
    const existing = existingTasks.find((t) => t.nodeId === item.nodeId);
    // Priorité : assigneeId explicite > réconciliation par titre > null
    const resolvedAssigneeId = item.assigneeId ?? staleByTitle.get(item.title) ?? null;
    const isReconciled = !item.assigneeId && !!resolvedAssigneeId;

    const newStatus = item.status;

    const [upserted] = await db
      .insert(tasks)
      .values({
        kind: "document_item",
        title: item.title,
        status: newStatus,
        assigneeId: resolvedAssigneeId,
        createdBy,
        documentId,
        nodeId: item.nodeId,
      })
      .onConflictDoUpdate({
        target: [tasks.documentId, tasks.nodeId],
        set: {
          title: item.title,
          status: newStatus,
          // COALESCE : ne jamais écraser une assignation existante avec null
          // (le Markdown ne stocke pas assigneeId — empêche la perte d'assignation au rechargement)
          // L'annulation explicite passe par POST /api/tasks/unassign
          assigneeId: sql`COALESCE(EXCLUDED.assignee_id, ${tasks.assigneeId})`,
          updatedAt: new Date(),
        },
      })
      .returning({ id: tasks.id });

    // Notifier uniquement lors d'une vraie nouvelle assignation (pas une réconciliation)
    if (item.assigneeId && !isReconciled && item.assigneeId !== (existing?.assigneeId ?? null) && upserted) {
      await notifyTaskAssigned(upserted.id, item.assigneeId, createdBy);
    }
  }

  // Supprimer les tâches dont les nodes ont été retirés du document
  if (nodeIds.length > 0) {
    await db
      .delete(tasks)
      .where(
        and(
          eq(tasks.documentId, documentId),
          notInArray(tasks.nodeId, nodeIds)
        )
      );
  } else {
    await db.delete(tasks).where(eq(tasks.documentId, documentId));
  }
}
