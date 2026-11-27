"use client";

import { useLocale, useTranslations } from "next-intl";
import { Tip } from "@/components/editor/extensions/database-block/row-tip";
import type { RelanceItem } from "@/lib/crm/relances";
import { cn } from "@/lib/utils";
import { CrmActionButton } from "../crm-states";
import { QuickInteraction } from "./quick-interaction";
import { formatRelanceDay, relativeLabel, type RelanceTranslate } from "./relative-label";
import { SnoozeDatePanel, SnoozeMenu } from "./snooze-menu";

export type RowPanel = "date" | "log" | null;

interface RelanceRowProps {
  item: RelanceItem;
  today: string;
  late: boolean;
  /** Raison pour laquelle écrire est impossible (lecture seule, rechargement) ; absent si permis. */
  writeReason?: string;
  /** Raison pour laquelle consigner une interaction est impossible. */
  logReason?: string;
  /** Ouvre la fiche du dossier. */
  onOpen: () => void;
  interactionTypes: string[];
  panel: RowPanel;
  onPanel: (panel: RowPanel) => void;
  onDone: () => void;
  onSnoozeDays: (days: number) => void;
  onSnoozeDate: (date: string) => void;
  onLog: (input: { type: string; title: string }) => void;
}

const titleClass =
  "block h-5 max-w-full truncate rounded-sm text-left text-sm font-medium outline-none focus-visible:ring-2 focus-visible:ring-ring";

/** Ligne de relance : hauteur fixe, textes tronqués ; les saisies s'ouvrent sous la ligne. */
export function RelanceRow(p: RelanceRowProps) {
  const t = useTranslations("crm.relances");
  const locale = useLocale();
  const { item } = p;
  const tr = t as unknown as RelanceTranslate;
  const last = item.lastInteraction;
  const lastText = last
    ? [last.type, last.date ? formatRelanceDay(last.date, locale) : null, last.title].filter(Boolean).join(", ")
    : t("lastNone");
  const snoozeReason = p.writeReason ?? (item.relance ? undefined : t("noRelance"));
  return (
    <li data-testid="relance-row" data-id={item.dealId} className="border-b border-border last:border-b-0">
      <div className="grid h-14 grid-cols-[minmax(0,2fr)_minmax(0,1.2fr)_minmax(0,1.5fr)_7rem_auto] items-center gap-3 px-3">
        <div className="flex min-w-0 flex-col gap-0.5">
          <Tip label={t("openTip")}>
            <button
              type="button"
              aria-label={t("openAria", { title: item.title })}
              data-action="relanceOpen"
              onClick={p.onOpen}
              className={titleClass}
            >
              {item.title}
            </button>
          </Tip>
          <span className="h-4 truncate text-[11px] text-muted-foreground">{item.status ?? ""}</span>
        </div>
        <div className="min-w-0 text-xs">
          <div className="truncate">{item.contactName ?? ""}</div>
          <div className="truncate text-muted-foreground">{item.contactOrg ?? ""}</div>
        </div>
        <div className="truncate text-xs text-muted-foreground" title={lastText}>
          {lastText}
        </div>
        <div className={cn("min-w-0 text-xs", p.late && "font-medium text-destructive")}>
          <div className="truncate tabular-nums">{item.relance ? formatRelanceDay(item.relance, locale) : ""}</div>
          <div className="truncate text-[11px]">{item.relance ? relativeLabel(item.relance, p.today, tr) : ""}</div>
        </div>
        <div className="flex items-center gap-1.5">
          <CrmActionButton
            actionId="relanceDone"
            label={t("done")}
            tip={t("doneTip")}
            ariaLabel={t("doneAria", { title: item.title })}
            onClick={p.onDone}
            disabledReason={p.writeReason}
          />
          <SnoozeMenu
            title={item.title}
            disabledReason={snoozeReason}
            onDay={() => p.onSnoozeDays(1)}
            onWeek={() => p.onSnoozeDays(7)}
            onDate={() => p.onPanel("date")}
          />
          <CrmActionButton
            actionId="relanceLog"
            tip={t("logTip")}
            ariaLabel={t("logAria", { title: item.title })}
            pressed={p.panel === "log"}
            onClick={() => p.onPanel(p.panel === "log" ? null : "log")}
            disabledReason={p.logReason}
          />
        </div>
      </div>
      {p.panel === "date" && (
        <SnoozeDatePanel today={p.today} onApply={p.onSnoozeDate} onCancel={() => p.onPanel(null)} />
      )}
      {p.panel === "log" && (
        <QuickInteraction types={p.interactionTypes} onSubmit={p.onLog} onCancel={() => p.onPanel(null)} />
      )}
    </li>
  );
}
