"use client";

import { Sigma } from "lucide-react";
import { useTranslations } from "next-intl";
import type { boardTotals } from "@/lib/bases/kanban";
import { formatAmount } from "./kanban-lane-header";

export interface KanbanTotalsBannerProps {
  totals: ReturnType<typeof boardTotals>;
  showWeighted: boolean;
  currency: string;
  locale: string;
  partial?: boolean;
}

export function KanbanTotalsBanner({ totals, showWeighted, currency, locale, partial }: KanbanTotalsBannerProps) {
  const t = useTranslations("basesTotals");
  const parts = [
    t("bannerCards", { count: totals.count }),
    t("bannerOpen", { count: totals.open }),
    t("bannerOpenSum", { amount: formatAmount(totals.openSum, currency, locale) }),
  ];
  if (showWeighted) parts.push(t("bannerWeighted", { amount: formatAmount(totals.weightedSum, currency, locale) }));
  return (
    <div
      role="status"
      data-testid="kanban-totals-banner"
      className="flex items-center gap-1.5 border-b border-neutral-200 px-3 py-1.5 text-xs tabular-nums text-neutral-600 dark:border-neutral-800 dark:text-neutral-300"
    >
      <Sigma className="h-3.5 w-3.5 shrink-0 text-neutral-400" aria-hidden />
      <span className="truncate">
        {parts.join(", ")}
        {partial ? ` ${t("bannerPartial")}` : ""}
      </span>
    </div>
  );
}
