"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { toast } from "sonner";
import { KanbanTotalsBanner } from "@/components/bases/kanban-totals-banner";
import { useRecordSheet } from "@/components/bases/use-record-sheet";
import { useRowWrites } from "@/components/bases/use-row-writes";
import type { CellValue, DbRow } from "@/components/editor/extensions/database-block/types";
import { todayIn } from "@/lib/crm/dates";
import { crmTimezone, refreshCrmData, useCrmPipeline } from "@/lib/crm/use-crm-data";
import { DealSheet } from "../fiche/deal-sheet";
import { CrmScreen, type CrmScreenState } from "../shell/crm-screen";
import { useRoleSource } from "../shell/use-role-source";
import { buildBoard, moveCard, statusPatchFor } from "./pipeline-model";
import { PipelineLane } from "./pipeline-lane";
import { PipelineToolbar } from "./pipeline-toolbar";
import { usePipelineDrag } from "./use-pipeline-drag";

const NO_ROWS: DbRow[] = [];

/** Voie courante d'un dossier : son statut s'il figure parmi les voies, sinon la voie vide. */
function laneKeyOf(lanes: { key: string }[], status: string | null): string {
  return status !== null && status !== "" && lanes.some((l) => l.key === status) ? status : "";
}

export function PipelineScreen() {
  const t = useTranslations("crm");
  const tTotals = useTranslations("basesTotals");
  const locale = useLocale();
  const [mine, setMine] = useState(true);
  const [late, setLate] = useState(false);
  const [ownerId, setOwnerId] = useState<string | null>(null);
  const [weighted, setWeighted] = useState(false);

  const { data, error, isLoading, mutate } = useCrmPipeline({ mine, late, ownerId });
  const source = useRoleSource("dossiers");

  // Garde le dernier pipeline affiché pendant le rechargement après un changement de filtre.
  const [shown, setShown] = useState(data);
  if (data && data !== shown) setShown(data);
  const dto = data ?? shown;

  // Invariant : latest.current vaut le cache SWR de la clé courante (undefined pendant son chargement) ;
  // move() ne s'en sert que si défini, et les déplacements sont désactivés tant que data est indéfini.
  const latest = useRef(data);
  useEffect(() => {
    latest.current = data;
  }, [data]);
  const pending = useRef(0);
  // Les actions des toasts (Annuler, Réessayer) rappellent la dernière version de move.
  const moveRef = useRef<(dealId: string, laneKey: string, undo?: boolean) => Promise<boolean>>(async () => false);

  // Source unique d'optimisme : le cache SWR du Pipeline (moveCard) ; useRowWrites ne sert qu'au PATCH.
  const { writeCell } = useRowWrites(dto?.databaseId ?? "", NO_ROWS);

  const board = useMemo(
    () => (dto ? buildBoard(
            dto,
            { mine: false, late: false, ownerId: null, weighted },
            "",
            todayIn(new Date(), crmTimezone()),
            tTotals("noValue"),
          ) : null),
    // Les filtres mine, late et responsable sont appliqués côté serveur (clé de requête).
    [dto, weighted, tTotals],
  );

  const records = useMemo<DbRow[]>(
    () =>
      (dto?.deals ?? []).map((d, i) => ({
        id: d.id,
        databaseId: dto?.databaseId ?? "",
        cells: d.cells as Record<string, CellValue>,
        position: i,
        createdAt: "",
        updatedAt: "",
      })),
    [dto],
  );
  const { openRecord, openRowId, nav, navigate, closeRecord } = useRecordSheet({ rows: records, orderedIds: board?.visibleIds ?? [] });

  const canEdit = dto?.canEdit ?? false;
  const move = useCallback(
    async (dealId: string, laneKey: string, undo = false): Promise<boolean> => {
      const current = latest.current;
      if (!current || !current.canEdit || current.statusColumnId === null) return false;
      const next = moveCard(current, dealId, laneKey);
      if (next === current) return false; // sans effet : aucun PATCH
      const deal = current.deals.find((d) => d.id === dealId);
      if (!deal) return false;
      const from = laneKeyOf(current.lanes, deal.status);
      const laneLabel = (key: string) => current.lanes.find((l) => l.key === key)?.label || tTotals("noValue");
      const title = deal.title;

      latest.current = next;
      await mutate(next, { revalidate: false });
      pending.current += 1;
      const { columnId, value } = statusPatchFor(current, laneKey);
      if (columnId === null) return false; // jamais d'écriture sans colonne Statut
      const ok = await writeCell(dealId, columnId, value as CellValue, { silent: true });
      pending.current -= 1;

      if (ok) {
        if (undo) toast.success(t("pipeline.undone"));
        else
          toast.success(t("pipeline.moved", { title, lane: laneLabel(laneKey) }), {
            action: { label: t("pipeline.undo"), onClick: () => void moveRef.current(dealId, from, true) },
          });
        if (pending.current === 0) void refreshCrmData();
        return true;
      }
      // Échec : la carte revient dans sa voie d'origine (sans toucher aux autres déplacements en cours).
      const rollback = (cur: typeof current | undefined) => (cur ? moveCard(cur, dealId, from) : cur);
      latest.current = rollback(latest.current);
      await mutate(rollback, { revalidate: false });
      if (undo) toast.error(t("pipeline.undoError"));
      else
        toast.error(t("pipeline.moveError", { title, lane: laneLabel(from) }), {
          action: { label: t("pipeline.retry"), onClick: () => void moveRef.current(dealId, laneKey) },
        });
      return false;
    },
    [mutate, t, tTotals, writeCell],
  );

  useEffect(() => {
    moveRef.current = move;
  }, [move]);

  let state: CrmScreenState = "ready";
  if (data === undefined && error) state = String((error as Error).message).endsWith("404") ? "notConnected" : "error";
  else if (!dto) state = isLoading || data === undefined ? "loading" : "ready";

  // Rechargement après changement de filtre : le dernier tableau reste visible mais n'est plus à jour.
  const stale = data === undefined && !!dto && !error;
  const statusMissing = !!dto && dto.statusColumnId === null;
  const moveDisabledReason = statusMissing
    ? t("pipeline.moveNoStatus")
    : !canEdit ? t("pipeline.moveReadOnly") : stale ? t("pipeline.moveReloading") : undefined;
  const drag = usePipelineDrag({ onMove: move, disabled: !canEdit || stale });
  const announcement = (() => {
    const res = drag.result;
    const deal = res ? dto?.deals.find((d) => d.id === res.dealId) : undefined;
    if (!res || !dto || !deal) return "";
    const label = (key: string) => dto.lanes.find((l) => l.key === key)?.label || tTotals("noValue");
    return res.ok
      ? t("pipeline.moved", { title: deal.title, lane: label(res.laneKey) })
      : t("pipeline.moveError", { title: deal.title, lane: label(laneKeyOf(dto.lanes, deal.status)) });
  })();
  const weightedAvailable = !!board?.banner && dto?.totalsViewId !== null;
  const currency = dto?.totals?.currency ?? "EUR";
  const showWeighted = weighted && weightedAvailable;
  const sourceName = source.status === "connected" ? source.databaseName : "";

  return (
    <CrmScreen
      title={t("pipeline.title")}
      role="dossiers"
      state={state}
      onRetry={() => void mutate()}
      missing={dto?.missing}
      tools={
        <PipelineToolbar
          mine={mine}
          late={late}
          weighted={weighted}
          ownerId={ownerId}
          owners={dto?.owners ?? []}
          mineAvailable={dto?.mineAvailable ?? true}
          lateAvailable={dto?.lateAvailable ?? true}
          weightedAvailable={weightedAvailable}
          databaseId={dto?.databaseId ?? null}
          viewId={dto?.totalsViewId ?? null}
          spaceId={dto?.spaceId ?? null}
          databaseName={sourceName}
          onMine={() => setMine((v) => !v)}
          onLate={() => setLate((v) => !v)}
          onWeighted={() => setWeighted((v) => !v)}
          onOwner={setOwnerId}
        />
      }
    >
      {board && (
        <>
          {board.banner && !stale && (
            <KanbanTotalsBanner totals={board.banner} showWeighted={showWeighted} currency={currency} locale={locale} />
          )}
          <div
            role="list"
            aria-label={t("pipeline.boardAria")}
            aria-busy={stale}
            data-stale={stale ? "true" : undefined}
            className={`flex min-h-0 flex-1 gap-3 overflow-x-auto p-3 transition-opacity ${stale ? "opacity-50" : ""}`}
          >
            {board.lanes.map((lane) => (
              <PipelineLane
                key={lane.key}
                lane={lane}
                lanes={board.lanes.map((l) => ({ key: l.key, label: l.label }))}
                showWeighted={showWeighted}
                currency={currency}
                moveDisabledReason={moveDisabledReason}
                onOpen={openRecord}
                onMove={(id, key) => void move(id, key)}
                drag={drag}
              />
            ))}
          </div>
          <div role="status" aria-live="polite" aria-label={t("pipeline.dragAnnounceLabel")} className="sr-only">
            {announcement}
          </div>
        </>
      )}
      {openRowId && <DealSheet rowId={openRowId} nav={nav} onNavigate={navigate} onClose={closeRecord} />}
    </CrmScreen>
  );
}
