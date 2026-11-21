import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { meetingRooms } from "@/lib/db/schema";
import { eq, asc, inArray, and } from "drizzle-orm";
import { getSessionUser } from "@/lib/auth/get-user";
import { getRequestOrgId } from "@/lib/org/get-request-org";
import { guardMeetingRoomsEnabled } from "@/lib/meeting-rooms/guards";
import {
  canManageRooms,
  listBookableRoomIds,
} from "@/lib/meeting-rooms/permissions";
import { isValidOpeningHours } from "@/lib/meeting-rooms/opening-hours";

export async function GET() {
  const blocked = await guardMeetingRoomsEnabled();
  if (blocked) return blocked;

  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "Non authentifié" }, { status: 401 });

  // Cloisonnement multi-tenant : ne lister que les salles de l'org courante,
  // y compris pour les admins (allowed === "all"). Org non résolue → vide.
  const orgId = await getRequestOrgId(user);
  if (!orgId) return NextResponse.json([]);

  // Admins voient tout, autres utilisateurs voient les salles qu'ils peuvent réserver
  const allowed = await listBookableRoomIds(user.id, user.globalRole, user.capabilities);

  let rooms: (typeof meetingRooms.$inferSelect)[] = [];
  if (allowed === "all") {
    rooms = await db
      .select()
      .from(meetingRooms)
      .where(
        and(eq(meetingRooms.isActive, true), eq(meetingRooms.organizationId, orgId))
      )
      .orderBy(asc(meetingRooms.name));
  } else if (allowed.length > 0) {
    rooms = await db
      .select()
      .from(meetingRooms)
      .where(
        and(inArray(meetingRooms.id, allowed), eq(meetingRooms.organizationId, orgId))
      )
      .orderBy(asc(meetingRooms.name));
  }

  return NextResponse.json(rooms);
}

const createRoomSchema = z.object({
  name: z.string().min(1).max(255),
  address: z.string().optional().nullable(),
  floor: z.string().max(100).optional().nullable(),
  capacity: z.number().int().min(0).max(10000),
  description: z.string().optional().nullable(),
  openingHours: z.unknown().optional(),
  equipment: z.array(z.string().max(100)).max(64).optional(),
  isActive: z.boolean().optional(),
});

export async function POST(request: NextRequest) {
  const blocked = await guardMeetingRoomsEnabled();
  if (blocked) return blocked;

  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "Non authentifié" }, { status: 401 });
  if (!canManageRooms(user.globalRole, user.capabilities)) {
    return NextResponse.json({ error: "Accès refusé" }, { status: 403 });
  }

  // Rattachement multi-tenant : la salle créée appartient à l'org courante.
  const orgId = await getRequestOrgId(user);
  if (!orgId) {
    return NextResponse.json({ error: "Organisation introuvable" }, { status: 403 });
  }

  let body;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }
  const parsed = createRoomSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0].message }, { status: 400 });
  }

  const { openingHours, equipment, ...rest } = parsed.data;
  if (openingHours !== undefined && !isValidOpeningHours(openingHours)) {
    return NextResponse.json({ error: "Horaires d'ouverture invalides" }, { status: 400 });
  }

  try {
    const [room] = await db
      .insert(meetingRooms)
      .values({
        name: rest.name,
        address: rest.address ?? undefined,
        floor: rest.floor ?? undefined,
        capacity: rest.capacity,
        description: rest.description ?? undefined,
        openingHours: openingHours ?? undefined,
        equipment: equipment ?? [],
        isActive: rest.isActive ?? true,
        createdBy: user.id,
        organizationId: orgId,
      })
      .returning();

    return NextResponse.json(room, { status: 201 });
  } catch (err) {
    console.error("[POST /api/meeting-rooms]", err);
    const message = err instanceof Error ? err.message : "Erreur interne";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
