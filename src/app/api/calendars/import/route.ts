import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { calendarEvents } from "@/lib/db/schema";
import { and, eq } from "drizzle-orm";
import { getSessionUser } from "@/lib/auth/get-user";
import { checkCalendarAccess } from "@/lib/calendar/permissions";
import { getRequestOrgId } from "@/lib/org/get-request-org";
import { parseICalendar } from "@/lib/calendar/ical";
import logger from "@/lib/logger";
import { z } from "zod";

const importSchema = z.object({
  calendarId: z.string().uuid(),
  icsContent: z.string().min(1),
});

export async function POST(request: Request) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "Non authentifié" }, { status: 401 });

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Corps JSON invalide" }, { status: 400 });
  }

  const parsed = importSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0].message }, { status: 400 });
  }

  const { calendarId, icsContent } = parsed.data;

  const hasAccess = await checkCalendarAccess(user.id, calendarId, "write", await getRequestOrgId(user));
  if (!hasAccess) return NextResponse.json({ error: "Accès refusé" }, { status: 403 });

  const parsedEvents = parseICalendar(icsContent);

  if (parsedEvents.length === 0) {
    return NextResponse.json(
      { error: "Aucun événement trouvé dans le fichier ICS" },
      { status: 400 }
    );
  }

  let created = 0;
  let updated = 0;
  let skipped = 0;

  for (const event of parsedEvents) {
    // Cloisonnement (AZ-21) : la déduplication par UID est bornée au calendrier
    // cible, le seul sur lequel l'accès en écriture a été vérifié. Sans cette
    // borne, un ICS forgé reprenant l'UID d'un événement d'un autre calendrier
    // écrasait cet événement à distance.
    const [existing] = await db
      .select()
      .from(calendarEvents)
      .where(
        and(
          eq(calendarEvents.uid, event.uid),
          eq(calendarEvents.calendarId, calendarId)
        )
      )
      .limit(1);

    if (existing) {
      // Update if sequence is higher or equal
      if ((event.sequence || 0) >= existing.sequence) {
        await db
          .update(calendarEvents)
          .set({
            title: event.title,
            description: event.description,
            location: event.location,
            startAt: event.startAt,
            endAt: event.endAt || event.startAt,
            allDay: event.allDay,
            recurrenceRule: event.recurrenceRule,
            recurrenceExceptions: event.recurrenceExceptions || [],
            status: event.status || "confirmed",
            visibility: event.visibility || "public",
            sequence: event.sequence || 0,
            progress: event.progress || 0,
            updatedAt: new Date(),
          })
          .where(eq(calendarEvents.id, existing.id));
        updated++;
      } else {
        skipped++;
      }
    } else {
      // L'index unique global sur `uid` peut refuser l'insertion si l'UID est
      // déjà pris par un autre calendrier. C'est un échec fermé et voulu : on
      // compte l'événement comme ignoré plutôt que d'écrire hors du calendrier
      // autorisé. (Défaut voisin : cet index devrait porter sur le couple
      // calendrier + UID.)
      try {
        await db.insert(calendarEvents).values({
          calendarId,
          title: event.title,
          description: event.description,
          location: event.location,
          startAt: event.startAt,
          endAt: event.endAt || event.startAt,
          allDay: event.allDay,
          recurrenceRule: event.recurrenceRule,
          recurrenceExceptions: event.recurrenceExceptions || [],
          status: event.status || "confirmed",
          visibility: event.visibility || "public",
          uid: event.uid,
          sequence: event.sequence || 0,
          progress: event.progress || 0,
          createdBy: user.id,
        });
        created++;
      } catch (error) {
        logger.warn(
          { err: error, uid: event.uid, calendarId },
          "Import ICS : UID déjà utilisé par un autre calendrier, événement ignoré"
        );
        skipped++;
      }
    }
  }

  return NextResponse.json({
    success: true,
    created,
    updated,
    skipped,
    total: parsedEvents.length,
  });
}
