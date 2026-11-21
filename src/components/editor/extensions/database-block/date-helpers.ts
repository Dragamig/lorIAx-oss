// ─── Helpers de date partagés (filtres + formules) ──────────────────────────
// Source unique pour la sémantique de date du database-block. Les deux côtés
// (cellule et cible) sont parsés à l'identique, donc cohérents en fuseau horaire.
// Granularité jour pour les comparaisons de filtres ; les formules disposent en
// plus d'arithmétique d'unités et de formatage (parité Airtable).

export const DAY_MS = 86_400_000;

// Parse une valeur arbitraire en Date locale, ou null si invalide/vide.
// Une date seule « YYYY-MM-DD » est interprétée à minuit LOCAL (et non UTC,
// comportement par défaut de Date), pour une arithmétique de date cohérente.
export function toDate(v: unknown): Date | null {
  if (v == null || v === "") return null;
  if (typeof v === "string") {
    const m = v.trim().match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (m) return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  }
  const d = new Date(typeof v === "number" ? v : String(v));
  return Number.isNaN(d.getTime()) ? null : d;
}

// Timestamp du début de journée locale.
export function startOfDay(d: Date): number {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
}

// Début de semaine ISO (lundi).
export function startOfWeek(d: Date): number {
  const offset = (d.getDay() + 6) % 7; // 0 = lundi
  return new Date(d.getFullYear(), d.getMonth(), d.getDate() - offset).getTime();
}

// ─── Arithmétique d'unités (formules) ───────────────────────────────────────

export type DateUnit =
  | "years"
  | "months"
  | "weeks"
  | "days"
  | "hours"
  | "minutes"
  | "seconds";

// Normalise une unité Airtable vers une unité canonique. Les lettres seules
// 'M' (mois) et 'm' (minutes) sont sensibles à la casse, comme Airtable ;
// le reste est insensible à la casse.
export function normalizeUnit(unitRaw: unknown): DateUnit {
  const u = String(unitRaw ?? "").trim();
  if (u === "M") return "months";
  if (u === "m") return "minutes";
  const l = u.toLowerCase();
  if (["y", "year", "years"].includes(l)) return "years";
  if (["w", "week", "weeks"].includes(l)) return "weeks";
  if (["d", "day", "days"].includes(l)) return "days";
  if (["h", "hour", "hours"].includes(l)) return "hours";
  if (["s", "second", "seconds"].includes(l)) return "seconds";
  if (["month", "months"].includes(l)) return "months";
  if (["minute", "minutes"].includes(l)) return "minutes";
  return "days"; // défaut raisonnable
}

// Ajoute n unités à une date (n peut être négatif). Renvoie une nouvelle Date.
export function addToDate(d: Date, n: number, unit: unknown): Date {
  const r = new Date(d.getTime());
  const amount = Number(n) || 0;
  switch (normalizeUnit(unit)) {
    case "years":
      r.setFullYear(r.getFullYear() + amount);
      break;
    case "months":
      r.setMonth(r.getMonth() + amount);
      break;
    case "weeks":
      r.setDate(r.getDate() + amount * 7);
      break;
    case "days":
      r.setDate(r.getDate() + amount);
      break;
    case "hours":
      r.setHours(r.getHours() + amount);
      break;
    case "minutes":
      r.setMinutes(r.getMinutes() + amount);
      break;
    case "seconds":
      r.setSeconds(r.getSeconds() + amount);
      break;
  }
  return r;
}

// Différence calendaire en mois entre a et b (a - b), ajustée du jour du mois.
function monthDiff(a: Date, b: Date): number {
  let m = (a.getFullYear() - b.getFullYear()) * 12 + (a.getMonth() - b.getMonth());
  if (m > 0 && a.getDate() < b.getDate()) m -= 1;
  else if (m < 0 && a.getDate() > b.getDate()) m += 1;
  return m;
}

// Différence a - b exprimée dans l'unité, tronquée vers zéro (parité Airtable
// DATETIME_DIFF). Les unités basées sur la durée passent par les millisecondes,
// mois/années par le calendrier.
export function diffUnit(a: Date, b: Date, unit: unknown): number {
  const u = normalizeUnit(unit);
  if (u === "months") return monthDiff(a, b);
  if (u === "years") return Math.trunc(monthDiff(a, b) / 12);
  const ms = a.getTime() - b.getTime();
  switch (u) {
    case "weeks":
      return Math.trunc(ms / (7 * DAY_MS));
    case "days":
      return Math.trunc(ms / DAY_MS);
    case "hours":
      return Math.trunc(ms / 3_600_000);
    case "minutes":
      return Math.trunc(ms / 60_000);
    case "seconds":
      return Math.trunc(ms / 1_000);
    default:
      return Math.trunc(ms / DAY_MS);
  }
}

// Formate une date selon un masque à jetons (sous-ensemble Airtable/moment) :
// YYYY YY MM M DD D HH H mm m ss s. Composants en heure locale.
export function formatDate(d: Date, fmt: string): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  const map: Record<string, string> = {
    YYYY: String(d.getFullYear()),
    YY: String(d.getFullYear()).slice(-2),
    MM: pad(d.getMonth() + 1),
    M: String(d.getMonth() + 1),
    DD: pad(d.getDate()),
    D: String(d.getDate()),
    HH: pad(d.getHours()),
    H: String(d.getHours()),
    mm: pad(d.getMinutes()),
    m: String(d.getMinutes()),
    ss: pad(d.getSeconds()),
    s: String(d.getSeconds()),
  };
  // Jetons longs avant jetons courts pour éviter les correspondances partielles.
  return fmt.replace(/YYYY|YY|MM|M|DD|D|HH|H|mm|m|ss|s/g, (t) => map[t] ?? t);
}
