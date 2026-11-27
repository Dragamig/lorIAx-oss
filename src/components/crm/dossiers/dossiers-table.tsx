"use client";

import { useLocale, useTranslations } from "next-intl";
import { isLate } from "@/lib/crm/deal-model";
import type { DossierDeal } from "@/lib/crm/dossiers";
import { cn } from "@/lib/utils";
import { formatRelanceDay } from "../relances/relative-label";

interface DossiersTableProps {
  deals: DossierDeal[];
  owners: { id: string; name: string }[];
  closed: string[];
  today: string;
  currency: string;
  openId: string | null;
  onOpen: (id: string) => void;
}

const COLS = ["30%", "15%", "13%", "11%", "12%", "10%", "9%"];
const cell = "h-10 truncate px-3 align-middle text-xs";

/** Tableau des dossiers : toutes les lignes ont la même hauteur, le texte long est tronqué. */
export function DossiersTable({ deals, owners, closed, today, currency, openId, onOpen }: DossiersTableProps) {
  const t = useTranslations("crm.dossiers");
  const locale = useLocale();
  const money = new Intl.NumberFormat(locale, { style: "currency", currency, maximumFractionDigits: 0 });
  const total = deals.reduce((n, d) => n + (d.amount ?? 0), 0);
  const ownerName = (ids: string[]) =>
    ids.map((id) => owners.find((o) => o.id === id)?.name).filter((n): n is string => !!n).join(", ");
  const day = (iso: string | null) => (iso ? formatRelanceDay(iso, locale) : "");

  return (
    <div className="overflow-x-auto rounded-lg border border-border">
      <table aria-label={t("tableAria")} className="w-full min-w-[720px] table-fixed border-collapse">
        <colgroup>
          {COLS.map((w, i) => (
            <col key={i} style={{ width: w }} />
          ))}
        </colgroup>
        <thead>
          <tr className="border-b border-border bg-muted/40 text-left">
            {(["colTitle", "colContact", "colStatus", "colAmount", "colOwner", "colRelance", "colClose"] as const).map((k) => (
              <th key={k} scope="col" className={cn("h-8 truncate px-3 text-xs font-medium text-muted-foreground", k === "colAmount" && "text-right")}>
                {t(k)}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {deals.map((d) => {
            const late = isLate(d, closed, today);
            const owner = ownerName(d.ownerIds);
            return (
              <tr
                key={d.id}
                tabIndex={0}
                aria-label={t("rowOpenAria", { title: d.title })}
                data-testid="dossier-row"
                data-id={d.id}
                className={cn(
                  "cursor-pointer border-b border-border outline-none transition-colors last:border-b-0 hover:bg-muted/50 focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring",
                  d.id === openId && "bg-muted/60",
                )}
                onClick={() => onOpen(d.id)}
                onKeyDown={(e) => {
                  if (e.target !== e.currentTarget) return;
                  if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    onOpen(d.id);
                  }
                }}
              >
                <td className={cn(cell, "font-medium")}>{d.title}</td>
                <td className={cell}>{d.contactName ?? ""}</td>
                <td className={cell}>{d.status ?? <span className="text-muted-foreground">{t("noValue")}</span>}</td>
                <td className={cn(cell, "text-right tabular-nums")}>{d.amount === null ? "" : money.format(d.amount)}</td>
                <td className={cell}>{owner || <span className="text-muted-foreground">{t("noValue")}</span>}</td>
                <td className={cn(cell, "tabular-nums", late && "font-medium text-destructive")}>
                  {d.relance ? day(d.relance) : <span className="text-muted-foreground">{t("noRelance")}</span>}
                </td>
                <td className={cn(cell, "tabular-nums")}>{day(d.closeDate)}</td>
              </tr>
            );
          })}
        </tbody>
        <tfoot>
          <tr className="border-t border-border bg-muted/40">
            <td colSpan={7} className="h-9 px-3 text-xs text-muted-foreground">
              {t("footer", { count: deals.length, amount: money.format(total) })}
            </td>
          </tr>
        </tfoot>
      </table>
    </div>
  );
}
