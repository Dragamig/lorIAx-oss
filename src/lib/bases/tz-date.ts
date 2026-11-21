export const DEFAULT_SERVER_TZ = "Europe/Paris";

export interface ZonedParts {
  year: number;
  month: number;
  day: number;
  weekday: number;
}

// Un formateur par fuseau canonique : l'évaluation des filtres appelle
// zonedParts à chaque ligne. La clé est le nom canonique renvoyé par Intl
// (les variantes de casse ou de forme d'un même fuseau partagent une entrée),
// et chaque table a un plafond dur : au-delà, rien n'est mémorisé.
const MAX_CACHE_ENTRIES = 100;
const MAX_TZ_LENGTH = 64;
const formatters = new Map<string, Intl.DateTimeFormat>();
// Alias saisi -> nom canonique, pour ne pas reconstruire un formateur à chaque
// appel avec une variante de casse. Plafonné comme le cache.
const aliases = new Map<string, string>();

/** Taille du cache de formateurs (tests). */
export function tzCacheSize(): number {
  return formatters.size;
}

function canonicalFormatter(tz: string): { name: string; fmt: Intl.DateTimeFormat } | null {
  const alias = aliases.get(tz);
  const key = alias ?? tz;
  const cached = formatters.get(key);
  if (cached) return { name: key, fmt: cached };
  if (tz.length > MAX_TZ_LENGTH) return null;
  let fmt: Intl.DateTimeFormat;
  let name: string;
  try {
    fmt = new Intl.DateTimeFormat("en-CA", {
      timeZone: tz,
      year: "numeric",
      month: "numeric",
      day: "numeric",
      weekday: "short",
    });
    name = fmt.resolvedOptions().timeZone;
  } catch {
    return null;
  }
  const existing = formatters.get(name);
  if (existing) fmt = existing;
  else if (formatters.size < MAX_CACHE_ENTRIES) formatters.set(name, fmt);
  if (name !== tz && aliases.size < MAX_CACHE_ENTRIES && formatters.has(name)) {
    aliases.set(tz, name);
  }
  return { name, fmt };
}

function formatterFor(tz: string): Intl.DateTimeFormat | null {
  return canonicalFormatter(tz)?.fmt ?? null;
}

export function isValidTz(tz: unknown): tz is string {
  if (typeof tz !== "string" || tz.length === 0) return false;
  return canonicalFormatter(tz) !== null;
}

export function resolveServerTz(tz: string | null | undefined): string {
  if (typeof tz !== "string" || tz.length === 0) return DEFAULT_SERVER_TZ;
  return canonicalFormatter(tz)?.name ?? DEFAULT_SERVER_TZ;
}

const WEEKDAYS: Record<string, number> = {
  Sun: 0,
  Mon: 1,
  Tue: 2,
  Wed: 3,
  Thu: 4,
  Fri: 5,
  Sat: 6,
};

export function zonedParts(date: Date, tz: string): ZonedParts {
  const fmt = formatterFor(tz);
  if (!fmt) throw new RangeError(`Invalid time zone specified: ${tz}`);
  const parts = fmt.formatToParts(date);
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? "";
  return {
    year: Number(get("year")),
    month: Number(get("month")),
    day: Number(get("day")),
    weekday: WEEKDAYS[get("weekday")] ?? 0,
  };
}

export function quarterOf(parts: { month: number }): 1 | 2 | 3 | 4 {
  return (Math.floor((parts.month - 1) / 3) + 1) as 1 | 2 | 3 | 4;
}

export function dayNumber(parts: { year: number; month: number; day: number }): number {
  return Math.round(Date.UTC(parts.year, parts.month - 1, parts.day) / 86_400_000);
}
