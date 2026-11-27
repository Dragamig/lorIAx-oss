import { resolveServerTz, zonedParts } from "@/lib/bases/tz-date";

export type RelanceBucket = "late" | "today" | "week" | "later";

const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})(?:$|T)/;
const DAY_MS = 86_400_000;

function pad(n: number, size: number): string {
  return String(n).padStart(size, "0");
}

function toUtcMs(iso: string): number {
  const [y, m, d] = iso.slice(0, 10).split("-").map(Number);
  return Date.UTC(y, m - 1, d);
}

function fromUtcMs(ms: number): string {
  const d = new Date(ms);
  return `${pad(d.getUTCFullYear(), 4)}-${pad(d.getUTCMonth() + 1, 2)}-${pad(d.getUTCDate(), 2)}`;
}

/** Date ISO du jour dans le fuseau (repli Europe/Paris si invalide). */
export function todayIn(now: Date, tz: string | undefined): string {
  const p = zonedParts(now, resolveServerTz(tz));
  return `${pad(p.year, 4)}-${pad(p.month, 2)}-${pad(p.day, 2)}`;
}

export function addDaysIso(iso: string, n: number): string {
  return fromUtcMs(toUtcMs(iso) + n * DAY_MS);
}

/** Jours entre `today` et `iso`, négatif si `iso` est passé. */
export function daysUntil(iso: string, today: string): number {
  return Math.round((toUtcMs(iso) - toUtcMs(today)) / DAY_MS);
}

export function isPastDate(iso: string, today: string): boolean {
  return daysUntil(iso, today) < 0;
}

/** Garde la date d'une cellule `YYYY-MM-DD` ou ISO complet, sinon null. */
export function readIsoDate(cell: unknown): string | null {
  if (typeof cell !== "string") return null;
  const m = ISO_DATE.exec(cell);
  if (!m) return null;
  const iso = `${m[1]}-${m[2]}-${m[3]}`;
  return fromUtcMs(toUtcMs(iso)) === iso ? iso : null;
}

export function relanceBucket(
  iso: string | null,
  today: string,
  horizonDays: number,
): RelanceBucket | null {
  const date = iso === null ? null : readIsoDate(iso);
  if (date === null) return null;
  const d = daysUntil(date, today);
  if (d < 0) return "late";
  if (d === 0) return "today";
  return d <= horizonDays ? "week" : "later";
}
