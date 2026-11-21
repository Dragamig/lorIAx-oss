import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import crypto from "crypto";
import { and, asc, eq, gte, lte } from "drizzle-orm";
import { db } from "@/lib/db";
import {
  meetingRoomBookings,
  calendarEvents,
  calendarEventAttendees,
} from "@/lib/db/schema";
import { getSessionUser } from "@/lib/auth/get-user";
import { guardMeetingRoomsEnabled } from "@/lib/meeting-rooms/guards";
import {
  canBookRoom,
  canManageRooms,
} from "@/lib/meeting-rooms/permissions";
import {
  isWithinOpeningHours,
} from "@/lib/meeting-rooms/opening-hours";
import { getOrCreateRoomsCalendar } from "@/lib/meeting-rooms/calendar-link";
import { getRequestOrgId } from "@/lib/org/get-request-org";
import { getMeetingRoomForRequest } from "@/lib/meeting-rooms/scoped-room";
import type { OpeningHours } from "@/types";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const blocked = await guardMeetingRoomsEnabled();
  if (blocked) return blocked;

  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "Non authentifié" }, { status: 401 });

  const { id } = await params;
  // Cloisonnement multi-tenant : 404 si la salle relève d'une autre org.
  if (!(await getMeetingRoomForRequest(id, user))) {
    return NextResponse.json({ error: "Salle introuvable" }, { status: 404 });
  }
  const allowed =
    canManageRooms(user.globalRole, user.capabilities) ||
    (await canBookRoom(user.id, user.globalRole, id, user.capabilities));
  if (!allowed) {
    return NextResponse.json({ error: "Accès refusé" }, { status: 403 });
  }

  const sp = request.nextUrl.searchParams;
  const fromParam = sp.get("from");
  const toParam = sp.get("to");
  const includeCancelled = sp.get("includeCancelled") === "true";

  const conditions = [eq(meetingRoomBookings.roomId, id)];
  if (!includeCancelled) {
    conditions.push(eq(meetingRoomBookings.status, "confirmed"));
  }
  if (fromParam) {
    const fromDate = new Date(fromParam);
    if (!isNaN(fromDate.getTime())) {
      conditions.push(gte(meetingRoomBookings.endAt, fromDate));
    }
  }
  if (toParam) {
    const toDate = new Date(toParam);
    if (!isNaN(toDate.getTime())) {
      conditions.push(lte(meetingRoomBookings.startAt, toDate));
    }
  }

  try {
    const rows = await db
      .select()
      .from(meetingRoomBookings)
      .where(and(...conditions))
      .orderBy(asc(meetingRoomBookings.startAt));

    return NextResponse.json(rows);
  } catch (err) {
    console.error("[GET /api/meeting-rooms/[id]/bookings]", err);
    const message = err instanceof Error ? err.message : "Erreur interne";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

const createBookingSchema = z.object({
  title: z.string().min(1).max(500),
  startAt: z.string().datetime(),
  endAt: z.string().datetime(),
  attendees: z
    .array(
      z.object({
        userId: z.string().uuid().optional(),
        email: z.string().email().optional(),
        displayName: z.string().optional(),
      })
    )
    .max(50)
    .optional(),
});

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const blocked = await guardMeetingRoomsEnabled();
  if (blocked) return blocked;

  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "Non authentifié" }, { status: 401 });

  const { id: roomId } = await params;

  const allowed = await canBookRoom(user.id, user.globalRole, roomId, user.capabilities);
  if (!allowed) {
    return NextResponse.json(
      { error: "Vous n'avez pas la permission de réserver cette salle" },
      { status: 403 }
    );
  }

  const body = await request.json();
  const parsed = createBookingSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0].message }, { status: 400 });
  }

  const startAt = new Date(parsed.data.startAt);
  const endAt = new Date(parsed.data.endAt);

  // Cloisonnement multi-tenant : 404 si la salle relève d'une autre org.
  const room = await getMeetingRoomForRequest(roomId, user);
  if (!room) {
    return NextResponse.json({ error: "Salle introuvable" }, { status: 404 });
  }
  if (!room.isActive) {
    return NextResponse.json({ error: "Salle inactive" }, { status: 400 });
  }

  const check = isWithinOpeningHours(startAt, endAt, room.openingHours as OpeningHours);
  if (!check.ok) {
    return NextResponse.json({ error: check.reason }, { status: 400 });
  }

  // Calendrier organisation des salles, confiné à l'org de la requête.
  const orgId = await getRequestOrgId(user);
  if (!orgId) {
    return NextResponse.json({ error: "Organisation introuvable" }, { status: 404 });
  }
  const calendarId = await getOrCreateRoomsCalendar(user.id, orgId);

  try {
    return await db.transaction(async (tx) => {
      const [event] = await tx
        .insert(calendarEvents)
        .values({
          calendarId,
          title: `${parsed.data.title} — ${room.name}`,
          description: `Réservation de la salle ${room.name}`,
          location: room.address ?? room.name,
          startAt,
          endAt,
          allDay: false,
          status: "confirmed",
          visibility: "public",
          uid: `${crypto.randomUUID()}@meeting-rooms.loriax`,
          meetingRoomId: roomId,
          createdBy: user.id,
        })
        .returning();

      // Attendees calendrier (organisateur + participants)
      const attendeesValues: Array<typeof calendarEventAttendees.$inferInsert> = [
        {
          eventId: event.id,
          userId: user.id,
          role: "organizer",
          status: "accepted",
        },
      ];
      for (const a of parsed.data.attendees ?? []) {
        attendeesValues.push({
          eventId: event.id,
          userId: a.userId,
          email: a.email,
          displayName: a.displayName,
          role: "required",
          status: "needs-action",
        });
      }
      if (attendeesValues.length > 0) {
        await tx.insert(calendarEventAttendees).values(attendeesValues);
      }

      const [booking] = await tx
        .insert(meetingRoomBookings)
        .values({
          roomId,
          userId: user.id,
          title: parsed.data.title,
          startAt,
          endAt,
          attendees: parsed.data.attendees ?? [],
          status: "confirmed",
          calendarEventId: event.id,
        })
        .returning();

      return NextResponse.json({ booking, event }, { status: 201 });
    });
  } catch (error) {
    // Postgres EXCLUDE constraint violation
    const code = (error as { code?: string }).code;
    if (code === "23P01") {
      return NextResponse.json(
        { error: "Créneau déjà réservé sur cette salle" },
        { status: 409 }
      );
    }
    console.error("[POST /api/meeting-rooms/[id]/bookings]", error);
    const message = error instanceof Error ? error.message : "Erreur interne";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
