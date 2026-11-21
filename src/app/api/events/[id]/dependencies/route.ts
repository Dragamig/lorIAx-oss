// src/app/api/events/[id]/dependencies/route.ts
import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { eventDependencies, calendarEvents } from "@/lib/db/schema";
import { eq, inArray } from "drizzle-orm";
import { getSessionUser } from "@/lib/auth/get-user";
import { checkCalendarAccess } from "@/lib/calendar/permissions";
import { getRequestOrgId } from "@/lib/org/get-request-org";
import { z } from "zod";
import { detectCycleFromEdges } from "@/components/gantt/gantt-utils";

const addDepSchema = z.object({ targetEventId: z.string().uuid() });

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "Non authentifié" }, { status: 401 });
  const { id: sourceEventId } = await params;
  const body = await req.json();
  const parsed = addDepSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0].message }, { status: 400 });
  const { targetEventId } = parsed.data;
  if (sourceEventId === targetEventId) return NextResponse.json({ error: "Un événement ne peut pas dépendre de lui-même" }, { status: 422 });

  const sourceEvent = await db.select({ calendarId: calendarEvents.calendarId })
    .from(calendarEvents).where(eq(calendarEvents.id, sourceEventId));
  if (!sourceEvent[0]) return NextResponse.json({ error: "Événement introuvable" }, { status: 404 });

  // Cloisonnement : écrire une dépendance modifie l'agenda source, il faut donc
  // un droit d'écriture sur son calendrier (et non la seule authentification).
  const calendarId = sourceEvent[0].calendarId;
  const hasAccess = await checkCalendarAccess(user.id, calendarId, "write", await getRequestOrgId(user));
  if (!hasAccess) return NextResponse.json({ error: "Accès refusé" }, { status: 403 });

  // L'événement cible est fourni par le client : il doit appartenir au même
  // calendrier, sinon un UUID forgé lierait un événement d'une autre org.
  const calEvents = await db.select({ id: calendarEvents.id })
    .from(calendarEvents).where(eq(calendarEvents.calendarId, calendarId));
  const calEventIds = calEvents.map((e) => e.id);
  if (!calEventIds.includes(targetEventId)) {
    return NextResponse.json({ error: "Événement cible introuvable dans ce calendrier" }, { status: 404 });
  }

  const existingDeps = calEventIds.length > 0
    ? await db.select().from(eventDependencies).where(inArray(eventDependencies.sourceEventId, calEventIds))
    : [];
  const hasCycle = detectCycleFromEdges(
    existingDeps.map((d) => ({ sourceEventId: d.sourceEventId, targetEventId: d.targetEventId })),
    sourceEventId, targetEventId
  );
  if (hasCycle) return NextResponse.json({ error: "Dépendance circulaire détectée" }, { status: 422 });

  try {
    const [dep] = await db.insert(eventDependencies).values({ sourceEventId, targetEventId }).returning();
    return NextResponse.json(dep, { status: 201 });
  } catch (err: unknown) {
    if ((err as { code?: string }).code === "23505") return NextResponse.json({ error: "Cette dépendance existe déjà" }, { status: 409 });
    throw err;
  }
}
