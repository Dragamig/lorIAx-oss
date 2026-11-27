"use client";

import { useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { addDaysIso, daysUntil } from "@/lib/crm/dates";
import type { DealSheetDto } from "@/lib/crm/deals";
import { cn } from "@/lib/utils";
import { CrmActionButton } from "../crm-states";
import { formatRelanceDay, relativeLabel, type RelanceTranslate } from "../relances/relative-label";

const QUICK = [1, 3, 7, 14] as const;

interface Props {
  dto: DealSheetDto;
  today: string;
  onDone: () => void;
  onPlan: (date: string) => void;
}

/** Prochaine relance du dossier : Faite, Planifier (raccourcis et date précise). */
export function RelanceSection({ dto, today, onDone, onPlan }: Props) {
  const t = useTranslations("crm.fiche.relance");
  const tRel = useTranslations("crm.relances");
  const locale = useLocale();
  const [open, setOpen] = useState(false);
  const [value, setValue] = useState("");
  const [error, setError] = useState<string | null>(null);
  const relance = dto.deal.relance;
  const reason = dto.canEdit ? undefined : t("readOnly");
  const late = relance !== null && daysUntil(relance, today) < 0;

  const plan = (date: string) => {
    setOpen(false);
    setError(null);
    onPlan(date);
  };
  const submit = () => {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return setError(t("invalid"));
    if (daysUntil(value, today) < 0) return setError(t("past"));
    plan(value);
  };

  return (
    <section aria-label={t("title")} data-testid="fiche-relance" className="mb-5">
      <h3 className="mb-2 border-b border-border pb-1 text-xs font-semibold tracking-wide text-muted-foreground uppercase">{t("title")}</h3>
      <div className={cn("rounded-lg border p-3", late ? "border-destructive/40 bg-destructive/5" : "border-border bg-muted/40")}>
        <div className="flex flex-wrap items-center gap-2">
          {relance ? (
            <>
              <span className="text-base font-semibold tabular-nums">{formatRelanceDay(relance, locale)}</span>
              <span className={cn("text-xs", late ? "font-medium text-destructive" : "text-muted-foreground")}>
                {relativeLabel(relance, today, tRel as unknown as RelanceTranslate)}
              </span>
            </>
          ) : (
            <span className="text-xs text-muted-foreground">{t("none")}</span>
          )}
          <span className="flex-1" />
          {relance && (
            <CrmActionButton
              actionId="ficheRelanceDone"
              label={t("done")}
              tip={t("doneTip")}
              ariaLabel={t("doneAria", { title: dto.deal.title })}
              onClick={onDone}
              disabledReason={reason}
            />
          )}
          <CrmActionButton
            actionId="fichePlan"
            label={t("plan")}
            tip={t("planTip")}
            ariaLabel={t("plan")}
            pressed={open}
            onClick={() => setOpen((v) => !v)}
            disabledReason={reason}
          />
        </div>
        {open && !reason && (
          <div className="mt-3 space-y-2 border-t border-dashed border-border pt-3">
            <div className="flex flex-wrap gap-1.5">
              {QUICK.map((n) => {
                const date = addDaysIso(today, n);
                const label = t(`quick.${n}`);
                return (
                  <CrmActionButton
                    key={n}
                    actionId="ficheRelanceQuick"
                    label={label}
                    tip={t("quickTip", { label: label.toLowerCase(), date: formatRelanceDay(date, locale) })}
                    ariaLabel={label}
                    onClick={() => plan(date)}
                  />
                );
              })}
            </div>
            <div className="flex flex-wrap items-start gap-2">
              <label htmlFor="fiche-relance-date" className="pt-1.5 text-xs text-muted-foreground">
                {t("dateLabel")}
              </label>
              <div className="flex flex-col gap-1">
                <input
                  id="fiche-relance-date"
                  type="date"
                  value={value}
                  min={today}
                  aria-label={t("dateAria")}
                  aria-invalid={error !== null}
                  aria-describedby={error ? "fiche-relance-error" : undefined}
                  onChange={(e) => {
                    setValue(e.target.value);
                    setError(null);
                  }}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") submit();
                    if (e.key === "Escape") {
                      e.stopPropagation();
                      setOpen(false);
                    }
                  }}
                  className={cn(
                    "h-7 rounded-md border bg-background px-2 text-xs outline-none focus-visible:ring-2 focus-visible:ring-ring",
                    error ? "border-destructive" : "border-border",
                  )}
                />
                {error && (
                  <p id="fiche-relance-error" role="alert" className="text-xs text-destructive">
                    {error}
                  </p>
                )}
              </div>
              <CrmActionButton actionId="ficheRelanceApply" label={t("apply")} tip={t("applyTip")} ariaLabel={t("apply")} onClick={submit} />
              <CrmActionButton
                actionId="ficheRelanceCancel"
                label={t("cancel")}
                tip={t("cancelTip")}
                ariaLabel={t("cancel")}
                onClick={() => setOpen(false)}
              />
            </div>
          </div>
        )}
      </div>
    </section>
  );
}
