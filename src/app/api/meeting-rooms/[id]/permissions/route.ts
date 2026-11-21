import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { meetingRoomPermissions } from "@/lib/db/schema";
import { and, eq } from "drizzle-orm";
import { getSessionUser } from "@/lib/auth/get-user";
import { guardMeetingRoomsEnabled } from "@/lib/meeting-rooms/guards";
import {
  canManageRooms,
  principalExists,
} from "@/lib/meeting-rooms/permissions";
import { getMeetingRoomForRequest } from "@/lib/meeting-rooms/scoped-room";
import type { UserCapability, UserRole } from "@/types";

async function ensureRoomAndAdmin(
  id: string,
  user: { id: string; globalRole: UserRole; capabilities?: UserCapability[] }
): Promise<NextResponse | null> {
  if (!canManageRooms(user.globalRole, user.capabilities ?? [])) {
    return NextResponse.json({ error: "Accès refusé" }, { status: 403 });
  }
  // Cloisonnement multi-tenant : 404 si la salle relève d'une autre org.
  if (!(await getMeetingRoomForRequest(id, user))) {
    return NextResponse.json({ error: "Salle introuvable" }, { status: 404 });
  }
  return null;
}

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const blocked = await guardMeetingRoomsEnabled();
  if (blocked) return blocked;

  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "Non authentifié" }, { status: 401 });

  const { id } = await params;
  const guard = await ensureRoomAndAdmin(id, user);
  if (guard) return guard;

  const rows = await db
    .select()
    .from(meetingRoomPermissions)
    .where(eq(meetingRoomPermissions.roomId, id));

  return NextResponse.json(rows);
}

const upsertSchema = z
  .object({
    principalType: z.enum(["user", "team", "role"]),
    principalId: z.string().min(1).max(64),
    canBook: z.boolean().optional(),
  })
  .refine(
    (data) =>
      data.principalType === "role" ||
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
        data.principalId
      ),
    { message: "principalId doit être un UUID pour user/team" }
  );

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const blocked = await guardMeetingRoomsEnabled();
  if (blocked) return blocked;

  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "Non authentifié" }, { status: 401 });

  const { id } = await params;
  const guard = await ensureRoomAndAdmin(id, user);
  if (guard) return guard;

  let body;
  try {
    body = await request.json();
  } catch (error) {
    return NextResponse.json({ error: "Corps de la requête invalide" }, { status: 400 });
  }
  const parsed = upsertSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0].message }, { status: 400 });
  }

  const { principalType, principalId, canBook } = parsed.data;

  const exists = await principalExists(principalType, principalId);
  if (!exists) {
    const label =
      principalType === "user"
        ? "Utilisateur introuvable"
        : principalType === "team"
          ? "Équipe introuvable"
          : "Rôle invalide";
    return NextResponse.json({ error: label }, { status: 400 });
  }

  await db
    .insert(meetingRoomPermissions)
    .values({
      roomId: id,
      principalType,
      principalId,
      canBook: canBook ?? true,
    })
    .onConflictDoUpdate({
      target: [
        meetingRoomPermissions.roomId,
        meetingRoomPermissions.principalType,
        meetingRoomPermissions.principalId,
      ],
      set: { canBook: canBook ?? true },
    });

  return NextResponse.json({ success: true }, { status: 201 });
}

const deleteSchema = z.object({
  principalType: z.enum(["user", "team", "role"]),
  principalId: z.string().min(1).max(64),
});

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const blocked = await guardMeetingRoomsEnabled();
  if (blocked) return blocked;

  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "Non authentifié" }, { status: 401 });

  const { id } = await params;
  const guard = await ensureRoomAndAdmin(id, user);
  if (guard) return guard;

  let body;
  try {
    body = await request.json();
  } catch (error) {
    return NextResponse.json({ error: "Corps de la requête invalide" }, { status: 400 });
  }
  const parsed = deleteSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0].message }, { status: 400 });
  }

  await db
    .delete(meetingRoomPermissions)
    .where(
      and(
        eq(meetingRoomPermissions.roomId, id),
        eq(meetingRoomPermissions.principalType, parsed.data.principalType),
        eq(meetingRoomPermissions.principalId, parsed.data.principalId)
      )
    );

  return NextResponse.json({ success: true });
}
