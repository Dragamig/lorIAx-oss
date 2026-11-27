"use client";

import { useTranslations } from "next-intl";
import { Tip } from "@/components/editor/extensions/database-block/row-tip";
import { getCrmAction } from "@/lib/crm/actions";
import { cn } from "@/lib/utils";

export interface ViewTab {
  id: string;
  name: string;
}

interface ViewTabsProps {
  views: ViewTab[];
  activeId: string | null;
  onApply: (id: string) => void;
  onDelete: (id: string) => void;
  /** Raison affichée quand la suppression est indisponible. */
  deleteReason?: string;
}

const tabClass =
  "inline-flex h-7 min-w-6 max-w-48 items-center gap-1.5 rounded-md px-2 text-xs font-medium outline-none transition-colors hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring";
const delClass =
  "inline-flex size-6 items-center justify-center rounded-md text-muted-foreground outline-none transition-colors hover:bg-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring aria-disabled:cursor-not-allowed aria-disabled:opacity-50";

/** Vues enregistrées de la base Dossiers, une puce « Vue personnalisée » quand aucune ne correspond. */
export function ViewTabs({ views, activeId, onApply, onDelete, deleteReason }: ViewTabsProps) {
  const t = useTranslations("crm.dossiers");
  const ApplyIcon = getCrmAction("dossiersViewApply").icon;
  const DeleteIcon = getCrmAction("dossiersViewDelete").icon;
  return (
    <div role="tablist" aria-label={t("tablistAria")} className="flex flex-wrap items-center gap-1 px-6 pt-3">
      {views.map((v) => {
        const active = v.id === activeId;
        return (
          <span key={v.id} className="inline-flex items-center">
            <Tip label={t("viewApplyTip", { name: v.name })}>
              <button
                type="button"
                role="tab"
                aria-selected={active}
                aria-label={t("viewApplyAria", { name: v.name })}
                data-action="dossiersViewApply"
                className={cn(tabClass, active ? "bg-muted text-foreground" : "text-muted-foreground")}
                onClick={() => onApply(v.id)}
              >
                <ApplyIcon className="size-3.5 shrink-0" aria-hidden="true" />
                <span className="truncate">{v.name}</span>
              </button>
            </Tip>
            <Tip label={deleteReason ?? t("viewDeleteTip", { name: v.name })}>
              <button
                type="button"
                aria-label={t("viewDeleteAria", { name: v.name })}
                aria-disabled={deleteReason ? true : undefined}
                data-action="dossiersViewDelete"
                className={delClass}
                onClick={deleteReason ? undefined : () => onDelete(v.id)}
              >
                <DeleteIcon className="size-3.5" aria-hidden="true" />
              </button>
            </Tip>
          </span>
        );
      })}
      {activeId === null && (
        <span className="ml-1.5 rounded-full border border-border px-2 py-0.5 text-[11px] font-medium text-muted-foreground">
          {t("custom")}
        </span>
      )}
    </div>
  );
}
