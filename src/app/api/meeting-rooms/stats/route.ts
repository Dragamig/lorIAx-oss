import { NextResponse, type NextRequest } from "next/server";
import { db } from "@/lib/db";
import { meetingRoomBookings, meetingRooms, users } from "@/lib/db/schema";
import { and, eq, gte, lte, sql, asc, inArray } from "drizzle-orm";
import { getSessionUser } from "@/lib/auth/get-user";
import { getRequestOrgId } from "@/lib/org/get-request-org";
import { guardMeetingRoomsEnabled } from "@/lib/meeting-rooms/guards";
import { canManageRooms } from "@/lib/meeting-rooms/permissions";

interface RoomOccupancy {
  roomId: string;
  roomName: string;
  bookingsCount: number;
  totalMinutes: number;
}

interface TopUser {
  userId: string;
  name: string;
  bookingsCount: number;
}

export async function GET(request: NextRequest) {
  const blocked = await guardMeetingRoomsEnabled();
  if (blocked) return blocked;

  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "Non authentifié" }, { status: 401 });
  if (!canManageRooms(user.globalRole, user.capabilities)) {
    return NextResponse.json({ error: "Accès refusé" }, { status: 403 });
  }

  // Cloisonnement multi-tenant : statistiques restreintes aux salles de l'org
  // courante (admins inclus). On résout l'ensemble des salles de l'org et on
  // borne toutes les agrégations à ces salles.
  const orgId = await getRequestOrgId(user);
  if (!orgId) {
    return NextResponse.json({ error: "Organisation introuvable" }, { status: 403 });
  }
  const orgRooms = await db
    .select({ id: meetingRooms.id })
    .from(meetingRooms)
    .where(eq(meetingRooms.organizationId, orgId));
  const orgRoomIds = orgRooms.map((r) => r.id);

  const sp = request.nextUrl.searchParams;
  const period = sp.get("period") === "30d" ? 30 : 7;

  const to = new Date();
  const from = new Date(to.getTime() - period * 24 * 60 * 60 * 1000);

  if (orgRoomIds.length === 0) {
    return NextResponse.json({
      period,
      from: from.toISOString(),
      to: to.toISOString(),
      occupancy: [],
      topUsers: [],
      hourlyDistribution: [],
    });
  }

  // Occupation par salle
  const perRoom = await db
    .select({
      roomId: meetingRoomBookings.roomId,
      roomName: meetingRooms.name,
      bookingsCount: sql<number>`COUNT(*)`.as("bookings_count"),
      totalMinutes: sql<number>`COALESCE(SUM(EXTRACT(EPOCH FROM (${meetingRoomBookings.endAt} - ${meetingRoomBookings.startAt})) / 60), 0)`.as("total_minutes"),
    })
    .from(meetingRoomBookings)
    .innerJoin(meetingRooms, eq(meetingRoomBookings.roomId, meetingRooms.id))
    .where(
      and(
        inArray(meetingRoomBookings.roomId, orgRoomIds),
        eq(meetingRoomBookings.status, "confirmed"),
        gte(meetingRoomBookings.startAt, from),
        lte(meetingRoomBookings.startAt, to)
      )
    )
    .groupBy(meetingRoomBookings.roomId, meetingRooms.name)
    .orderBy(asc(meetingRooms.name));

  const occupancy: RoomOccupancy[] = perRoom.map((r) => ({
    roomId: r.roomId,
    roomName: r.roomName,
    bookingsCount: Number(r.bookingsCount),
    totalMinutes: Math.round(Number(r.totalMinutes)),
  }));

  // Top 5 utilisateurs
  const topRows = await db
    .select({
      userId: meetingRoomBookings.userId,
      name: users.name,
      bookingsCount: sql<number>`COUNT(*)`.as("bookings_count"),
    })
    .from(meetingRoomBookings)
    .innerJoin(users, eq(meetingRoomBookings.userId, users.id))
    .where(
      and(
        inArray(meetingRoomBookings.roomId, orgRoomIds),
        eq(meetingRoomBookings.status, "confirmed"),
        gte(meetingRoomBookings.startAt, from),
        lte(meetingRoomBookings.startAt, to)
      )
    )
    .groupBy(meetingRoomBookings.userId, users.name)
    .orderBy(sql`COUNT(*) DESC`)
    .limit(5);

  const topUsers: TopUser[] = topRows.map((r) => ({
    userId: r.userId,
    name: r.name,
    bookingsCount: Number(r.bookingsCount),
  }));

  // Heures les plus demandées (0-23)
  const hourRows = await db
    .select({
      hour: sql<number>`EXTRACT(HOUR FROM ${meetingRoomBookings.startAt})`.as("hour"),
      count: sql<number>`COUNT(*)`.as("count"),
    })
    .from(meetingRoomBookings)
    .where(
      and(
        inArray(meetingRoomBookings.roomId, orgRoomIds),
        eq(meetingRoomBookings.status, "confirmed"),
        gte(meetingRoomBookings.startAt, from),
        lte(meetingRoomBookings.startAt, to)
      )
    )
    .groupBy(sql`EXTRACT(HOUR FROM ${meetingRoomBookings.startAt})`)
    .orderBy(sql`hour ASC`);

  const hourlyDistribution: { hour: number; count: number }[] = hourRows.map((r) => ({
    hour: Number(r.hour),
    count: Number(r.count),
  }));

  return NextResponse.json({
    period,
    from: from.toISOString(),
    to: to.toISOString(),
    occupancy,
    topUsers,
    hourlyDistribution,
  });
}
