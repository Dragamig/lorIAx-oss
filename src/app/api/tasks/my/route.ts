import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { tasks, documents, spaces, calendarEvents, userDatabases } from "@/lib/db/schema";
import { alias } from "drizzle-orm/pg-core";
import { getRequestOrgId } from "@/lib/org/get-request-org";
import { getSpacePermission } from "@/lib/auth/check-access";
import { eq, and, or, isNull, inArray, asc } from "drizzle-orm";
import { getSessionUser } from "@/lib/auth/get-user";

// Espace de la base d'une tâche de ligne (alias distinct de celui des documents).
const dbSpaces = alias(spaces, "db_spaces");

export async function GET() {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "Non authentifié" }, { status: 401 });

  const myTasks = await db
    .select({
      id: tasks.id,
      kind: tasks.kind,
      title: tasks.title,
      status: tasks.status,
      dueAt: tasks.dueAt,
      documentId: tasks.documentId,
      calendarEventId: tasks.calendarEventId,
      createdAt: tasks.createdAt,
      updatedAt: tasks.updatedAt,
      documentTitle: documents.title,
      spaceSlug: spaces.slug,
      eventTitle: calendarEvents.title,
      databaseId: tasks.databaseId,
      rowId: tasks.rowId,
      databaseName: userDatabases.name,
      rowSpaceId: userDatabases.spaceId,
      rowOrganizationId: dbSpaces.organizationId,
      rowSpaceSlug: dbSpaces.slug,
    })
    .from(tasks)
    .leftJoin(documents, eq(tasks.documentId, documents.id))
    .leftJoin(spaces, eq(documents.spaceId, spaces.id))
    .leftJoin(calendarEvents, eq(tasks.calendarEventId, calendarEvents.id))
    .leftJoin(userDatabases, eq(tasks.databaseId, userDatabases.id))
    .leftJoin(dbSpaces, eq(userDatabases.spaceId, dbSpaces.id))
    .where(
      and(
        or(
          eq(tasks.assigneeId, user.id),
          and(eq(tasks.createdBy, user.id), isNull(tasks.assigneeId))
        ),
        inArray(tasks.status, ["open", "in_progress", "done", "cancelled"])
      )
    )
    .orderBy(tasks.status, asc(tasks.dueAt));

  // Tâches de ligne : une seule vérification par espace distinct (getSpacePermission
  // est le seul juge). Sans viewer, ou base d'une autre organisation, la tâche
  // reste visible (elle est assignée à l'appelant) avec un contexte masqué.
  const orgId = await getRequestOrgId(user);
  const spaceIds = new Set<string>();
  for (const t of myTasks) {
    if (t.kind === "database_row" && t.rowSpaceId && orgId && t.rowOrganizationId === orgId) {
      spaceIds.add(t.rowSpaceId);
    }
  }
  const permissions = new Map<string, boolean>();
  await Promise.all(
    [...spaceIds].map(async (spaceId) => {
      const perm = await getSpacePermission(user.id, spaceId);
      permissions.set(spaceId, perm !== null);
    })
  );

  const baseUrl =
    process.env.NEXTAUTH_URL || process.env.NEXT_PUBLIC_APP_URL || "";

  return NextResponse.json({
    tasks: myTasks.map((t) => {
      const isRow = t.kind === "database_row";
      const rowAllowed =
        isRow &&
        !!t.databaseId &&
        !!t.rowId &&
        !!t.rowSpaceId &&
        !!orgId &&
        t.rowOrganizationId === orgId &&
        permissions.get(t.rowSpaceId) === true;
      return {
      id: t.id,
      kind: t.kind,
      title: t.title,
      status: t.status,
      dueAt: t.dueAt?.toISOString() ?? null,
      documentId: t.documentId,
      calendarEventId: t.calendarEventId,
      documentTitle: t.documentTitle ?? null,
      eventTitle: t.eventTitle ?? null,
      documentUrl: t.documentId && t.spaceSlug ? `${baseUrl}/s/${t.spaceSlug}/${t.documentId}` : null,
      ganttUrl: t.calendarEventId ? `${baseUrl}/calendar` : null,
      createdAt: t.createdAt.toISOString(),
      updatedAt: t.updatedAt.toISOString(),
      databaseId: rowAllowed ? t.databaseId : null,
      rowId: rowAllowed ? t.rowId : null,
      spaceSlug: rowAllowed ? t.rowSpaceSlug ?? null : null,
      databaseName: rowAllowed ? t.databaseName ?? null : null,
      rowLink: rowAllowed ? `/bases/${t.databaseId}?row=${t.rowId}` : null,
      restricted: isRow && !rowAllowed,
      };
    }),
  });
}
