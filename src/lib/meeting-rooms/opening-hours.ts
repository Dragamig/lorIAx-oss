import type { DayOfWeek, OpeningHours, OpeningHoursSlot } from "@/types";
import { isFrenchHoliday } from "./holidays-fr";

const DAYS: DayOfWeek[] = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"];

function dayKey(date: Date): DayOfWeek {
  return DAYS[date.getDay()];
}

function minutesFromHHMM(hhmm: string): number | null {
  const m = /^(\d{1,2}):(\d{2})$/.exec(hhmm);
  if (!m) return null;
  const h = Number(m[1]);
  const mm = Number(m[2]);
  if (h < 0 || h > 23 || mm < 0 || mm > 59) return null;
  return h * 60 + mm;
}

function localMinutes(date: Date): number {
  return date.getHours() * 60 + date.getMinutes();
}

/**
 * Vérifie qu'un créneau [start, end] est :
 * - intégralement dans la même journée
 * - couvert par les horaires d'ouverture de cette journée
 * - hors jour férié français
 */
export function isWithinOpeningHours(
  start: Date,
  end: Date,
  hours: OpeningHours
): { ok: true } | { ok: false; reason: string } {
  if (end <= start) {
    return { ok: false, reason: "La fin doit être après le début" };
  }

  const sameDay =
    start.getFullYear() === end.getFullYear() &&
    start.getMonth() === end.getMonth() &&
    start.getDate() === end.getDate();
  if (!sameDay) {
    return { ok: false, reason: "Une réservation doit tenir sur une seule journée" };
  }

  if (isFrenchHoliday(start)) {
    return { ok: false, reason: "Jour férié non réservable" };
  }

  const slots = hours[dayKey(start)] ?? [];
  if (slots.length === 0) {
    return { ok: false, reason: "Salle fermée ce jour-là" };
  }

  const startMin = localMinutes(start);
  const endMin = localMinutes(end);

  for (const slot of slots) {
    const from = minutesFromHHMM(slot.from);
    const to = minutesFromHHMM(slot.to);
    if (from === null || to === null || from >= to) continue;
    if (startMin >= from && endMin <= to) return { ok: true };
  }

  return { ok: false, reason: "Hors horaires d'ouverture" };
}

/**
 * Calcule les créneaux libres d'une salle entre `from` et `to`,
 * en soustrayant les bookings confirmés des horaires d'ouverture.
 * Granularité : journée par journée.
 */
export interface AvailabilitySlot {
  start: string; // ISO 8601
  end: string;
}

export function computeAvailability(
  from: Date,
  to: Date,
  hours: OpeningHours,
  bookings: { startAt: Date; endAt: Date }[]
): AvailabilitySlot[] {
  const result: AvailabilitySlot[] = [];

  // Itère sur chaque jour entre from et to
  const cursor = new Date(from);
  cursor.setHours(0, 0, 0, 0);
  const end = new Date(to);
  end.setHours(23, 59, 59, 999);

  while (cursor <= end) {
    if (!isFrenchHoliday(cursor)) {
      const slots = hours[dayKey(cursor)] ?? [];
      const dayBookings = bookings
        .filter((b) => isSameLocalDate(b.startAt, cursor))
        .sort((a, b) => a.startAt.getTime() - b.startAt.getTime());

      for (const slot of slots) {
        const slotStart = atTime(cursor, slot.from);
        const slotEnd = atTime(cursor, slot.to);
        if (!slotStart || !slotEnd) continue;

        let pointer = slotStart.getTime();
        for (const b of dayBookings) {
          const bStart = b.startAt.getTime();
          const bEnd = b.endAt.getTime();
          if (bEnd <= pointer || bStart >= slotEnd.getTime()) continue;
          if (bStart > pointer) {
            result.push({
              start: new Date(pointer).toISOString(),
              end: new Date(bStart).toISOString(),
            });
          }
          pointer = Math.max(pointer, bEnd);
        }
        if (pointer < slotEnd.getTime()) {
          result.push({
            start: new Date(pointer).toISOString(),
            end: slotEnd.toISOString(),
          });
        }
      }
    }
    cursor.setDate(cursor.getDate() + 1);
  }

  return result;
}

function isSameLocalDate(a: Date, b: Date): boolean {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  );
}

function atTime(day: Date, hhmm: string): Date | null {
  const min = minutesFromHHMM(hhmm);
  if (min === null) return null;
  const d = new Date(day);
  d.setHours(Math.floor(min / 60), min % 60, 0, 0);
  return d;
}

export function isValidOpeningHours(value: unknown): value is OpeningHours {
  if (typeof value !== "object" || value === null) return false;
  const obj = value as Record<string, unknown>;
  for (const day of DAYS) {
    const slots = obj[day];
    if (!Array.isArray(slots)) return false;
    for (const s of slots as OpeningHoursSlot[]) {
      if (
        !s ||
        typeof s.from !== "string" ||
        typeof s.to !== "string" ||
        minutesFromHHMM(s.from) === null ||
        minutesFromHHMM(s.to) === null
      ) {
        return false;
      }
    }
  }
  return true;
}
