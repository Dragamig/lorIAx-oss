"use client";

import { useCallback, useEffect, useRef } from "react";
import { useLocale, useTranslations } from "next-intl";
import { toast } from "sonner";
import { todayIn } from "@/lib/crm/dates";
import type { DealSheetDto } from "@/lib/crm/deals";
import { crmTimezone, refreshCrmData, type CrmQueryResult } from "@/lib/crm/use-crm-data";
import { formatRelanceDay } from "../relances/relative-label";

type Mutate = CrmQueryResult<DealSheetDto>["mutate"];
type Body = { done: true } | { date: string } | { restore: string | null };

interface Change {
  body: Body;
  from: string | null;
  to: string | null;
  kind: "done" | "plan";
  undoing?: boolean;
}

async function post(dealId: string, body: Body): Promise<{ ok: boolean; code?: string }> {
  try {
    const res = await fetch(`/api/crm/deals/${dealId}/relance?tz=${encodeURIComponent(crmTimezone())}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (res.ok) return { ok: true };
    const json = (await res.json().catch(() => null)) as { error?: string; code?: string } | null;
    return { ok: false, code: json?.code };
  } catch {
    return { ok: false };
  }
}

/** Relance appliquée au cache du dossier (propriété `deal` et cellule de la ligne). */
export function withRelance(dto: DealSheetDto, to: string | null): DealSheetDto {
  const col = dto.relanceColumnId;
  return {
    ...dto,
    deal: { ...dto.deal, relance: to },
    row: col ? { ...dto.row, cells: { ...dto.row.cells, [col]: to } } : dto.row,
  };
}

/** Écritures de la relance depuis la fiche : optimiste, Annuler par `{ restore }`, Réessayer. */
export function useDealRelance(dto: DealSheetDto, mutate: Mutate) {
  const t = useTranslations("crm.fiche.relance");
  const locale = useLocale();
  const busy = useRef(false);
  const changeRef = useRef<(c: Change) => Promise<boolean>>(async () => false);
  const dealId = dto.deal.id;
  const title = dto.deal.title;

  const change = useCallback(
    async (c: Change): Promise<boolean> => {
      if (busy.current) {
        toast.info(t("busy"));
        return false;
      }
      busy.current = true;
      await mutate((cur) => (cur ? withRelance(cur, c.to) : cur), { revalidate: false });
      const res = await post(dealId, c.body);
      busy.current = false;
      if (res.ok) {
        if (c.undoing) toast.success(t("toastUndone"));
        else {
          const message =
            c.kind === "done" ? t("toastDone", { title }) : t("toastPlanned", { title, date: c.to ? formatRelanceDay(c.to, locale) : "" });
          toast.success(message, {
            action: {
              label: t("toastUndo"),
              onClick: () => void changeRef.current({ body: { restore: c.from }, from: c.to, to: c.from, kind: c.kind, undoing: true }),
            },
          });
        }
        void refreshCrmData();
        return true;
      }
      await mutate((cur) => (cur ? withRelance(cur, c.from) : cur), { revalidate: false });
      void refreshCrmData();
      if (res.code === "past_date") toast.error(t("past"));
      else
        toast.error(c.undoing ? t("toastUndoError") : t("toastError", { title }), {
          action: { label: t("toastRetry"), onClick: () => void changeRef.current(c) },
        });
      return false;
    },
    [mutate, dealId, title, t, locale],
  );

  useEffect(() => {
    changeRef.current = change;
  }, [change]);

  const from = dto.deal.relance;
  return {
    markDone: () => change({ body: { done: true }, from, to: null, kind: "done" }),
    planTo: (date: string) => change({ body: { date }, from, to: date, kind: "plan" }),
    today: () => todayIn(new Date(), crmTimezone()),
  };
}
