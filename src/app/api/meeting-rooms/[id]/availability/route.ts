import { NextResponse, type NextRequest } from "next/server";
import { and, eq, gte, lte } from "drizzle-orm";
import { db } from "@/lib/db";
import { meetingRoomBookings } from "@/lib/db/schema";
import { getSessionUser } from "@/lib/auth/get-user";
import { guardMeetingRoomsEnabled } from "@/lib/meeting-rooms/guards";
import {
  canBookRoom,
  canManageRooms,
} from "@/lib/meeting-rooms/permissions";
import { getMeetingRoomForRequest } from "@/lib/meeting-rooms/scoped-room";
import { computeAvailability } from "@/lib/meeting-rooms/opening-hours";
import type { OpeningHours } from "@/types";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const blocked = await guardMeetingRoomsEnabled();
  if (blocked) return blocked;

  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "Non authentifié" }, { status: 401 });

  const { id: roomId } = await params;
  const allowed =
    canManageRooms(user.globalRole, user.capabilities) ||
    (await canBookRoom(user.id, user.globalRole, roomId, user.capabilities));
  if (!allowed) {
    return NextResponse.json({ error: "Accès refusé" }, { status: 403 });
  }

  const sp = request.nextUrl.searchParams;
  const fromParam = sp.get("from");
  const toParam = sp.get("to");
  if (!fromParam || !toParam) {
    return NextResponse.json(
      { error: "Paramètres from et to requis (ISO 8601)" },
      { status: 400 }
    );
  }
  const from = new Date(fromParam);
  const to = new Date(toParam);
  if (isNaN(from.getTime()) || isNaN(to.getTime()) || to <= from) {
    return NextResponse.json({ error: "Plage de dates invalide" }, { status: 400 });
  }

  const rangeMs = to.getTime() - from.getTime();
  if (rangeMs > 1000 * 60 * 60 * 24 * 90) {
    return NextResponse.json(
      { error: "Plage trop large (max 90 jours)" },
      { status: 400 }
    );
  }

  // Cloisonnement multi-tenant : 404 si la salle relève d'une autre org.
  const room = await getMeetingRoomForRequest(roomId, user);
  if (!room) {
    return NextResponse.json({ error: "Salle introuvable" }, { status: 404 });
  }

  const bookings = await db
    .select({
      startAt: meetingRoomBookings.startAt,
      endAt: meetingRoomBookings.endAt,
    })
    .from(meetingRoomBookings)
    .where(
      and(
        eq(meetingRoomBookings.roomId, roomId),
        eq(meetingRoomBookings.status, "confirmed"),
        gte(meetingRoomBookings.endAt, from),
        lte(meetingRoomBookings.startAt, to)
      )
    );

  const availability = computeAvailability(
    from,
    to,
    room.openingHours as OpeningHours,
    bookings
  );

  return NextResponse.json({ slots: availability });
}
