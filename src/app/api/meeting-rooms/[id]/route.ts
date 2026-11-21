import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { meetingRooms } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import { getSessionUser } from "@/lib/auth/get-user";
import { guardMeetingRoomsEnabled } from "@/lib/meeting-rooms/guards";
import { getMeetingRoomForRequest } from "@/lib/meeting-rooms/scoped-room";
import {
  canBookRoom,
  canManageRooms,
} from "@/lib/meeting-rooms/permissions";
import { isValidOpeningHours } from "@/lib/meeting-rooms/opening-hours";

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const blocked = await guardMeetingRoomsEnabled();
  if (blocked) return blocked;

  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "Non authentifié" }, { status: 401 });

  const { id } = await params;
  // Cloisonnement multi-tenant : 404 si la salle relève d'une autre org.
  const room = await getMeetingRoomForRequest(id, user);
  if (!room) {
    return NextResponse.json({ error: "Salle introuvable" }, { status: 404 });
  }

  const allowed =
    canManageRooms(user.globalRole, user.capabilities) ||
    (await canBookRoom(user.id, user.globalRole, id, user.capabilities));
  if (!allowed) {
    return NextResponse.json({ error: "Accès refusé" }, { status: 403 });
  }

  return NextResponse.json(room);
}

const patchRoomSchema = z.object({
  name: z.string().min(1).max(255).optional(),
  address: z.string().nullable().optional(),
  floor: z.string().max(100).nullable().optional(),
  capacity: z.number().int().min(0).max(10000).optional(),
  description: z.string().nullable().optional(),
  openingHours: z.unknown().optional(),
  equipment: z.array(z.string().max(100)).max(64).optional(),
  isActive: z.boolean().optional(),
});

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const blocked = await guardMeetingRoomsEnabled();
  if (blocked) return blocked;

  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "Non authentifié" }, { status: 401 });
  if (!canManageRooms(user.globalRole, user.capabilities)) {
    return NextResponse.json({ error: "Accès refusé" }, { status: 403 });
  }

  const { id } = await params;
  // Cloisonnement multi-tenant : 404 si la salle relève d'une autre org.
  if (!(await getMeetingRoomForRequest(id, user))) {
    return NextResponse.json({ error: "Salle introuvable" }, { status: 404 });
  }

  const body = await request.json();
  const parsed = patchRoomSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0].message }, { status: 400 });
  }

  const updates: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(parsed.data)) {
    if (v !== undefined) updates[k] = v;
  }

  if ("openingHours" in updates && !isValidOpeningHours(updates.openingHours)) {
    return NextResponse.json({ error: "Horaires d'ouverture invalides" }, { status: 400 });
  }

  if (Object.keys(updates).length === 0) {
    return NextResponse.json({ error: "Aucune modification" }, { status: 400 });
  }
  updates.updatedAt = new Date();

  try {
    const [room] = await db
      .update(meetingRooms)
      .set(updates)
      .where(eq(meetingRooms.id, id))
      .returning();

    if (!room) {
      return NextResponse.json({ error: "Salle introuvable" }, { status: 404 });
    }
    return NextResponse.json(room);
  } catch (err) {
    console.error("[PATCH /api/meeting-rooms/[id]]", err);
    const message = err instanceof Error ? err.message : "Erreur interne";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const blocked = await guardMeetingRoomsEnabled();
  if (blocked) return blocked;

  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "Non authentifié" }, { status: 401 });
  if (!canManageRooms(user.globalRole, user.capabilities)) {
    return NextResponse.json({ error: "Accès refusé" }, { status: 403 });
  }

  const { id } = await params;
  // Cloisonnement multi-tenant : 404 si la salle relève d'une autre org.
  if (!(await getMeetingRoomForRequest(id, user))) {
    return NextResponse.json({ error: "Salle introuvable" }, { status: 404 });
  }

  try {
    const result = await db
      .delete(meetingRooms)
      .where(eq(meetingRooms.id, id))
      .returning({ id: meetingRooms.id });

    if (result.length === 0) {
      return NextResponse.json({ error: "Salle introuvable" }, { status: 404 });
    }

    return NextResponse.json({ success: true });
  } catch (err) {
    console.error("[DELETE /api/meeting-rooms/[id]]", err);
    const message = err instanceof Error ? err.message : "Erreur interne";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
