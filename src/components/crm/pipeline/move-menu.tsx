"use client";

import { useTranslations } from "next-intl";
import { Tip } from "@/components/editor/extensions/database-block/row-tip";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { getCrmAction } from "@/lib/crm/actions";
import { cn } from "@/lib/utils";

interface MoveMenuProps {
  dealTitle: string;
  currentKey: string;
  lanes: { key: string; label: string }[];
  /** Raison de l'indisponibilité (lecture seule) ; le bouton reste visible et l'explique. */
  disabledReason?: string;
  onMove: (laneKey: string) => void;
}

const iconButton =
  "inline-flex size-6 shrink-0 items-center justify-center rounded-md text-muted-foreground outline-none transition-colors hover:bg-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring aria-disabled:cursor-not-allowed aria-disabled:opacity-50";

/** Menu « Changer le statut » d'une carte : alternative clavier au glisser-déposer. */
export function MoveMenu({ dealTitle, currentKey, lanes, disabledReason, onMove }: MoveMenuProps) {
  const t = useTranslations("crm");
  const action = getCrmAction("pipelineMove");
  const Icon = action.icon;
  const aria = t("pipeline.moveAria", { title: dealTitle });

  if (disabledReason) {
    return (
      <Tip label={disabledReason}>
        <button type="button" aria-label={aria} aria-disabled="true" data-action="pipelineMove" className={iconButton}>
          <Icon className="size-3.5" aria-hidden="true" />
        </button>
      </Tip>
    );
  }
  return (
    <DropdownMenu>
      <Tip label={t("pipeline.move")}>
        <DropdownMenuTrigger aria-label={aria} data-action="pipelineMove" className={iconButton}>
          <Icon className="size-3.5" aria-hidden="true" />
        </DropdownMenuTrigger>
      </Tip>
      <DropdownMenuContent align="end" className="w-52">
        {lanes.map((lane) => {
          const current = lane.key === currentKey;
          return (
            <DropdownMenuItem
              key={lane.key}
              disabled={current}
              onClick={() => onMove(lane.key)}
              className={cn(current && "font-medium")}
            >
              <span className="truncate">{current ? t("pipeline.moveCurrent", { lane: lane.label }) : lane.label}</span>
            </DropdownMenuItem>
          );
        })}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
