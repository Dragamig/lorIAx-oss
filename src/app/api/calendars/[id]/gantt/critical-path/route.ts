import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { calendarEvents, eventDependencies } from "@/lib/db/schema";
import { eq, inArray, or } from "drizzle-orm";
import { getSessionUser } from "@/lib/auth/get-user";
import { checkCalendarAccess } from "@/lib/calendar/permissions";
import { getRequestOrgId } from "@/lib/org/get-request-org";
import { calculateCriticalPath } from "@/components/gantt/gantt-utils";

export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "Non authentifié" }, { status: 401 });

  const { id: calendarId } = await params;
  const hasAccess = await checkCalendarAccess(user.id, calendarId, "read", await getRequestOrgId(user));
  if (!hasAccess) return NextResponse.json({ error: "Accès refusé" }, { status: 403 });

  const events = await db
    .select()
    .from(calendarEvents)
    .where(eq(calendarEvents.calendarId, calendarId));

  const eventIds = events.map((e) => e.id);
  let deps: { sourceEventId: string; targetEventId: string }[] = [];
  if (eventIds.length > 0) {
    deps = await db
      .select({
        sourceEventId: eventDependencies.sourceEventId,
        targetEventId: eventDependencies.targetEventId,
      })
      .from(eventDependencies)
      .where(
        or(
          inArray(eventDependencies.sourceEventId, eventIds),
          inArray(eventDependencies.targetEventId, eventIds)
        )
      );
  }

  // Build dependencies map: targetEventId → sourceEventId[]
  const depsMap = new Map<string, string[]>();
  for (const d of deps) {
    const arr = depsMap.get(d.targetEventId) || [];
    arr.push(d.sourceEventId);
    depsMap.set(d.targetEventId, arr);
  }

  const ganttEvents = events.map((e) => ({
    id: e.id,
    title: e.title,
    startAt: e.startAt.toISOString(),
    endAt: e.endAt.toISOString(),
    progress: e.progress,
    color: e.color || "#3b82f6",
    parentEventId: e.parentEventId,
    allDay: e.allDay,
    dependencies: depsMap.get(e.id) || [],
  }));

  const criticalPath = calculateCriticalPath(ganttEvents);
  return NextResponse.json({ criticalPath });
}
