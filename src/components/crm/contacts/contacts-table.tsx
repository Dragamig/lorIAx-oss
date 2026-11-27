"use client";

import { Users } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { Link } from "@/i18n/routing";
import { Tip } from "@/components/editor/extensions/database-block/row-tip";
import { getCrmAction } from "@/lib/crm/actions";
import type { ContactItem } from "@/lib/crm/contacts";
import { cn } from "@/lib/utils";
import { crmButtonClass } from "../crm-states";
import { formatRelanceDay } from "../relances/relative-label";

interface ContactsTableProps {
  contacts: ContactItem[];
  databaseId: string;
  currency: string;
  openId: string | null;
  onOpen: (id: string) => void;
}

const COLS = ["30%", "17%", "13%", "16%", "16%", "8%"];
const cell = "h-11 truncate px-3 align-middle text-xs";

function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  return ((parts[0]?.[0] ?? "") + (parts.length > 1 ? (parts[parts.length - 1]?.[0] ?? "") : "")).toUpperCase();
}

/** Tableau des contacts : lignes de hauteur identique, texte long tronqué. */
export function ContactsTable({ contacts, databaseId, currency, openId, onOpen }: ContactsTableProps) {
  const t = useTranslations("crm.contacts");
  const tFiche = useTranslations("crm.fiche");
  const locale = useLocale();
  const money = new Intl.NumberFormat(locale, { style: "currency", currency, maximumFractionDigits: 0 });
  const DealsIcon = getCrmAction("contactDeals").icon;
  const BasesIcon = getCrmAction("contactOpenBases").icon;

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
            {(["colContact", "colBrand", "colDeals", "colAmount", "colLast"] as const).map((k) => (
              <th
                key={k}
                scope="col"
                className={cn("h-8 truncate px-3 text-xs font-medium text-muted-foreground", (k === "colDeals" || k === "colAmount") && "text-right")}
              >
                {t(k)}
              </th>
            ))}
            <th scope="col" className="h-8 px-3">
              <span className="sr-only">{t("colActions")}</span>
            </th>
          </tr>
        </thead>
        <tbody>
          {contacts.map((c) => {
            const last = c.lastInteraction;
            const name = c.name || tFiche("unnamed");
            return (
              <tr
                key={c.id}
                tabIndex={0}
                aria-label={t("rowOpenAria", { name })}
                data-testid="contact-row"
                data-id={c.id}
                className={cn(
                  "cursor-pointer border-b border-border outline-none transition-colors last:border-b-0 hover:bg-muted/50 focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring",
                  c.id === openId && "bg-muted/60",
                )}
                onClick={() => onOpen(c.id)}
                onKeyDown={(e) => {
                  if (e.target !== e.currentTarget) return;
                  if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    onOpen(c.id);
                  }
                }}
              >
                <td className={cn(cell, "font-medium")}>
                  <span className="flex items-center gap-2">
                    <span
                      aria-hidden="true"
                      className="inline-flex size-6 shrink-0 items-center justify-center rounded-full bg-muted text-[10px] font-semibold text-muted-foreground"
                    >
                      {initials(c.name) || <Users className="size-3" />}
                    </span>
                    <span className="truncate">{name}</span>
                  </span>
                </td>
                <td className={cell}>{c.org ?? ""}</td>
                <td className={cn(cell, "text-right tabular-nums")}>{c.openDeals}</td>
                <td className={cn(cell, "text-right tabular-nums")}>{money.format(c.openAmount)}</td>
                <td className={cn(cell, "text-muted-foreground")}>
                  {last && last.date ? (
                    <span className="tabular-nums">
                      {formatRelanceDay(last.date, locale)}
                      {last.type ? ` · ${last.type}` : ""}
                    </span>
                  ) : (
                    t("noInteraction")
                  )}
                </td>
                <td className="h-11 px-2 align-middle">
                  <span className="flex items-center justify-end gap-1">
                    <Tip label={t("dealsTip", { name })}>
                      <Link
                        href={`/crm/dossiers?contact=${c.id}`}
                        aria-label={t("dealsAria", { name })}
                        data-action="contactDeals"
                        className={crmButtonClass}
                        onClick={(e) => e.stopPropagation()}
                      >
                        <DealsIcon className="size-3.5" aria-hidden="true" />
                      </Link>
                    </Tip>
                    <Tip label={t("openBasesTip", { name })}>
                      <Link
                        href={`/bases/${databaseId}?row=${c.id}`}
                        aria-label={t("openBasesAria", { name })}
                        data-action="contactOpenBases"
                        className={crmButtonClass}
                        onClick={(e) => e.stopPropagation()}
                      >
                        <BasesIcon className="size-3.5" aria-hidden="true" />
                      </Link>
                    </Tip>
                  </span>
                </td>
              </tr>
            );
          })}
        </tbody>
        <tfoot>
          <tr className="border-t border-border bg-muted/40">
            <td colSpan={6} className="h-9 px-3 text-xs text-muted-foreground">
              {t("footer", { count: contacts.length })}
            </td>
          </tr>
        </tfoot>
      </table>
    </div>
  );
}
