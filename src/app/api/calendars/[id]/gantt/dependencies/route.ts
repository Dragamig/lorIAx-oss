import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { eventDependencies, calendarEvents } from "@/lib/db/schema";
import { eq, and, inArray } from "drizzle-orm";
import { getSessionUser } from "@/lib/auth/get-user";
import { checkCalendarAccess } from "@/lib/calendar/permissions";
import { getRequestOrgId } from "@/lib/org/get-request-org";
import { z } from "zod";

const depSchema = z.object({
  sourceEventId: z.string().uuid(),
  targetEventId: z.string().uuid(),
});

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "Non authentifié" }, { status: 401 });

  const { id: calendarId } = await params;
  const hasAccess = await checkCalendarAccess(user.id, calendarId, "write", await getRequestOrgId(user));
  if (!hasAccess) return NextResponse.json({ error: "Accès refusé" }, { status: 403 });

  const body = await req.json();
  const parsed = depSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0].message }, { status: 400 });
  }

  const { sourceEventId, targetEventId } = parsed.data;
  if (sourceEventId === targetEventId) {
    return NextResponse.json({ error: "Un événement ne peut pas dépendre de lui-même" }, { status: 422 });
  }

  // Verify both events belong to this calendar
  const bothEvents = await db.select({ id: calendarEvents.id })
    .from(calendarEvents)
    .where(
      and(
        eq(calendarEvents.calendarId, calendarId),
        inArray(calendarEvents.id, [sourceEventId, targetEventId])
      )
    );
  if (bothEvents.length !== 2) {
    return NextResponse.json({ error: "Événements introuvables dans ce calendrier" }, { status: 404 });
  }

  try {
    const [dep] = await db
      .insert(eventDependencies)
      .values({ sourceEventId, targetEventId })
      .returning();
    return NextResponse.json(dep, { status: 201 });
  } catch (err: unknown) {
    if (err && typeof err === "object" && "code" in err && err.code === "23505") {
      return NextResponse.json({ error: "Cette dépendance existe déjà" }, { status: 409 });
    }
    throw err;
  }
}

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "Non authentifié" }, { status: 401 });

  const { id: calendarId } = await params;
  const hasAccess = await checkCalendarAccess(user.id, calendarId, "write", await getRequestOrgId(user));
  if (!hasAccess) return NextResponse.json({ error: "Accès refusé" }, { status: 403 });

  const body = await req.json();
  const parsed = depSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0].message }, { status: 400 });
  }

  const { sourceEventId, targetEventId } = parsed.data;

  // Les deux identifiants viennent du client : sans cette vérification, un droit
  // d'écriture sur un calendrier quelconque suffisait à supprimer la dépendance
  // d'un autre calendrier (autre espace, autre organisation).
  const bothEvents = await db.select({ id: calendarEvents.id })
    .from(calendarEvents)
    .where(
      and(
        eq(calendarEvents.calendarId, calendarId),
        inArray(calendarEvents.id, [sourceEventId, targetEventId])
      )
    );
  if (bothEvents.length !== 2) {
    return NextResponse.json({ error: "Événements introuvables dans ce calendrier" }, { status: 404 });
  }

  await db.delete(eventDependencies).where(
    and(
      eq(eventDependencies.sourceEventId, sourceEventId),
      eq(eventDependencies.targetEventId, targetEventId)
    )
  );

  return NextResponse.json({ ok: true });
}
