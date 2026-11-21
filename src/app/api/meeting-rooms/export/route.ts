import { NextResponse, type NextRequest } from "next/server";
import { db } from "@/lib/db";
import { meetingRoomBookings, meetingRooms, users } from "@/lib/db/schema";
import { and, asc, eq, gte, lte } from "drizzle-orm";
import { getSessionUser } from "@/lib/auth/get-user";
import { getRequestOrgId } from "@/lib/org/get-request-org";
import { guardMeetingRoomsEnabled } from "@/lib/meeting-rooms/guards";
import { canManageRooms } from "@/lib/meeting-rooms/permissions";

function csvEscape(value: unknown): string {
  if (value === null || value === undefined) return "";
  const s = String(value);
  if (s.includes(",") || s.includes('"') || s.includes("\n") || s.includes(";")) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

export async function GET(request: NextRequest) {
  const blocked = await guardMeetingRoomsEnabled();
  if (blocked) return blocked;

  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "Non authentifié" }, { status: 401 });
  if (!canManageRooms(user.globalRole, user.capabilities)) {
    return NextResponse.json({ error: "Accès refusé" }, { status: 403 });
  }

  // Cloisonnement multi-tenant : n'exporter que les réservations des salles de
  // l'org courante (vaut aussi pour les admins).
  const orgId = await getRequestOrgId(user);
  if (!orgId) {
    return NextResponse.json({ error: "Organisation introuvable" }, { status: 403 });
  }

  const sp = request.nextUrl.searchParams;
  const fromParam = sp.get("from");
  const toParam = sp.get("to");

  const to = toParam ? new Date(toParam) : new Date();
  const from = fromParam
    ? new Date(fromParam)
    : new Date(to.getTime() - 30 * 24 * 60 * 60 * 1000);

  if (isNaN(from.getTime()) || isNaN(to.getTime()) || to <= from) {
    return NextResponse.json({ error: "Plage invalide" }, { status: 400 });
  }

  const rows = await db
    .select({
      bookingId: meetingRoomBookings.id,
      title: meetingRoomBookings.title,
      startAt: meetingRoomBookings.startAt,
      endAt: meetingRoomBookings.endAt,
      status: meetingRoomBookings.status,
      roomName: meetingRooms.name,
      roomAddress: meetingRooms.address,
      userName: users.name,
      userEmail: users.email,
      attendeesCount: meetingRoomBookings.attendees,
      createdAt: meetingRoomBookings.createdAt,
    })
    .from(meetingRoomBookings)
    .innerJoin(meetingRooms, eq(meetingRoomBookings.roomId, meetingRooms.id))
    .innerJoin(users, eq(meetingRoomBookings.userId, users.id))
    .where(
      and(
        eq(meetingRooms.organizationId, orgId),
        gte(meetingRoomBookings.startAt, from),
        lte(meetingRoomBookings.startAt, to)
      )
    )
    .orderBy(asc(meetingRoomBookings.startAt));

  const header = [
    "Réservation",
    "Titre",
    "Salle",
    "Adresse",
    "Début",
    "Fin",
    "Durée (min)",
    "Statut",
    "Auteur",
    "Email auteur",
    "Participants",
    "Créée le",
  ];

  const lines: string[] = [header.map(csvEscape).join(",")];
  for (const r of rows) {
    const start = new Date(r.startAt);
    const end = new Date(r.endAt);
    const durationMin = Math.round((end.getTime() - start.getTime()) / 60000);
    const attendees = Array.isArray(r.attendeesCount)
      ? (r.attendeesCount as Array<{ email?: string; displayName?: string }>).length
      : 0;
    lines.push(
      [
        r.bookingId,
        r.title,
        r.roomName,
        r.roomAddress ?? "",
        start.toISOString(),
        end.toISOString(),
        durationMin,
        r.status,
        r.userName,
        r.userEmail,
        attendees,
        new Date(r.createdAt).toISOString(),
      ]
        .map(csvEscape)
        .join(",")
    );
  }

  // BOM UTF-8 pour qu'Excel reconnaisse les accents
  const csv = "﻿" + lines.join("\n");

  const filename = `salles-reservations-${from.toISOString().slice(0, 10)}_${to.toISOString().slice(0, 10)}.csv`;
  return new NextResponse(csv, {
    status: 200,
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${filename}"`,
    },
  });
}
