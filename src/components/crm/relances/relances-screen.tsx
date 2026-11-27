"use client";

import { useMemo, useState } from "react";
import { AlertTriangle, CalendarCheck } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { Link } from "@/i18n/routing";
import { Tip } from "@/components/editor/extensions/database-block/row-tip";
import { getCrmAction } from "@/lib/crm/actions";
import { todayIn } from "@/lib/crm/dates";
import type { RelanceItem } from "@/lib/crm/relances";
import { crmTimezone, useCrmRelances } from "@/lib/crm/use-crm-data";
import { useRecordSheet } from "@/components/bases/use-record-sheet";
import type { DbRow } from "@/components/editor/extensions/database-block/types";
import { crmButtonClass } from "../crm-states";
import { DealSheet } from "../fiche/deal-sheet";
import { CrmScreen, type CrmScreenState } from "../shell/crm-screen";
import { ToggleFilter } from "../shell/toggle-filter";
import { RelanceRow, type RowPanel } from "./relance-row";
import { formatRelanceDay } from "./relative-label";
import { RELANCE_HORIZON } from "./relances-model";
import { useRelanceActions } from "./use-relance-actions";

type GroupKey = "late" | "today" | "week";
const GROUPS: GroupKey[] = ["late", "today", "week"];

function AllDealsLink() {
  const t = useTranslations("crm.relances");
  const Icon = getCrmAction("relancesAllDeals").icon;
  return (
    <Tip label={t("allDealsTip")}>
      <Link
        href="/crm/dossiers"
        aria-label={t("allDeals")}
        data-action="relancesAllDeals"
        className={crmButtonClass}
      >
        <Icon className="size-3.5" aria-hidden="true" />
        {t("allDeals")}
      </Link>
    </Tip>
  );
}

export function RelancesScreen() {
  const t = useTranslations("crm.relances");
  const locale = useLocale();
  const [mine, setMine] = useState(true);
  const [panel, setPanel] = useState<{ id: string; kind: RowPanel } | null>(null);
  const { data, error, isLoading, mutate } = useCrmRelances({ horizon: RELANCE_HORIZON, mine });
  const actions = useRelanceActions(mutate);

  // Garde la dernière file affichée pendant le rechargement après un changement de filtre.
  const [shown, setShown] = useState(data);
  if (data && data !== shown) setShown(data);
  const dto = data ?? shown;
  const stale = data === undefined && !!dto && !error;

  let state: CrmScreenState = "ready";
  if (data === undefined && error) state = String((error as Error).message).endsWith("404") ? "notConnected" : "error";
  else if (!dto) state = isLoading || data === undefined ? "loading" : "ready";

  const orderedIds = useMemo(() => (dto ? GROUPS.flatMap((g) => dto.groups[g].map((i) => i.dealId)) : []), [dto]);
  const records = useMemo<DbRow[]>(
    () => orderedIds.map((id, position) => ({ id, databaseId: "", cells: {}, position, createdAt: "", updatedAt: "" })),
    [orderedIds],
  );
  const { openRecord, openRowId, nav, navigate, closeRecord } = useRecordSheet({ rows: records, orderedIds });
  const today = todayIn(new Date(), crmTimezone());
  const canEdit = dto?.canEdit ?? false;
  const writeReason = !canEdit ? t("readOnly") : stale ? t("reloading") : undefined;
  const logReason = writeReason ?? (!dto?.canLog ? t("logUnavailable") : dto.interactionTypes.length === 0 ? t("noTypes") : undefined);
  const total = dto ? GROUPS.reduce((n, g) => n + dto.groups[g].length, 0) : 0;
  const groupLabel: Record<GroupKey, string> = { late: t("groupLate"), today: t("groupToday"), week: t("groupWeek") };

  const row = (item: RelanceItem, late: boolean) => (
    <RelanceRow
      key={item.dealId}
      item={item}
      today={today}
      late={late}
      writeReason={writeReason}
      logReason={logReason}
      onOpen={() => openRecord(item.dealId)}
      interactionTypes={dto?.interactionTypes ?? []}
      panel={panel?.id === item.dealId ? panel.kind : null}
      onPanel={(kind) => setPanel(kind ? { id: item.dealId, kind } : null)}
      onDone={() => void actions.markDone(item)}
      onSnoozeDays={(days) => void actions.snoozeBy(item, days)}
      onSnoozeDate={(date) => {
        setPanel(null);
        void actions.snoozeTo(item, date);
      }}
      onLog={(input) => {
        setPanel(null);
        void actions.log(item, input);
      }}
    />
  );

  return (
    <CrmScreen
      title={t("title")}
      role="dossiers"
      state={state}
      onRetry={() => void mutate()}
      missing={dto?.missing}
      tools={
        <>
          <ToggleFilter
            actionId="relancesMine"
            tip={t("mineTip")}
            pressed={mine && (dto?.mineAvailable ?? true)}
            onToggle={() => setMine((v) => !v)}
            disabledReason={dto && !dto.mineAvailable ? t("mineUnavailable") : undefined}
          />
          <AllDealsLink />
        </>
      }
    >
      {dto && (
        <div
          aria-busy={stale}
          data-stale={stale ? "true" : undefined}
          className={`min-h-0 flex-1 space-y-4 overflow-y-auto p-4 transition-opacity motion-reduce:transition-none ${stale ? "opacity-50" : ""}`}
        >
          {total === 0 && (
            <div className="flex flex-col items-center gap-3 rounded-lg border border-dashed border-border p-6 text-center">
              <CalendarCheck className="size-5 text-muted-foreground" aria-hidden="true" />
              <p className="text-sm font-medium">{t("emptyTitle")}</p>
            </div>
          )}
          {GROUPS.map((g) => {
            const items = dto.groups[g];
            if (items.length === 0) return null;
            const late = g === "late";
            return (
              <section key={g} aria-label={groupLabel[g]} data-group={g} className={late ? "rounded-lg border border-destructive/40" : "rounded-lg border border-border"}>
                <h2 className={`flex items-center gap-1.5 border-b border-border px-3 py-2 text-sm font-semibold ${late ? "text-destructive" : ""}`}>
                  {late && <AlertTriangle className="size-4" aria-hidden="true" />}
                  {groupLabel[g]}
                  <span className="rounded-full bg-muted px-1.5 text-[11px] font-medium tabular-nums text-foreground">{items.length}</span>
                </h2>
                <ul>{items.map((i) => row(i, late))}</ul>
              </section>
            );
          })}
          {dto.tasks.length > 0 && (
            <section aria-label={t("groupTasks")} data-group="tasks" className="rounded-lg border border-border">
              <h2 className="flex items-center gap-1.5 border-b border-border px-3 py-2 text-sm font-semibold">
                {t("groupTasks")}
                <span className="rounded-full bg-muted px-1.5 text-[11px] font-medium tabular-nums">{dto.tasks.length}</span>
              </h2>
              <ul>
                {dto.tasks.map((task) => (
                  <li key={task.id} data-testid="relance-task" className="grid h-10 grid-cols-[minmax(0,2fr)_minmax(0,1.5fr)_7rem] items-center gap-3 border-b border-border px-3 text-xs last:border-b-0">
                    <span className="truncate font-medium">{task.title}</span>
                    <span className="truncate text-muted-foreground">
                      {task.dealTitle}
                      {task.assigneeName ? `, ${task.assigneeName}` : ""}
                    </span>
                    <span className="truncate tabular-nums text-muted-foreground">
                      {task.dueAt ? formatRelanceDay(task.dueAt.slice(0, 10), locale) : ""}
                    </span>
                  </li>
                ))}
              </ul>
            </section>
          )}
        </div>
      )}
      {openRowId && <DealSheet rowId={openRowId} nav={nav} onNavigate={navigate} onClose={closeRecord} />}
    </CrmScreen>
  );
}
