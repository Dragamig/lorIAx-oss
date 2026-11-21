import { db } from "@/lib/db";
import { calendars } from "@/lib/db/schema";
import { and, eq } from "drizzle-orm";
import crypto from "crypto";

const ROOM_CALENDAR_NAME = "Salles de réunion";
const ROOM_CALENDAR_SLUG_PREFIX = "salles-reunion";

/**
 * Récupère ou crée le calendrier organisation des salles de réunion, confiné à
 * une organisation (cloisonnement multi-tenant : un calendrier salles par org).
 */
export async function getOrCreateRoomsCalendar(
  fallbackOwnerUserId: string,
  organizationId: string
): Promise<string> {
  const existing = await db
    .select({ id: calendars.id })
    .from(calendars)
    .where(
      and(
        eq(calendars.type, "organization"),
        eq(calendars.name, ROOM_CALENDAR_NAME),
        eq(calendars.organizationId, organizationId)
      )
    )
    .limit(1);

  if (existing.length > 0) return existing[0].id;

  const slug = `${ROOM_CALENDAR_SLUG_PREFIX}-${crypto.randomBytes(4).toString("hex")}`;
  const [created] = await db
    .insert(calendars)
    .values({
      name: ROOM_CALENDAR_NAME,
      description: "Réservations de salles (généré automatiquement)",
      color: "#0891b2",
      timezone: "Europe/Paris",
      type: "organization",
      ownerUserId: fallbackOwnerUserId,
      organizationId,
      caldavSlug: slug,
      isDefault: false,
    })
    .returning({ id: calendars.id });

  return created.id;
}
