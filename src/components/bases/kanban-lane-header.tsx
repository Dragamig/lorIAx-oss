"use client";

import { Flag, Plus } from "lucide-react";
import { useTranslations } from "next-intl";
import { Tip } from "@/components/editor/extensions/database-block/row-tip";
import type { laneTotals } from "@/lib/bases/kanban";

/** Montant formaté dans la devise de la config ; l'arrondi n'a lieu qu'ici. Jamais de NaN affiché. */
export function formatAmount(value: number, currency: string, locale: string): string {
  const safe = Number.isFinite(value) ? value : 0;
  try {
    return new Intl.NumberFormat(locale, { style: "currency", currency, maximumFractionDigits: 0 }).format(safe);
  } catch {
    return new Intl.NumberFormat(locale, { maximumFractionDigits: 0 }).format(safe);
  }
}

export interface KanbanLaneHeaderProps {
  laneKey: string;
  totals: ReturnType<typeof laneTotals> | null;
  weight: number | null;
  closed: boolean;
  showWeighted: boolean;
  currency: string;
  locale: string;
  onAdd(): void;
  busy: boolean;
  /** Nombre de cartes affichées quand les totaux sont inactifs. */
  count?: number;
}

const btn =
  "inline-flex items-center gap-1.5 rounded px-1.5 py-1 text-xs text-neutral-600 hover:bg-neutral-100 focus-visible:outline focus-visible:outline-2 focus-visible:outline-blue-500 disabled:opacity-50 dark:text-neutral-300 dark:hover:bg-neutral-800";

export function KanbanLaneHeader({
  laneKey, totals, weight, closed, showWeighted, currency, locale, onAdd, busy, count,
}: KanbanLaneHeaderProps) {
  const t = useTranslations("basesTotals");
  const name = laneKey || t("noValue");
  const active = totals !== null;
  return (
    <header
      className={`mb-2 px-1 ${closed && active ? "opacity-70" : ""}`}
      data-testid="kanban-lane-header"
      data-closed={closed && active ? "true" : undefined}
    >
      <div className="flex items-center gap-2">
        <span className="truncate text-xs font-medium">{name}</span>
        <span className="text-xs text-neutral-500">{totals ? totals.count : count}</span>
        {closed && active && (
          <span
            className="inline-flex items-center gap-1 rounded bg-neutral-200 px-1.5 text-[10px] font-medium text-neutral-700 dark:bg-neutral-800 dark:text-neutral-300"
            data-testid="kanban-lane-closed"
          >
            <Flag className="h-3 w-3" aria-hidden />
            {t("closedBadge")}
          </span>
        )}
        <Tip label={t("addCard")}>
          <button
            type="button"
            disabled={busy}
            onClick={onAdd}
            aria-label={t("addCardIn", { lane: name })}
            className={`${btn} ml-auto shrink-0`}
          >
            <Plus className="h-3.5 w-3.5" aria-hidden />
          </button>
        </Tip>
      </div>
      {totals && (
        <div className="h-9" data-testid="kanban-lane-foot">
          <div className="h-5 truncate text-sm font-semibold tabular-nums" data-testid="kanban-lane-amount">
            {formatAmount(totals.sum, currency, locale)}
          </div>
          {showWeighted && (
            <div className="h-4 truncate text-[11px] tabular-nums text-neutral-500" data-testid="kanban-lane-weighted">
              {!closed &&
                t("weightedLine", {
                  weight: weight ?? 0,
                  amount: formatAmount(totals.weighted, currency, locale),
                })}
            </div>
          )}
        </div>
      )}
    </header>
  );
}
