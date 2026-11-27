"use client";

import { Check } from "lucide-react";
import { Link } from "@/i18n/routing";
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
import { crmButtonClass } from "../crm-states";
import { ToggleFilter } from "../shell/toggle-filter";

interface PipelineToolbarProps {
  mine: boolean;
  late: boolean;
  weighted: boolean;
  ownerId: string | null;
  owners: { id: string; name: string }[];
  mineAvailable: boolean;
  /** Faux : champ Prochaine relance non raccordé. */
  lateAvailable: boolean;
  weightedAvailable: boolean;
  databaseId: string | null;
  /** Vue portant la config des totaux : ouverture directe quand elle est connue. */
  viewId: string | null;
  spaceId: string | null;
  databaseName: string;
  onMine: () => void;
  onLate: () => void;
  onWeighted: () => void;
  onOwner: (ownerId: string | null) => void;
}

export function PipelineToolbar(p: PipelineToolbarProps) {
  const t = useTranslations("crm");
  const OwnerIcon = getCrmAction("pipelineOwner").icon;
  const BasesIcon = getCrmAction("pipelineOpenInBases").icon;
  const ownerName = p.owners.find((o) => o.id === p.ownerId)?.name ?? t("pipeline.ownerAll");
  return (
    <>
      <ToggleFilter
        actionId="pipelineMine"
        tip={t("pipeline.mineTip")}
        pressed={p.mine && p.mineAvailable}
        onToggle={p.onMine}
        disabledReason={p.mineAvailable ? undefined : t("pipeline.mineUnavailable")}
      />
      <ToggleFilter
        actionId="pipelineLate"
        tip={t("pipeline.lateTip")}
        pressed={p.late}
        onToggle={p.onLate}
        disabledReason={p.lateAvailable ? undefined : t("pipeline.lateUnavailable")}
      />
      <DropdownMenu>
        <Tip label={t("pipeline.ownerTip")}>
          <DropdownMenuTrigger
            aria-label={t("pipeline.ownerAria", { owner: ownerName })}
            data-action="pipelineOwner"
            className={cn(crmButtonClass, p.ownerId !== null && "bg-muted")}
          >
            <OwnerIcon className="size-3.5" aria-hidden="true" />
            <span className="max-w-32 truncate">{p.ownerId === null ? t("pipeline.owner") : ownerName}</span>
          </DropdownMenuTrigger>
        </Tip>
        <DropdownMenuContent align="end" className="w-52">
          <DropdownMenuItem onClick={() => p.onOwner(null)}>
            <span className="flex-1 truncate">{t("pipeline.ownerAll")}</span>
            {p.ownerId === null && <Check className="size-3.5" aria-hidden="true" />}
          </DropdownMenuItem>
          {p.owners.map((o) => (
            <DropdownMenuItem key={o.id} onClick={() => p.onOwner(o.id)}>
              <span className="flex-1 truncate">{o.name}</span>
              {p.ownerId === o.id && <Check className="size-3.5" aria-hidden="true" />}
            </DropdownMenuItem>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>
      <ToggleFilter
        actionId="pipelineWeighted"
        tip={t("pipeline.weightedTip")}
        pressed={p.weighted && p.weightedAvailable}
        onToggle={p.onWeighted}
        disabledReason={p.weightedAvailable ? undefined : t("pipeline.weightedUnavailable")}
      />
      {p.databaseId && (
        <Tip label={t("pipeline.openInBasesTip")}>
          <Link
            href={
              p.viewId && p.spaceId
                ? `/bases/${p.databaseId}/views/${p.viewId}?spaceId=${p.spaceId}`
                : `/bases/${p.databaseId}`
            }
            aria-label={t("pipeline.openInBasesAria", { base: p.databaseName })}
            data-action="pipelineOpenInBases"
            className={crmButtonClass}
          >
            <BasesIcon className="size-3.5" aria-hidden="true" />
            {t("pipeline.openInBases")}
          </Link>
        </Tip>
      )}
    </>
  );
}
