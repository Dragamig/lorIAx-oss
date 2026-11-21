import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import logger from "@/lib/logger";
import { requireRowScope } from "@/lib/databases/row-route-access";
import { isEligibleUser, makeCanView } from "@/lib/databases/row-eligibility";
import { deleteRowTask, getRowTask, getRowTaskDto } from "@/lib/databases/row-tasks";
import { isUuid, notFoundResponse, readJsonBody } from "@/lib/databases/row-comment-route-utils";
import { updateTaskWithEvents, type TaskPatch } from "@/lib/tasks/update-task";
import { notifyTaskAssigned } from "@/lib/tasks/notify-task-assigned";

type Params = { params: Promise<{ databaseId: string; rowId: string; taskId: string }> };

const patchSchema = z.object({
  status: z.enum(["open", "in_progress", "done", "cancelled"]).optional(),
  assigneeId: z.string().uuid().nullable().optional(),
  dueAt: z.string().datetime().nullable().optional(),
  title: z.string().trim().min(1).max(500).optional(),
}).refine((b) => Object.values(b).some((v) => v !== undefined), { message: "Aucun champ à modifier" });

export async function PATCH(request: NextRequest, { params }: Params) {
  const { databaseId, rowId, taskId } = await params;
  const scope = await requireRowScope(request, { databaseId, rowId, min: "editor" });
  if (scope instanceof NextResponse) return scope;
  if (!isUuid(taskId)) return notFoundResponse();

  const parsed = patchSchema.safeParse(await readJsonBody(request));
  if (!parsed.success) return NextResponse.json({ error: "Tâche invalide" }, { status: 400 });
  const { status, assigneeId, dueAt, title } = parsed.data;

  const existing = await getRowTask(db, { databaseId, rowId, taskId });
  if (!existing) return notFoundResponse();

  if (assigneeId && assigneeId !== scope.userId && assigneeId !== existing.assigneeId) {
    const ok = await isEligibleUser(db, {
      orgId: scope.orgId,
      userId: assigneeId,
      canView: makeCanView(scope.spaceId),
    });
    if (!ok) {
      return NextResponse.json({ error: "Cet utilisateur n'a pas accès à cette fiche" }, { status: 422 });
    }
  }

  const patch: TaskPatch = {};
  if (status !== undefined) patch.status = status;
  if (assigneeId !== undefined) patch.assigneeId = assigneeId;
  if (dueAt !== undefined) patch.dueAt = dueAt === null ? null : new Date(dueAt);
  if (title !== undefined) patch.title = title;

  const result = await updateTaskWithEvents(db, { taskId, actorUserId: scope.userId, patch });
  if (!result) return notFoundResponse();

  const newAssignee = result.updated.assigneeId;
  if (newAssignee && newAssignee !== result.previous.assigneeId && newAssignee !== scope.userId) {
    try {
      await notifyTaskAssigned(taskId, newAssignee, scope.userId);
    } catch (err) {
      logger.error({ err, taskId }, "Notification d'assignation de tâche de ligne en échec");
    }
  }
  const dto = await getRowTaskDto(db, { databaseId, rowId, taskId });
  if (!dto) return notFoundResponse();
  return NextResponse.json({ task: dto });
}

export async function DELETE(request: NextRequest, { params }: Params) {
  const { databaseId, rowId, taskId } = await params;
  const scope = await requireRowScope(request, { databaseId, rowId, min: "editor" });
  if (scope instanceof NextResponse) return scope;
  if (!isUuid(taskId)) return notFoundResponse();

  const r = await deleteRowTask(db, {
    databaseId,
    rowId,
    taskId,
    actor: { userId: scope.userId, permission: scope.permission },
  });
  if (r === "forbidden") return NextResponse.json({ error: "Accès refusé" }, { status: 403 });
  if (r === "not_found") return notFoundResponse();
  return NextResponse.json({ deleted: true });
}
