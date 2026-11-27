"use client";

import { useCrmRelancesCount } from "@/lib/crm/use-crm-data";

export const RELANCES_BADGE_MAX = 99;

/** Libellé court du badge : plafonné à « 99+ ». */
export function formatRelancesCount(count: number): string {
  return count > RELANCES_BADGE_MAX ? `${RELANCES_BADGE_MAX}+` : String(count);
}

/** Lit le compteur de mes relances échues ou du jour. À ne monter que si le CRM est actif et raccordé. */
export function useRelancesBadgeCount(): number {
  const { data } = useCrmRelancesCount();
  const count = data?.count;
  return typeof count === "number" && Number.isFinite(count) && count > 0 ? Math.floor(count) : 0;
}

/** Pastille numérique, masquée à 0. Le nom accessible est porté par le lien parent. */
export function RelancesBadge({ count }: { count: number }) {
  if (count <= 0) return null;
  return (
    <span
      aria-hidden="true"
      className="ml-auto inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-primary px-1.5 text-xs font-semibold leading-none text-primary-foreground"
    >
      {formatRelancesCount(count)}
    </span>
  );
}
