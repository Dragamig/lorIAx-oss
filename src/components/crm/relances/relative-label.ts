import { daysUntil } from "@/lib/crm/dates";

export type RelanceTranslate = (key: string, values?: Record<string, number>) => string;

/** Libellé relatif d'une date de relance (clés `rel.*` du namespace `crm.relances`). */
export function relativeLabel(iso: string, today: string, t: RelanceTranslate): string {
  const n = daysUntil(iso, today);
  if (n === 0) return t("rel.today");
  if (n === 1) return t("rel.tomorrow");
  if (n === -1) return t("rel.yesterday");
  return n > 0 ? t("rel.inDays", { n }) : t("rel.lateDays", { n: Math.abs(n) });
}

/** Jour et mois courts, dans la langue de l'interface. */
export function formatRelanceDay(iso: string, locale: string): string {
  const d = new Date(`${iso.slice(0, 10)}T00:00:00Z`);
  if (Number.isNaN(d.getTime())) return iso;
  return new Intl.DateTimeFormat(locale, { day: "numeric", month: "short", timeZone: "UTC" }).format(d);
}
