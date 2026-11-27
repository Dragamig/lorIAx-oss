"use client";

import { useState } from "react";
import { Mail, MessageSquare, Phone, CalendarDays } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import type { InteractionDto } from "@/lib/crm/deal-model";
import { cn } from "@/lib/utils";
import { CrmActionButton } from "../../crm-states";
import { formatRelanceDay } from "../../relances/relative-label";

export function iconFor(type: string | null) {
  const v = (type ?? "").toLowerCase();
  if (/(mail|courriel)/.test(v)) return Mail;
  if (/(appel|call|t[ée]l)/.test(v)) return Phone;
  if (/(rdv|rendez|meeting|r[ée]union)/.test(v)) return CalendarDays;
  return MessageSquare;
}

export function Note({ text }: { text: string }) {
  const t = useTranslations("crm.fiche.interactions");
  const [open, setOpen] = useState(false);
  return (
    <div className="flex items-start gap-1">
      <div className={cn("min-w-0 flex-1 text-xs whitespace-pre-line", !open && "line-clamp-2")}>{text}</div>
      <CrmActionButton
        actionId="ficheInteractionNote"
        tip={open ? t("collapse") : t("expand")}
        ariaLabel={open ? t("collapse") : t("expand")}
        expanded={open}
        onClick={() => setOpen((v) => !v)}
        className={cn("shrink-0 border-transparent", open && "[&_svg]:rotate-180")}
      />
    </div>
  );
}

/** Carte d'une interaction du fil d'activité. */
export function InteractionCard({ interaction: i }: { interaction: InteractionDto }) {
  const t = useTranslations("crm.fiche.interactions");
  const locale = useLocale();
  const Icon = iconFor(i.type);
  const meta = [i.type, i.date ? formatRelanceDay(i.date, locale) : null].filter(Boolean).join(", ");
  return (
    <li data-testid="fiche-interaction" className="flex gap-2 rounded-lg border border-border p-2">
      <span className="flex size-7 shrink-0 items-center justify-center rounded-md bg-muted" aria-hidden="true">
        <Icon className="size-3.5" />
      </span>
      <div className="min-w-0 flex-1">
        <div className="truncate text-sm font-medium">{i.title || t("untitled")}</div>
        <div className="truncate text-xs text-muted-foreground">{meta}</div>
        {i.note && <Note text={i.note} />}
      </div>
    </li>
  );
}
