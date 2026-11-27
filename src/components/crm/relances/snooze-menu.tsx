"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { Tip } from "@/components/editor/extensions/database-block/row-tip";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { getCrmAction } from "@/lib/crm/actions";
import { daysUntil } from "@/lib/crm/dates";
import { cn } from "@/lib/utils";
import { CrmActionButton, crmButtonClass } from "../crm-states";

interface SnoozeMenuProps {
  title: string;
  /** Raison de l'indisponibilité (lecture seule, relance vide, rechargement). */
  disabledReason?: string;
  onDay: () => void;
  onWeek: () => void;
  onDate: () => void;
}

/** Menu « Reporter » : +1 jour, +1 semaine, date précise. */
export function SnoozeMenu({ title, disabledReason, onDay, onWeek, onDate }: SnoozeMenuProps) {
  const t = useTranslations("crm.relances");
  const action = getCrmAction("relanceSnooze");
  const Icon = action.icon;
  const aria = t("snoozeAria", { title });
  if (disabledReason) {
    return (
      <CrmActionButton
        actionId="relanceSnooze"
        label={t("snooze")}
        tip={t("snoozeTip")}
        ariaLabel={aria}
        disabledReason={disabledReason}
      />
    );
  }
  return (
    <DropdownMenu>
      <Tip label={t("snoozeTip")}>
        <DropdownMenuTrigger aria-label={aria} data-action="relanceSnooze" className={crmButtonClass}>
          <Icon className="size-3.5" aria-hidden="true" />
          {t("snooze")}
        </DropdownMenuTrigger>
      </Tip>
      <DropdownMenuContent align="end" className="w-44">
        <DropdownMenuItem onClick={onDay}>{t("snoozeDay")}</DropdownMenuItem>
        <DropdownMenuItem onClick={onWeek}>{t("snoozeWeek")}</DropdownMenuItem>
        <DropdownMenuItem onClick={onDate}>{t("snoozeDate")}</DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

interface SnoozeDatePanelProps {
  today: string;
  onApply: (date: string) => void;
  onCancel: () => void;
}

/** Saisie d'une date précise : une date passée est refusée sous le champ, sans appel. */
export function SnoozeDatePanel({ today, onApply, onCancel }: SnoozeDatePanelProps) {
  const t = useTranslations("crm.relances");
  const [value, setValue] = useState("");
  const [error, setError] = useState<string | null>(null);
  const submit = () => {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return setError(t("date.invalid"));
    if (daysUntil(value, today) < 0) return setError(t("date.past"));
    setError(null);
    onApply(value);
  };
  return (
    <div className="flex flex-wrap items-start gap-2 border-t border-dashed border-border bg-muted/40 px-3 py-2">
      <div className="flex flex-col gap-1">
        <input
          type="date"
          autoFocus
          value={value}
          min={today}
          aria-label={t("date.label")}
          aria-invalid={error !== null}
          aria-describedby={error ? "relance-date-error" : undefined}
          onChange={(e) => {
            setValue(e.target.value);
            setError(null);
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter") submit();
            if (e.key === "Escape") onCancel();
          }}
          className={cn(
            "h-7 rounded-md border bg-background px-2 text-xs outline-none focus-visible:ring-2 focus-visible:ring-ring",
            error ? "border-destructive" : "border-border",
          )}
        />
        {error && (
          <p id="relance-date-error" role="alert" className="text-xs text-destructive">
            {error}
          </p>
        )}
      </div>
      <CrmActionButton
        actionId="relanceDateApply"
        label={t("date.apply")}
        tip={t("date.applyTip")}
        ariaLabel={t("date.apply")}
        onClick={submit}
      />
      <CrmActionButton
        actionId="relanceDateCancel"
        label={t("date.cancel")}
        tip={t("date.cancelTip")}
        ariaLabel={t("date.cancel")}
        onClick={onCancel}
      />
    </div>
  );
}

