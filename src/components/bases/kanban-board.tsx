"use client";

import { useMemo, useState } from "react";
import { Columns3, GripVertical, Maximize2, Plus, Loader2, AlertTriangle } from "lucide-react";
import { toast } from "sonner";
import { RecordDialog } from "./record-dialog";
import { useRecordSheet } from "./use-record-sheet";
import { DatabaseDisplayControls } from "@/components/editor/extensions/database-block/database-display-controls";
import { apiPatch, apiPost } from "@/components/editor/extensions/database-block/api";
import { useRelationData } from "@/components/editor/extensions/database-block/use-relation-data";
import { getRelationLabels } from "@/components/editor/extensions/database-block/row-display-name";
import type { CellValue, DbColumn, DbRow } from "@/components/editor/extensions/database-block/types";
import {
  boardTotals,
  laneTotals,
  readAmount,
  resolveTotalsConfig,
  cellsForNewCard,
  groupRowsIntoLanes,
  groupableColumns,
  resolveGroupColumn,
  valueForMove,
} from "@/lib/bases/kanban";
import { resolveRowHeight, resolveVisibleColumns } from "@/lib/bases/view-config";
import { useViewDisplayConfig } from "./use-view-display-config";
import { useKanbanFilterSort } from "./use-kanban-filter-sort";
import { KanbanFilterBar } from "./kanban-filter-bar";
import { applySortAndFilter } from "@/components/editor/extensions/database-block/filter-tree";
import { useLocale, useTranslations } from "next-intl";
import { KanbanLaneHeader, formatAmount } from "./kanban-lane-header";
import { KanbanTotalsBanner } from "./kanban-totals-banner";
import { KanbanTotalsMenu } from "./kanban-totals-menu";
import { useKanbanTotalsConfig } from "./use-kanban-totals-config";
import { useRowWrites } from "./use-row-writes";

interface KanbanBoardProps {
  databaseId: string;
  spaceId: string;
  viewId: string;
  viewConfig: Record<string, unknown>;
  columns: DbColumn[];
  rows: DbRow[];
  onRefresh: () => void;
  viewerId?: string;
  readOnly?: boolean;
}

const btn =
  "inline-flex items-center gap-1.5 rounded px-2 py-1 text-xs text-neutral-600 hover:bg-neutral-100 focus-visible:outline focus-visible:outline-2 focus-visible:outline-blue-500 disabled:opacity-50 dark:text-neutral-300 dark:hover:bg-neutral-800";

export function KanbanBoard({ databaseId, spaceId, viewId, viewConfig, columns, rows, onRefresh, viewerId, readOnly = false }: KanbanBoardProps) {
  const t = useTranslations("basesTotals");
  const locale = useLocale();
  const [dragOver, setDragOver] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { display, changeDisplay } = useViewDisplayConfig(databaseId, viewId, viewConfig);

  // Même préchargement des bases cibles que la vue tableau (libellés des relations).
  const relationData = useRelationData(columns);

  // Optimistic cell writes shared with the other views (PATCH /rows triggers automations).
  const { mergedRows, writeCell } = useRowWrites(databaseId, rows);

  const filter = useKanbanFilterSort({ databaseId, viewId, viewConfig, viewerId });
  const { sorts, filterTree, ctx } = filter;
  const shown = useMemo(
    () => applySortAndFilter(mergedRows, columns, sorts, filterTree, ctx),
    [mergedRows, columns, sorts, filterTree, ctx],
  );

  const groupColumn = resolveGroupColumn(columns, viewConfig);
  const lanes = useMemo(
    () => (groupColumn ? groupRowsIntoLanes(groupColumn, shown) : []),
    [groupColumn, shown],
  );
  // Totaux calculés sur les cartes affichées (filtrées) ; cfg utilisé tel que renvoyé (amountOf des formules).
  const totals = useKanbanTotalsConfig({ databaseId, viewId, viewConfig });
  const totalsResolution = useMemo(
    () => resolveTotalsConfig(columns, { kanbanTotals: totals.config }),
    [columns, totals.config],
  );
  const totalsCfg = totalsResolution.active;
  const laneStats = useMemo(
    () => (totalsCfg ? lanes.map((l) => laneTotals(l, totalsCfg)) : null),
    [lanes, totalsCfg],
  );
  const bannerStats = useMemo(
    () => (totalsCfg ? boardTotals(lanes, totalsCfg) : null),
    [lanes, totalsCfg],
  );
  const orderedIds = useMemo(
    // A row can sit in several lanes (multi-select group column): keep its first position only.
    () => Array.from(new Set(lanes.flatMap((l) => l.rows.map((r) => r.id)))),
    [lanes],
  );
  const { openRow, status, nav, openRecord, closeRecord, navigate } = useRecordSheet({ rows: mergedRows, orderedIds });

  async function moveCard(rowId: string, from: string, to: string) {
    if (!groupColumn) return;
    const row = mergedRows.find((r) => r.id === rowId);
    if (!row) return;
    const current = row.cells[groupColumn.id];
    const next = valueForMove(groupColumn, current, from, to);
    if (next === undefined) return;
    const ok = await writeCell(rowId, groupColumn.id, next as CellValue);
    if (!ok) return;
    toast.success(`Carte déplacée vers « ${to || "Sans valeur"} »`, {
      action: {
        label: "Annuler",
        onClick: async () => {
          if (await writeCell(rowId, groupColumn.id, (current ?? null) as CellValue)) {
            toast.success("Déplacement annulé");
            onRefresh();
          }
        },
      },
    });
    onRefresh();
  }

  async function addCard(lane: string) {
    if (!groupColumn) return;
    setBusy(true);
    try {
      await apiPost(`/api/databases/${databaseId}/rows`, { cells: cellsForNewCard(groupColumn, lane) });
      toast.success(`Carte créée dans « ${lane || "Sans valeur"} »`);
      onRefresh();
    } catch {
      toast.error("Échec de la création de la carte");
    } finally {
      setBusy(false);
    }
  }

  async function setGroupColumn(columnId: string) {
    setBusy(true);
    setError(null);
    try {
      await apiPatch(`/api/databases/${databaseId}/views/${viewId}`, {
        config: { groupByColumnId: columnId, version: "v1" },
      });
      toast.success("Colonne de regroupement enregistrée");
      onRefresh();
    } catch {
      setError("Impossible d'enregistrer la colonne de regroupement.");
      toast.error("Impossible d'enregistrer la colonne de regroupement");
    } finally {
      setBusy(false);
    }
  }

  async function createStatusColumn() {
    setBusy(true);
    setError(null);
    try {
      const col = await apiPost<{ id: string }>(`/api/databases/${databaseId}/columns`, {
        name: "Statut",
        type: "select",
        config: { options: ["À faire", "En cours", "Terminé"] },
      });
      toast.success("Colonne « Statut » créée");
      await setGroupColumn(col.id);
    } catch {
      setBusy(false);
      setError("Impossible de créer la colonne Statut.");
      toast.error("Impossible de créer la colonne Statut");
    }
  }

  // ── État vide : pas de colonne de regroupement configurée ──
  if (!groupColumn) {
    const candidates = groupableColumns(columns);
    return (
      <div className="flex flex-1 items-center justify-center p-6" data-testid="kanban-empty">
        <div className="w-full max-w-sm rounded-lg border border-dashed border-neutral-300 p-6 text-center dark:border-neutral-700">
          <Columns3 className="mx-auto mb-2 h-6 w-6 text-neutral-400" aria-hidden />
          <h2 className="text-sm font-medium">Choisir la colonne de regroupement</h2>
          {candidates.length > 0 ? (
            <>
              <p className="mt-1 text-xs text-neutral-500">Les cartes sont rangées par valeur de cette colonne.</p>
              <div className="mt-3 flex flex-col gap-1.5">
                {candidates.map((c) => (
                  <button
                    key={c.id}
                    type="button"
                    disabled={busy}
                    onClick={() => setGroupColumn(c.id)}
                    title={`Regrouper par « ${c.name} »`}
                    aria-label={`Regrouper par ${c.name}`}
                    className={`${btn} justify-center border border-neutral-200 dark:border-neutral-700`}
                  >
                    <Columns3 className="h-3.5 w-3.5" aria-hidden />
                    {c.name}
                  </button>
                ))}
              </div>
            </>
          ) : (
            <>
              <p className="mt-1 text-xs text-neutral-500">Cette table n&apos;a aucune colonne de type Choix.</p>
              <button
                type="button"
                disabled={busy}
                onClick={createStatusColumn}
                title="Créer une colonne Statut (À faire, En cours, Terminé) et regrouper dessus"
                aria-label="Créer une colonne Statut"
                className={`${btn} mt-3 border border-neutral-200 dark:border-neutral-700`}
              >
                {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden /> : <Plus className="h-3.5 w-3.5" aria-hidden />}
                Créer une colonne Statut
              </button>
            </>
          )}
          {error && (
            <p role="alert" className="mt-3 flex items-center justify-center gap-1.5 text-xs text-red-600 dark:text-red-400">
              <AlertTriangle className="h-3.5 w-3.5" aria-hidden />
              {error}
            </p>
          )}
        </div>
      </div>
    );
  }

  const titleColumn = columns.find((c) => c.id !== groupColumn.id && (c.type === "text" || c.type === "autonumber")) ?? columns.find((c) => c.id !== groupColumn.id);
  const visibleColumns = resolveVisibleColumns(columns, display);
  const rowHeight = resolveRowHeight(display);

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex items-center gap-2 border-b border-neutral-200 px-3 py-1.5 text-xs text-neutral-500 dark:border-neutral-800">
        <Columns3 className="h-3.5 w-3.5" aria-hidden />
        <span>Regroupé par</span>
        <select
          aria-label="Colonne de regroupement"
          title="Colonne de regroupement"
          value={groupColumn.id}
          disabled={busy}
          onChange={(e) => setGroupColumn(e.target.value)}
          className="rounded border border-neutral-200 bg-transparent px-1.5 py-0.5 text-xs dark:border-neutral-700"
        >
          {groupableColumns(columns).map((c) => (
            <option key={c.id} value={c.id} className="text-neutral-900">{c.name}</option>
          ))}
        </select>
        {busy && <Loader2 className="h-3.5 w-3.5 animate-spin" aria-label="Chargement" />}
        <div className="ml-auto flex items-center gap-1">
          <KanbanFilterBar columns={columns} filter={filter} readOnly={readOnly} />
          <KanbanTotalsMenu
            columns={columns}
            lanes={lanes}
            groupColumn={groupColumn}
            config={totals.config}
            reason={totalsResolution.active ? null : totalsResolution.reason}
            readOnly={readOnly}
            onChange={(next) => void totals.update(next)}
          />
          <DatabaseDisplayControls columns={columns} config={display} onChange={(n) => void changeDisplay(n)} />
        </div>
      </div>

      {totalsCfg && bannerStats && laneStats && (
        <KanbanTotalsBanner
          totals={bannerStats}
          showWeighted={totalsCfg.showWeighted}
          currency={totalsCfg.currency}
          locale={locale}
        />
      )}

      <div className="flex min-h-0 flex-1 gap-3 overflow-x-auto p-3" data-testid="kanban-board" data-row-height={rowHeight}>
        {lanes.map((lane, laneIndex) => (
          <section
            key={lane.key || "__none"}
            aria-label={lane.key || t("noValue")}
            onDragOver={(e) => { e.preventDefault(); setDragOver(lane.key); }}
            onDragLeave={() => setDragOver((d) => (d === lane.key ? null : d))}
            onDrop={(e) => {
              e.preventDefault();
              setDragOver(null);
              const raw = e.dataTransfer.getData("application/x-kanban-card");
              if (!raw) return;
              const { rowId, from } = JSON.parse(raw) as { rowId: string; from: string };
              void moveCard(rowId, from, lane.key);
            }}
            className={`flex w-64 shrink-0 flex-col rounded-lg bg-neutral-100/70 p-2 dark:bg-neutral-900/60 ${dragOver === lane.key ? "ring-2 ring-blue-500" : ""}`}
          >
            <KanbanLaneHeader
              laneKey={lane.key}
              totals={laneStats ? laneStats[laneIndex] : null}
              weight={totalsCfg ? (Object.prototype.hasOwnProperty.call(totalsCfg.weights, lane.key) ? totalsCfg.weights[lane.key] : 0) : null}
              closed={!!totalsCfg && lane.key !== "" && totalsCfg.closedLanes.includes(lane.key)}
              showWeighted={!!totalsCfg?.showWeighted}
              currency={totalsCfg?.currency ?? "EUR"}
              locale={locale}
              onAdd={() => void addCard(lane.key)}
              busy={busy}
              count={lane.rows.length}
            />
            <div className="flex flex-1 flex-col gap-1.5 overflow-y-auto">
              {lane.rows.map((row) => {
                const title = titleColumn ? String(row.cells[titleColumn.id] ?? "") : "";
                const details = visibleColumns
                  .filter((c) => c.id !== groupColumn.id && c.id !== titleColumn?.id && c.id !== totalsCfg?.amountColumnId)
                  .map((c) => ({ c, v: row.cells[c.id] }))
                  .filter(({ v }) => v != null && v !== "" && !(Array.isArray(v) && v.length === 0))
                  .slice(0, rowHeight === "tall" ? 6 : 3);
                return (
                  <article
                    key={row.id}
                    draggable
                    onDragStart={(e) => {
                      e.dataTransfer.setData("application/x-kanban-card", JSON.stringify({ rowId: row.id, from: lane.key }));
                      e.dataTransfer.effectAllowed = "move";
                    }}
                    tabIndex={0}
                    onClick={(e) => {
                      if ((e.target as HTMLElement).closest("button, a, input, select, textarea, [role=checkbox]")) return;
                      openRecord(row.id);
                    }}
                    onKeyDown={(e) => {
                      if (e.target === e.currentTarget && e.key === "Enter") { e.preventDefault(); openRecord(row.id); }
                    }}
                    className={`kanban-card kanban-card--${rowHeight} group cursor-grab rounded-md border border-neutral-200 bg-white p-2.5 text-xs shadow-sm hover:border-blue-400 dark:border-neutral-700 dark:bg-neutral-900 focus-visible:outline focus-visible:outline-2 focus-visible:outline-blue-500`}
                  >
                    <div className="flex items-start gap-1">
                      <GripVertical className="mt-0.5 h-3.5 w-3.5 shrink-0 text-neutral-400" aria-hidden />
                      <span className="min-w-0 flex-1 truncate font-medium">{title || "Sans titre"}</span>
                      <button
                        type="button"
                        onClick={() => openRecord(row.id)}
                        title="Ouvrir la fiche"
                        aria-label={`Ouvrir la fiche ${title || "Sans titre"}`}
                        className={`${btn} -my-1 px-1`}
                      >
                        <Maximize2 className="h-3.5 w-3.5" aria-hidden />
                      </button>
                    </div>
                    {details.map(({ c, v }) => (
                      <div key={c.id} className="mt-1 flex gap-1.5 pl-5">
                        <span className="shrink-0 text-neutral-500">{c.name} :</span>
                        <span className="kanban-card-value">
                          {c.type === "checkbox"
                            ? v ? "Oui" : "Non"
                            : c.type === "relation"
                              ? getRelationLabels(v, relationData[c.config?.targetDatabaseId ?? ""]).join(", ")
                              : String(v)}
                        </span>
                      </div>
                    ))}
                    {totalsCfg && (() => {
                      const amount = readAmount(totalsCfg.amountOf ? totalsCfg.amountOf(row) : row.cells[totalsCfg.amountColumnId]);
                      return amount === null ? (
                        <div className="mt-1 pl-5 italic text-neutral-500" data-testid="kanban-card-unpriced">{t("unpriced")}</div>
                      ) : (
                        <div className="mt-1 pl-5 font-semibold tabular-nums" data-testid="kanban-card-amount">
                          {formatAmount(amount, totalsCfg.currency, locale)}
                        </div>
                      );
                    })()}
                  </article>
                );
              })}
              {lane.rows.length === 0 && (
                <div className="rounded border border-dashed border-neutral-300 py-4 text-center text-xs text-neutral-500 dark:border-neutral-700">
                  {t("emptyLane")}
                </div>
              )}
            </div>
          </section>
        ))}
      </div>

      <RecordDialog
        row={openRow}
        databaseId={databaseId}
        columns={columns}
        spaceId={spaceId}
        relationData={relationData}
        titleColumnId={titleColumn?.id}
        onWriteCell={writeCell}
        status={status === "closed" ? "ready" : status}
        nav={nav}
        onNavigate={navigate}
        onClose={closeRecord}
      />
    </div>
  );
}
