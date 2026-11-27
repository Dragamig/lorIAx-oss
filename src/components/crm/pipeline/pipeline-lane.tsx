"use client";

import { useLocale, useTranslations } from "next-intl";
import { KanbanLaneHeader } from "@/components/bases/kanban-lane-header";
import { cn } from "@/lib/utils";
import type { BoardLane } from "./pipeline-model";
import { PipelineCard } from "./pipeline-card";
import type { usePipelineDrag } from "./use-pipeline-drag";

interface PipelineLaneProps {
  lane: BoardLane;
  lanes: { key: string; label: string }[];
  showWeighted: boolean;
  currency: string;
  moveDisabledReason?: string;
  onOpen: (id: string) => void;
  onMove: (id: string, laneKey: string) => void;
  drag: ReturnType<typeof usePipelineDrag>;
}

/** Voie du Pipeline : en-tête de totaux du kanban Bases (sans bouton d'ajout) et cartes. */
export function PipelineLane({ lane, lanes, showWeighted, currency, moveDisabledReason, onOpen, onMove, drag }: PipelineLaneProps) {
  const t = useTranslations("crm");
  const locale = useLocale();
  const isTarget = drag.overLane === lane.key;
  return (
    <section
      role="listitem"
      data-testid="pipeline-lane"
      data-lane={lane.key}
      aria-label={t("pipeline.laneAria", { lane: lane.label, count: lane.cards.length })}
      data-drop-target={isTarget ? "true" : undefined}
      {...drag.laneProps(lane.key)}
      className={cn(
        "flex w-64 shrink-0 flex-col rounded-lg bg-neutral-100/70 p-2 dark:bg-neutral-900/60",
        isTarget && "bg-blue-50 ring-2 ring-blue-700 dark:bg-blue-950/50 dark:ring-blue-400",
      )}
    >
      <KanbanLaneHeader
        laneKey={lane.key}
        totals={lane.totals}
        weight={lane.weight}
        closed={lane.closed}
        showWeighted={showWeighted}
        currency={currency}
        locale={locale}
        count={lane.cards.length}
      />
      <div className="flex flex-1 flex-col gap-1.5 overflow-y-auto">
        {lane.cards.length === 0 && (
          <div className="rounded-md border border-dashed border-border px-2 py-4 text-center text-xs text-muted-foreground">
            {t("pipeline.emptyLane")}
          </div>
        )}
        {lane.cards.map((card) => (
          <PipelineCard
            key={card.id}
            card={card}
            laneKey={lane.key}
            lanes={lanes}
            currency={currency}
            moveDisabledReason={moveDisabledReason}
            onOpen={onOpen}
            onMove={onMove}
            dragProps={drag.cardProps(card.id, lane.key)}
            dragging={drag.draggingId === card.id}
          />
        ))}
      </div>
    </section>
  );
}
