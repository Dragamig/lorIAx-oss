"use client";

import type { HTMLAttributes } from "react";
import { AlertTriangle } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { Tip } from "@/components/editor/extensions/database-block/row-tip";
import { formatAmount } from "@/components/bases/kanban-lane-header";
import { cn } from "@/lib/utils";
import type { BoardCard } from "./pipeline-model";
import { MoveMenu } from "./move-menu";

interface PipelineCardProps {
  card: BoardCard;
  laneKey: string;
  lanes: { key: string; label: string }[];
  currency: string;
  moveDisabledReason?: string;
  onOpen: (id: string) => void;
  onMove: (id: string, laneKey: string) => void;
  dragProps: HTMLAttributes<HTMLElement>;
  dragging: boolean;
}

function formatDay(iso: string, locale: string): string {
  const d = new Date(`${iso.slice(0, 10)}T00:00:00Z`);
  if (Number.isNaN(d.getTime())) return iso;
  return new Intl.DateTimeFormat(locale, { day: "numeric", month: "short", timeZone: "UTC" }).format(d);
}

/** Carte de dossier : gabarit fixe (hauteur et pied constants), lignes tronquées. */
export function PipelineCard({ card, laneKey, lanes, currency, moveDisabledReason, onOpen, onMove, dragProps, dragging }: PipelineCardProps) {
  const t = useTranslations("crm");
  const locale = useLocale();
  const day = card.relance ? formatDay(card.relance, locale) : "";
  return (
    <article
      data-testid="pipeline-card"
      data-id={card.id}
      {...dragProps}
      className={cn(
        "relative flex h-[88px] shrink-0 flex-col rounded-md border border-border bg-background p-2 shadow-xs transition-shadow hover:border-primary/40 hover:shadow-md has-[button:focus-visible]:border-ring",
        dragProps.draggable && "cursor-grab",
        dragging && "opacity-50",
      )}
    >
      <Tip label={t("pipeline.openCardTip")}>
        <button
          type="button"
          aria-label={t("pipeline.openCard", { title: card.title })}
          onClick={() => onOpen(card.id)}
          className="block h-5 w-full truncate rounded-sm text-left text-sm font-medium outline-none after:absolute after:inset-0 after:content-[''] focus-visible:ring-2 focus-visible:ring-ring"
        >
          {card.title}
        </button>
      </Tip>
      <div className="h-4 truncate text-xs text-muted-foreground">{card.contactName ?? ""}</div>
      <div className="mt-auto flex h-6 items-center gap-1.5" data-testid="pipeline-card-foot">
        <span className="min-w-0 flex-1 truncate text-xs font-medium tabular-nums">
          {card.amount !== null ? formatAmount(card.amount, currency, locale) : t("pipeline.noAmount")}
        </span>
        {day && (
          <span
            className={cn(
              "inline-flex shrink-0 items-center gap-0.5 text-[11px] tabular-nums",
              card.late ? "font-medium text-destructive" : "text-muted-foreground",
            )}
            aria-label={card.late ? t("pipeline.lateRelance", { date: day }) : t("pipeline.relance", { date: day })}
          >
            {card.late && <AlertTriangle className="size-3" aria-hidden="true" />}
            {day}
          </span>
        )}
        {card.ownerInitials && (
          <span
            title={card.ownerInitials}
            aria-label={t("pipeline.ownerBadge", { initials: card.ownerInitials })}
            className="inline-flex size-5 shrink-0 items-center justify-center rounded-full bg-muted text-[10px] font-medium"
          >
            {card.ownerInitials}
          </span>
        )}
        <span className="relative z-10 inline-flex">
          <MoveMenu
            dealTitle={card.title}
            currentKey={laneKey}
            lanes={lanes}
            disabledReason={moveDisabledReason}
            onMove={(key) => onMove(card.id, key)}
          />
        </span>
      </div>
    </article>
  );
}
