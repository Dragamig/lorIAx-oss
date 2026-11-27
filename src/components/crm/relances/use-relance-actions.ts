"use client";

import { useCallback, useEffect, useRef } from "react";
import { useLocale, useTranslations } from "next-intl";
import { toast } from "sonner";
import { todayIn } from "@/lib/crm/dates";
import type { RelanceItem, RelancesDto } from "@/lib/crm/relances";
import { crmTimezone, refreshCrmData, type CrmQueryResult } from "@/lib/crm/use-crm-data";
import { postCrm } from "../crm-post";
import { formatRelanceDay } from "./relative-label";
import { placeRelance, setLastInteraction, snoozeTarget } from "./relances-model";

type Mutate = CrmQueryResult<RelancesDto>["mutate"];
type Body = { done: true } | { snoozeDays: number } | { date: string } | { restore: string | null };

interface Change {
  item: RelanceItem;
  body: Body;
  /** Relance avant et après l'action (null : plus de relance). */
  from: string | null;
  to: string | null;
  kind: "done" | "snooze";
  undoing?: boolean;
}

export interface LogInput {
  type: string;
  title: string;
}

/** Écritures de l'écran À relancer : optimiste, annulation par `{ restore }`, rollback et Réessayer. */
export function useRelanceActions(mutate: Mutate) {
  const t = useTranslations("crm.relances");
  const locale = useLocale();
  const inflight = useRef(new Set<string>());
  const changeRef = useRef<(c: Change) => Promise<boolean>>(async () => false);
  const logRef = useRef<(item: RelanceItem, input: LogInput) => Promise<boolean>>(async () => false);

  const change = useCallback(
    async (c: Change): Promise<boolean> => {
      const id = c.item.dealId;
      if (inflight.current.has(id)) {
        toast.info(t("toast.busy", { title: c.item.title }));
        return false;
      }
      inflight.current.add(id);
      const today = todayIn(new Date(), crmTimezone());
      const place = (to: string | null) => (cur: RelancesDto | undefined) => (cur ? placeRelance(cur, c.item, to, today) : cur);
      await mutate(place(c.to), { revalidate: false });
      const res = await postCrm(`/api/crm/deals/${id}/relance`, c.body);
      inflight.current.delete(id);

      if (res.ok) {
        if (c.undoing) toast.success(t("toast.undone"));
        else {
          const message =
            c.kind === "done"
              ? t("toast.done", { title: c.item.title })
              : t("toast.snoozed", { title: c.item.title, date: c.to ? formatRelanceDay(c.to, locale) : "" });
          toast.success(message, {
            action: {
              label: t("toast.undo"),
              onClick: () =>
                void changeRef.current({ item: c.item, body: { restore: c.from }, from: c.to, to: c.from, kind: c.kind, undoing: true }),
            },
          });
        }
        if (inflight.current.size === 0) void refreshCrmData();
        return true;
      }

      await mutate(place(c.from), { revalidate: false });
      if (inflight.current.size === 0) void refreshCrmData();
      const retry = { label: t("toast.retry"), onClick: () => void changeRef.current(c) };
      if (res.code === "past_date") toast.error(t("date.past"));
      else if (res.code === "no_relance") toast.error(t("noRelance"));
      else if (c.undoing) toast.error(t("toast.undoError"), { action: retry });
      else toast.error(t(c.kind === "done" ? "toast.doneError" : "toast.snoozeError", { title: c.item.title }), { action: retry });
      return false;
    },
    [mutate, t, locale],
  );

  const log = useCallback(
    async (item: RelanceItem, input: LogInput): Promise<boolean> => {
      const today = todayIn(new Date(), crmTimezone());
      const before = item.lastInteraction;
      const set = (last: RelanceItem["lastInteraction"]) => (cur: RelancesDto | undefined) =>
        cur ? setLastInteraction(cur, item.dealId, last) : cur;
      await mutate(set({ date: today, type: input.type, title: input.title }), { revalidate: false });
      const res = await postCrm(`/api/crm/deals/${item.dealId}/interactions`, { type: input.type, title: input.title });
      if (res.ok) {
        toast.success(t("toast.logged", { title: item.title }));
        void refreshCrmData();
        return true;
      }
      await mutate(set(before), { revalidate: false });
      void refreshCrmData();
      toast.error(t("toast.logError", { title: item.title }), {
        action: { label: t("toast.retry"), onClick: () => void logRef.current(item, input) },
      });
      return false;
    },
    [mutate, t],
  );

  useEffect(() => {
    changeRef.current = change;
    logRef.current = log;
  }, [change, log]);

  return {
    markDone: (item: RelanceItem) => change({ item, body: { done: true }, from: item.relance, to: null, kind: "done" }),
    snoozeBy: (item: RelanceItem, days: number) => {
      const today = todayIn(new Date(), crmTimezone());
      return change({
        item,
        body: { snoozeDays: days },
        from: item.relance,
        to: snoozeTarget(item.relance, days, today),
        kind: "snooze",
      });
    },
    snoozeTo: (item: RelanceItem, date: string) =>
      change({ item, body: { date }, from: item.relance, to: date, kind: "snooze" }),
    log,
  };
}
