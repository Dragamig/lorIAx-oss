import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { tasks, userDatabases, spaces } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import logger from "@/lib/logger";
import { getSpacePermission } from "@/lib/auth/check-access";
import { isOrgMember } from "@/lib/org/resolve-request-org";
import { getSessionUser } from "@/lib/auth/get-user";
import { notifyTaskAssigned } from "@/lib/tasks/notify-task-assigned";
import { updateTaskWithEvents, type TaskPatch } from "@/lib/tasks/update-task";
import { isEligibleUser, makeCanView } from "@/lib/databases/row-eligibility";
import { recordOnboardingEvent } from "@/lib/onboarding/progress";

const schema = z.object({
  status: z.enum(["open", "in_progress", "done", "cancelled"]).optional(),
  assigneeId: z.string().uuid().nullable().optional(),
  dueAt: z.string().datetime().nullable().optional(),
});

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "Non authentifié" }, { status: 401 });

  const { id } = await params;
  const body = await request.json().catch(() => null);
  if (!body) return NextResponse.json({ error: "Corps invalide" }, { status: 400 });

  const parsed = schema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: "Données invalides" }, { status: 400 });

  const [task] = await db
    .select()
    .from(tasks)
    .where(eq(tasks.id, id))
    .limit(1);

  if (!task) return NextResponse.json({ error: "Tâche introuvable" }, { status: 404 });

  if (task.assigneeId !== user.id && task.createdBy !== user.id) {
    return NextResponse.json({ error: "Accès refusé" }, { status: 403 });
  }

  const assigneeChanged =
    parsed.data.assigneeId !== undefined &&
    parsed.data.assigneeId !== null &&
    parsed.data.assigneeId !== task.assigneeId;

  let updated;
  if (task.kind === "database_row") {
    // Perimetre lu en base, jamais du client.
    const [scope] = task.databaseId
      ? await db
          .select({ spaceId: userDatabases.spaceId, orgId: spaces.organizationId })
          .from(userDatabases)
          .innerJoin(spaces, eq(spaces.id, userDatabases.spaceId))
          .where(eq(userDatabases.id, task.databaseId))
          .limit(1)
      : [];

    // Tout changement autre que le statut exige d'etre membre de l'organisation de la base ET editeur de
    // son espace. L'assigne garde seulement le droit de cocher sa tache sans acces a l'espace ; un
    // createur qui a perdu l'acces ne peut plus rien changer. 404 muet dans tous les cas refuses.
    const statusOnly =
      parsed.data.assigneeId === undefined && parsed.data.dueAt === undefined;
    let canEdit = false;
    if (scope && (await isOrgMember(user.id, scope.orgId))) {
      const perm = await getSpacePermission(user.id, scope.spaceId);
      canEdit = perm === "editor" || perm === "admin";
    }
    if (!canEdit && !(statusOnly && task.assigneeId === user.id)) {
      return NextResponse.json({ error: "Tâche introuvable" }, { status: 404 });
    }

    // L'assigne doit pouvoir voir l'espace de la base.
    if (assigneeChanged) {
      const eligible =
        !!scope &&
        (await isEligibleUser(db, {
          orgId: scope.orgId,
          userId: parsed.data.assigneeId as string,
          canView: makeCanView(scope.spaceId),
        }));
      if (!eligible) {
        return NextResponse.json({ error: "Assignation impossible" }, { status: 422 });
      }
    }
    const patch: TaskPatch = {};
    if (parsed.data.status !== undefined) patch.status = parsed.data.status;
    if (parsed.data.assigneeId !== undefined) patch.assigneeId = parsed.data.assigneeId;
    if (parsed.data.dueAt !== undefined)
      patch.dueAt = parsed.data.dueAt ? new Date(parsed.data.dueAt) : null;
    const result = await updateTaskWithEvents(db, { taskId: id, actorUserId: user.id, patch });
    if (!result) return NextResponse.json({ error: "Tâche introuvable" }, { status: 404 });
    updated = result.updated;
  } else {
    const updates: Record<string, unknown> = { updatedAt: new Date() };
    if (parsed.data.status !== undefined) updates.status = parsed.data.status;
    if (parsed.data.assigneeId !== undefined) updates.assigneeId = parsed.data.assigneeId;
    if (parsed.data.dueAt !== undefined)
      updates.dueAt = parsed.data.dueAt ? new Date(parsed.data.dueAt) : null;
    [updated] = await db.update(tasks).set(updates).where(eq(tasks.id, id)).returning();
  }

  if (
    parsed.data.assigneeId &&
    parsed.data.assigneeId !== task.assigneeId &&
    parsed.data.assigneeId !== user.id
  ) {
    try {
      await notifyTaskAssigned(id, parsed.data.assigneeId, user.id);
    } catch (err) {
      logger.error({ err, taskId: id }, "[tasks] notification d'assignation impossible");
    }
  }

  // Onboarding : badge « Première tâche suivie » au 1er changement de statut réel.
  if (parsed.data.status !== undefined && parsed.data.status !== task.status) {
    recordOnboardingEvent(user.id, "tasks").catch(() => {});
  }

  return NextResponse.json(updated);
}
