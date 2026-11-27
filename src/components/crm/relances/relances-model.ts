import { addDaysIso, daysUntil, relanceBucket } from "@/lib/crm/dates";
import type { RelanceItem, RelancesDto } from "@/lib/crm/relances";

/** Horizon de la file : aujourd'hui plus sept jours. */
export const RELANCE_HORIZON = 7;

type Groups = RelancesDto["groups"];
const KEYS = ["late", "today", "week"] as const;

function without(groups: Groups, dealId: string): Groups {
  return {
    late: groups.late.filter((i) => i.dealId !== dealId),
    today: groups.today.filter((i) => i.dealId !== dealId),
    week: groups.week.filter((i) => i.dealId !== dealId),
  };
}

function compare(a: RelanceItem, b: RelanceItem): number {
  return a.relance.localeCompare(b.relance) || a.title.localeCompare(b.title, "fr");
}

/**
 * Place le dossier dans le groupe de sa nouvelle date (retiré si la date est vide ou hors
 * horizon), ordre du serveur conservé : date puis titre.
 */
export function placeRelance(dto: RelancesDto, item: RelanceItem, relance: string | null, today: string): RelancesDto {
  const groups = without(dto.groups, item.dealId);
  const bucket = relance === null ? null : relanceBucket(relance, today, RELANCE_HORIZON);
  if (relance !== null && (bucket === "late" || bucket === "today" || bucket === "week")) {
    groups[bucket] = [...groups[bucket], { ...item, relance }].sort(compare);
  }
  return { ...dto, groups };
}

/** Même calcul que le serveur pour « Reporter » : depuis aujourd'hui si la relance est passée. */
export function snoozeTarget(relance: string, days: number, today: string): string {
  const base = daysUntil(relance, today) < 0 ? today : relance;
  return addDaysIso(base, days);
}

export function setLastInteraction(
  dto: RelancesDto,
  dealId: string,
  last: RelanceItem["lastInteraction"],
): RelancesDto {
  const groups = { ...dto.groups };
  for (const k of KEYS) groups[k] = groups[k].map((i) => (i.dealId === dealId ? { ...i, lastInteraction: last } : i));
  return { ...dto, groups };
}

export function findItem(dto: RelancesDto | undefined, dealId: string): RelanceItem | undefined {
  if (!dto) return undefined;
  for (const k of KEYS) {
    const hit = dto.groups[k].find((i) => i.dealId === dealId);
    if (hit) return hit;
  }
  return undefined;
}
