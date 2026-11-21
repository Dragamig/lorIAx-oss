// src/app/api/events/[id]/dependencies/[depId]/route.ts
import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { eventDependencies, calendarEvents } from "@/lib/db/schema";
import { eq, and } from "drizzle-orm";
import { getSessionUser } from "@/lib/auth/get-user";
import { checkCalendarAccess } from "@/lib/calendar/permissions";
import { getRequestOrgId } from "@/lib/org/get-request-org";

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string; depId: string }> }
) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "Non authentifié" }, { status: 401 });
  const { id: sourceEventId, depId } = await params;

  // L'identifiant de dépendance vient du client : sans ces contrôles, n'importe
  // quel compte authentifié pouvait supprimer une dépendance d'une autre
  // organisation en devinant/forgeant un UUID.
  const [dep] = await db
    .select({ sourceEventId: eventDependencies.sourceEventId })
    .from(eventDependencies)
    .where(and(eq(eventDependencies.id, depId), eq(eventDependencies.sourceEventId, sourceEventId)))
    .limit(1);
  if (!dep) return NextResponse.json({ error: "Dépendance introuvable" }, { status: 404 });

  const [event] = await db
    .select({ calendarId: calendarEvents.calendarId })
    .from(calendarEvents)
    .where(eq(calendarEvents.id, dep.sourceEventId))
    .limit(1);
  if (!event) return NextResponse.json({ error: "Événement introuvable" }, { status: 404 });

  const hasAccess = await checkCalendarAccess(user.id, event.calendarId, "write", await getRequestOrgId(user));
  if (!hasAccess) return NextResponse.json({ error: "Accès refusé" }, { status: 403 });

  await db.delete(eventDependencies).where(eq(eventDependencies.id, depId));
  return NextResponse.json({ ok: true });
}
