import { NextResponse, type NextRequest } from "next/server";
import { db } from "@/lib/db";
import {
  calendarEvents,
  meetingRoomBookings,
  meetingRooms,
  notifications,
  users,
} from "@/lib/db/schema";
import { and, eq, inArray } from "drizzle-orm";
import { getSessionUser } from "@/lib/auth/get-user";
import { guardMeetingRoomsEnabled } from "@/lib/meeting-rooms/guards";
import { canManageRooms } from "@/lib/meeting-rooms/permissions";
import { getMeetingRoomForRequest } from "@/lib/meeting-rooms/scoped-room";
import type { BookingAttendee } from "@/types";

export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string; bookingId: string }> }
) {
  const blocked = await guardMeetingRoomsEnabled();
  if (blocked) return blocked;

  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "Non authentifié" }, { status: 401 });

  const { id: roomId, bookingId } = await params;

  // Cloisonnement multi-tenant : 404 si la salle relève d'une autre org.
  if (!(await getMeetingRoomForRequest(roomId, user))) {
    return NextResponse.json({ error: "Réservation introuvable" }, { status: 404 });
  }

  const rows = await db
    .select()
    .from(meetingRoomBookings)
    .where(
      and(
        eq(meetingRoomBookings.id, bookingId),
        eq(meetingRoomBookings.roomId, roomId)
      )
    )
    .limit(1);

  if (rows.length === 0) {
    return NextResponse.json({ error: "Réservation introuvable" }, { status: 404 });
  }
  const booking = rows[0];

  // L'auteur ou un facility manager / admin peut annuler
  const isOwner = booking.userId === user.id;
  if (!isOwner && !canManageRooms(user.globalRole, user.capabilities)) {
    return NextResponse.json({ error: "Accès refusé" }, { status: 403 });
  }

  // Récupère le nom de la salle pour le message de notification
  const roomRows = await db
    .select({ name: meetingRooms.name })
    .from(meetingRooms)
    .where(eq(meetingRooms.id, roomId))
    .limit(1);
  const roomName = roomRows[0]?.name ?? "la salle";

  await db.transaction(async (tx) => {
    await tx
      .update(meetingRoomBookings)
      .set({ status: "cancelled", updatedAt: new Date() })
      .where(eq(meetingRoomBookings.id, bookingId));

    if (booking.calendarEventId) {
      await tx
        .delete(calendarEvents)
        .where(eq(calendarEvents.id, booking.calendarEventId));
    }

    // Notifications participants (best-effort dans la transaction)
    const attendees = Array.isArray(booking.attendees) ? booking.attendees : [];
    const userIds = new Set<string>([booking.userId]);
    for (const a of attendees) {
      if (a.userId) userIds.add(a.userId);
    }
    // Résolution emails → user IDs
    const emails = attendees
      .map((a) => a.email)
      .filter((e): e is string => typeof e === "string");
    if (emails.length > 0) {
      const matched = await tx
        .select({ id: users.id })
        .from(users)
        .where(inArray(users.email, emails));
      for (const m of matched) userIds.add(m.id);
    }
    // Exclut l'auteur de l'annulation
    userIds.delete(user.id);

    if (userIds.size > 0) {
      const startStr = new Date(booking.startAt).toLocaleString("fr-FR", {
        weekday: "short",
        day: "numeric",
        month: "short",
        hour: "2-digit",
        minute: "2-digit",
      });
      await tx.insert(notifications).values(
        Array.from(userIds).map((uid) => ({
          userId: uid,
          type: "meeting_room_cancelled" as const,
          title: `Réservation annulée — ${roomName}`,
          message: `« ${booking.title} » du ${startStr} a été annulée.`,
          actorId: user.id,
        }))
      );
    }
  });

  return NextResponse.json({ success: true });
}
