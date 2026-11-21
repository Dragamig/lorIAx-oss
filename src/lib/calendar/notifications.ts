import { db } from "@/lib/db";
import {
  calendarEvents,
  calendarEventReminders,
} from "@/lib/db/schema";
import { eq, and, gte } from "drizzle-orm";
import { createNotification } from "@/lib/notifications";
import logger from "@/lib/logger";

/**
 * Process pending event reminders.
 * Should be called periodically (e.g., every minute via cron).
 */
export async function processReminders(): Promise<number> {
  const now = new Date();

  // Find all unsent reminders where the event is upcoming
  const pendingReminders = await db
    .select({
      reminderId: calendarEventReminders.id,
      userId: calendarEventReminders.userId,
      minutesBefore: calendarEventReminders.minutesBefore,
      eventId: calendarEventReminders.eventId,
      eventTitle: calendarEvents.title,
      eventStartAt: calendarEvents.startAt,
      eventLocation: calendarEvents.location,
    })
    .from(calendarEventReminders)
    .innerJoin(
      calendarEvents,
      eq(calendarEvents.id, calendarEventReminders.eventId)
    )
    .where(
      and(
        eq(calendarEventReminders.sent, false),
        // Event is in the future
        gte(calendarEvents.startAt, now)
      )
    );

  let sent = 0;

  for (const reminder of pendingReminders) {
    const triggerTime = new Date(
      new Date(reminder.eventStartAt).getTime() -
        reminder.minutesBefore * 60 * 1000
    );

    // If we've passed the trigger time, send the reminder
    if (now >= triggerTime) {
      const startDate = new Date(reminder.eventStartAt);
      const dateStr = startDate.toLocaleDateString("fr-FR", {
        weekday: "long",
        day: "numeric",
        month: "long",
        hour: "2-digit",
        minute: "2-digit",
      });

      try {
        await createNotification({
          userId: reminder.userId,
          type: "calendar_reminder",
          title: `Rappel : ${reminder.eventTitle}`,
          message: `"${reminder.eventTitle}" commence le ${dateStr}${
            reminder.eventLocation ? ` à ${reminder.eventLocation}` : ""
          }`,
        });

        // Mark as sent
        await db
          .update(calendarEventReminders)
          .set({ sent: true, sentAt: now })
          .where(eq(calendarEventReminders.id, reminder.reminderId));

        sent++;
      } catch (err) {
        logger.error(
          { err, reminderId: reminder.reminderId },
          "[calendar] Erreur envoi rappel"
        );
      }
    }
  }

  return sent;
}
