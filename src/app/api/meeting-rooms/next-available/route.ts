import { NextResponse } from "next/server";
import { and, eq, gte, inArray, lte } from "drizzle-orm";
import { db } from "@/lib/db";
import { meetingRoomBookings, meetingRooms } from "@/lib/db/schema";
import { getSessionUser } from "@/lib/auth/get-user";
import { getRequestOrgId } from "@/lib/org/get-request-org";
import { guardMeetingRoomsEnabled } from "@/lib/meeting-rooms/guards";
import { listBookableRoomIds } from "@/lib/meeting-rooms/permissions";
import { computeAvailability } from "@/lib/meeting-rooms/opening-hours";
import type { OpeningHours } from "@/types";

/**
 * Renvoie pour chaque salle accessible le prochain créneau libre
 * (sur les 14 prochains jours). Optimisé pour l'affichage dans la
 * liste des salles : 1 seul appel BDD pour tous les bookings.
 */
export async function GET() {
  const blocked = await guardMeetingRoomsEnabled();
  if (blocked) return blocked;

  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "Non authentifié" }, { status: 401 });

  // Cloisonnement multi-tenant : restreindre à l'org courante (admins inclus).
  const orgId = await getRequestOrgId(user);
  if (!orgId) return NextResponse.json({});

  const allowed = await listBookableRoomIds(user.id, user.globalRole, user.capabilities);

  let rooms;
  if (allowed === "all") {
    rooms = await db
      .select()
      .from(meetingRooms)
      .where(
        and(eq(meetingRooms.isActive, true), eq(meetingRooms.organizationId, orgId))
      );
  } else if (allowed.length === 0) {
    return NextResponse.json({});
  } else {
    rooms = await db
      .select()
      .from(meetingRooms)
      .where(
        and(
          eq(meetingRooms.isActive, true),
          eq(meetingRooms.organizationId, orgId),
          inArray(meetingRooms.id, allowed)
        )
      );
  }

  if (rooms.length === 0) {
    return NextResponse.json({});
  }

  const from = new Date();
  const to = new Date(from.getTime() + 14 * 24 * 60 * 60 * 1000);

  const bookings = await db
    .select({
      roomId: meetingRoomBookings.roomId,
      startAt: meetingRoomBookings.startAt,
      endAt: meetingRoomBookings.endAt,
    })
    .from(meetingRoomBookings)
    .where(
      and(
        inArray(
          meetingRoomBookings.roomId,
          rooms.map((r) => r.id)
        ),
        eq(meetingRoomBookings.status, "confirmed"),
        gte(meetingRoomBookings.endAt, from),
        lte(meetingRoomBookings.startAt, to)
      )
    );

  const result: Record<string, { start: string; end: string } | null> = {};
  for (const room of rooms) {
    const roomBookings = bookings.filter((b) => b.roomId === room.id);
    const slots = computeAvailability(
      from,
      to,
      room.openingHours as OpeningHours,
      roomBookings
    );
    result[room.id] = slots[0] ?? null;
  }

  return NextResponse.json(result);
}
