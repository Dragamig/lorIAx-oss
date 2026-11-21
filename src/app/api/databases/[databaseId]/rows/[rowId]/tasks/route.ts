import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { requireRowScope } from "@/lib/databases/row-route-access";
import { findRowById } from "@/lib/databases/row-writes";
import { isEligibleUser, makeCanView } from "@/lib/databases/row-eligibility";
import { countOpenRowTasks, getRowTaskDto, listRowTasks } from "@/lib/databases/row-tasks";
import { notFoundResponse, readJsonBody } from "@/lib/databases/row-comment-route-utils";
import { createTask } from "@/lib/tasks/create-task";

type Params = { params: Promise<{ databaseId: string; rowId: string }> };

const createSchema = z.object({
  title: z.string().trim().min(1).max(500),
  assigneeId: z.string().uuid().nullable().optional(),
  dueAt: z.string().datetime().nullable().optional(),
});

export async function GET(request: NextRequest, { params }: Params) {
  const { databaseId, rowId } = await params;
  const scope = await requireRowScope(request, { databaseId, rowId, min: "viewer" });
  if (scope instanceof NextResponse) return scope;

  const [tasks, openCount] = await Promise.all([
    listRowTasks(db, { databaseId, rowId }),
    countOpenRowTasks(db, { databaseId, rowId }),
  ]);
  return NextResponse.json({ tasks, openCount, permission: scope.permission });
}

export async function POST(request: NextRequest, { params }: Params) {
  const { databaseId, rowId } = await params;
  const scope = await requireRowScope(request, { databaseId, rowId, min: "editor" });
  if (scope instanceof NextResponse) return scope;

  const row = await findRowById(databaseId, rowId);
  if (!row) return notFoundResponse();

  const parsed = createSchema.safeParse(await readJsonBody(request));
  if (!parsed.success) return NextResponse.json({ error: "Tâche invalide" }, { status: 400 });
  const { title, assigneeId, dueAt } = parsed.data;

  if (assigneeId && assigneeId !== scope.userId) {
    const ok = await isEligibleUser(db, {
      orgId: scope.orgId,
      userId: assigneeId,
      canView: makeCanView(scope.spaceId),
    });
    if (!ok) {
      return NextResponse.json({ error: "Cet utilisateur n'a pas accès à cette fiche" }, { status: 422 });
    }
  }

  // createTask écrit la tâche et son événement en une transaction, puis notifie l'assigné.
  const created = await createTask({
    kind: "database_row",
    title,
    createdBy: scope.userId,
    assigneeId: assigneeId ?? null,
    dueAt: dueAt ? new Date(dueAt) : null,
    databaseId,
    rowId,
  });
  const dto = await getRowTaskDto(db, { databaseId, rowId, taskId: created.id });
  return NextResponse.json({ task: dto }, { status: 201 });
}
