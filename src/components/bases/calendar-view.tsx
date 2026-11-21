"use client";

import { useState } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { RecordDialog } from "./record-dialog";
import { useRecordSheet } from "./use-record-sheet";
import { useRowWrites } from "./use-row-writes";
import { useRelationData } from "@/components/editor/extensions/database-block/use-relation-data";
import type { DbColumn, DbRow } from "@/components/editor/extensions/database-block/types";

type RowLike = DbRow;

interface CalendarViewProps {
  columns: DbColumn[];
  rows: DbRow[];
  databaseId: string;
  spaceId: string;
  /** view.config.dateColumnId — colonne date utilisée pour positionner les lignes */
  dateColumnId?: string;
  /** view.config.titleColumnId — colonne servant de libellé d'évènement */
  titleColumnId?: string;
  readOnly?: boolean;
  onConfigChange?: (cfg: { dateColumnId?: string; titleColumnId?: string }) => void;
}

const WEEKDAYS = ["Lun", "Mar", "Mer", "Jeu", "Ven", "Sam", "Dim"];

/**
 * Vue calendrier mensuelle native — pas de dep externe, ~150 LOC.
 * Affiche les lignes positionnées sur leur colonne `date`. Si plusieurs
 * lignes sur le même jour, empile jusqu'à 3 puis « +N ».
 */
export function CalendarView({
  columns,
  rows: serverRows,
  databaseId,
  spaceId,
  dateColumnId,
  titleColumnId,
  readOnly = false,
  onConfigChange,
}: CalendarViewProps) {
  const [month, setMonth] = useState(() => {
    const d = new Date();
    return { y: d.getFullYear(), m: d.getMonth() };
  });

  const { mergedRows: rows, writeCell } = useRowWrites(databaseId, serverRows);
  const relationData = useRelationData(columns);

  const dateColumns = columns.filter((c) => c.type === "date");
  const titleColumns = columns.filter((c) => c.type === "text");

  const effectiveDateColId = dateColumnId ?? dateColumns[0]?.id;
  const effectiveTitleColId = titleColumnId ?? titleColumns[0]?.id ?? columns[0]?.id;

  // Lignes regroupées par yyyy-mm-dd (React Compiler gère la mémoïsation)
  const rowsByDay = (() => {
    const map = new Map<string, RowLike[]>();
    if (!effectiveDateColId) return map;
    for (const r of rows) {
      const raw = r.cells[effectiveDateColId];
      if (!raw) continue;
      const date = new Date(String(raw));
      if (Number.isNaN(date.getTime())) continue;
      const key = ymd(date);
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(r);
    }
    return map;
  })();

  // Flat order (day, then position, same day key as the grid) of every dated row, across months (React Compiler memoizes).
  const orderedIds = (() => {
    const dated: { id: string; day: string; position: number }[] = [];
    if (effectiveDateColId) {
      for (const r of rows) {
        const raw = r.cells[effectiveDateColId];
        if (!raw) continue;
        const date = new Date(String(raw));
        if (Number.isNaN(date.getTime())) continue;
        dated.push({ id: r.id, day: ymd(date), position: r.position });
      }
    }
    dated.sort((a, b) => (a.day < b.day ? -1 : a.day > b.day ? 1 : 0) || a.position - b.position);
    return dated.map((d) => d.id);
  })();
  const { openRow, status, nav, openRecord, closeRecord, navigate } = useRecordSheet({ rows, orderedIds });

  const grid = buildMonthGrid(month.y, month.m);

  function prev() {
    setMonth((m) => (m.m === 0 ? { y: m.y - 1, m: 11 } : { ...m, m: m.m - 1 }));
  }
  function next() {
    setMonth((m) => (m.m === 11 ? { y: m.y + 1, m: 0 } : { ...m, m: m.m + 1 }));
  }
  function today() {
    const d = new Date();
    setMonth({ y: d.getFullYear(), m: d.getMonth() });
  }

  if (dateColumns.length === 0) {
    return (
      <div className="rounded border border-dashed border-neutral-300 p-8 text-center text-sm text-neutral-500 dark:border-neutral-700">
        Pour utiliser la vue calendrier, ajoutez d&apos;abord une colonne de type{" "}
        <strong>date</strong> à votre base.
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col">
      {/* En-tête */}
      <div className="mb-4 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <button
            onClick={prev}
            className="rounded p-1 hover:bg-neutral-100 dark:hover:bg-neutral-800"
            aria-label="Mois précédent"
          >
            <ChevronLeft className="h-4 w-4" />
          </button>
          <h2 className="text-base font-medium tabular-nums">
            {monthLabel(month.y, month.m)}
          </h2>
          <button
            onClick={next}
            className="rounded p-1 hover:bg-neutral-100 dark:hover:bg-neutral-800"
            aria-label="Mois suivant"
          >
            <ChevronRight className="h-4 w-4" />
          </button>
          <button
            onClick={today}
            className="ml-2 rounded border px-2 py-0.5 text-xs hover:bg-neutral-100 dark:hover:bg-neutral-800"
          >
            Aujourd&apos;hui
          </button>
        </div>

        {!readOnly && (
          <div className="flex gap-2 text-xs">
            <label className="flex items-center gap-1">
              Date :
              <select
                value={effectiveDateColId ?? ""}
                onChange={(e) =>
                  onConfigChange?.({
                    dateColumnId: e.target.value,
                    titleColumnId: effectiveTitleColId,
                  })
                }
                className="rounded border bg-transparent px-1 py-0.5"
              >
                {dateColumns.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
            </label>
            <label className="flex items-center gap-1">
              Titre :
              <select
                value={effectiveTitleColId ?? ""}
                onChange={(e) =>
                  onConfigChange?.({
                    dateColumnId: effectiveDateColId,
                    titleColumnId: e.target.value,
                  })
                }
                className="rounded border bg-transparent px-1 py-0.5"
              >
                {columns.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
            </label>
          </div>
        )}
      </div>

      {/* En-têtes jours */}
      <div className="grid grid-cols-7 border-b border-neutral-200 text-center text-xs text-neutral-500 dark:border-neutral-800">
        {WEEKDAYS.map((d) => (
          <div key={d} className="py-1 font-medium">
            {d}
          </div>
        ))}
      </div>

      {/* Grille */}
      <div className="grid flex-1 grid-cols-7 grid-rows-6 gap-px bg-neutral-200 dark:bg-neutral-800">
        {grid.map((cell) => {
          const dayRows = rowsByDay.get(ymd(cell.date)) ?? [];
          const isCurrentMonth = cell.date.getMonth() === month.m;
          const isToday = ymd(cell.date) === ymd(new Date());
          return (
            <div
              key={cell.date.toISOString()}
              className={`min-h-[80px] bg-white p-1 text-xs dark:bg-neutral-950 ${
                isCurrentMonth ? "" : "opacity-40"
              }`}
            >
              <div className="mb-1 flex items-center justify-between">
                <span
                  className={`inline-flex h-5 w-5 items-center justify-center rounded-full text-xs ${
                    isToday
                      ? "bg-blue-500 text-white"
                      : "text-neutral-700 dark:text-neutral-300"
                  }`}
                >
                  {cell.date.getDate()}
                </span>
                {dayRows.length > 3 && (
                  <span className="text-[10px] text-neutral-400">+{dayRows.length - 3}</span>
                )}
              </div>
              <ul className="space-y-0.5">
                {dayRows.slice(0, 3).map((r) => (
                  <li key={r.id}>
                    <button
                      type="button"
                      onClick={() => openRecord(r.id)}
                      title={String(r.cells[effectiveTitleColId ?? ""] ?? "") || "Ouvrir la fiche"}
                      aria-label={`Ouvrir la fiche ${String(r.cells[effectiveTitleColId ?? ""] ?? "") || "sans titre"}`}
                      className="block w-full truncate rounded bg-blue-100 px-1 py-0.5 text-left text-[11px] text-blue-900 hover:bg-blue-200 focus-visible:outline focus-visible:outline-2 focus-visible:outline-blue-500 dark:bg-blue-900/30 dark:text-blue-200 dark:hover:bg-blue-900/50"
                    >
                      {String(r.cells[effectiveTitleColId ?? ""] ?? "") || "(sans titre)"}
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          );
        })}
      </div>

      <RecordDialog
        row={openRow}
        databaseId={databaseId}
        columns={columns}
        spaceId={spaceId}
        relationData={relationData}
        titleColumnId={effectiveTitleColId}
        onWriteCell={writeCell}
        status={status === "closed" ? "ready" : status}
        nav={nav}
        onNavigate={navigate}
        onClose={closeRecord}
      />
    </div>
  );
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

export function ymd(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function monthLabel(y: number, m: number): string {
  const date = new Date(y, m, 1);
  return date.toLocaleDateString("fr-FR", { month: "long", year: "numeric" });
}

/**
 * Construit une grille 6×7 cellules pour un mois donné, en commençant par
 * le lundi de la semaine du 1er du mois. Les jours hors-mois sont inclus
 * (semaine précédente / suivante) pour avoir une grille uniforme.
 */
export function buildMonthGrid(y: number, m: number): { date: Date }[] {
  const first = new Date(y, m, 1);
  // Jour de la semaine du 1er : ISO 1=lundi, 7=dimanche
  const dow = (first.getDay() + 6) % 7; // 0=lundi
  const start = new Date(first);
  start.setDate(1 - dow);

  const cells: { date: Date }[] = [];
  for (let i = 0; i < 42; i++) {
    const d = new Date(start);
    d.setDate(start.getDate() + i);
    cells.push({ date: d });
  }
  return cells;
}
