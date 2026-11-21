"use client";

import type { Dispatch, SetStateAction } from "react";
import { ChevronDown, ChevronUp, Plus, X } from "lucide-react";
import type { DbColumn, SortConfig } from "@/components/editor/extensions/database-block/types";

/** Panneau de classement multi-colonnes (priorité du haut vers le bas), partagé par la grille et le kanban. */
export function SortPanel({
  sorts,
  setSorts,
  columns,
  className = "flex flex-col gap-2 px-3 py-2 border-b border-border bg-muted/20",
}: {
  sorts: SortConfig[];
  setSorts: Dispatch<SetStateAction<SortConfig[]>>;
  columns: DbColumn[];
  className?: string;
}) {
  const updateSort = (index: number, patch: Partial<SortConfig>) =>
    setSorts((prev) => prev.map((s, i) => (i === index ? { ...s, ...patch } : s)));
  const removeSort = (index: number) => setSorts((prev) => prev.filter((_, i) => i !== index));
  const addSort = (columnId: string) =>
    setSorts((prev) => (prev.some((s) => s.columnId === columnId) ? prev : [...prev, { columnId, direction: "asc" }]));
  const moveSort = (index: number, direction: -1 | 1) =>
    setSorts((prev) => {
      const next = [...prev];
      const target = index + direction;
      if (target < 0 || target >= next.length) return prev;
      [next[index], next[target]] = [next[target], next[index]];
      return next;
    });

  const available = columns.filter((c) => !sorts.some((s) => s.columnId === c.id));

  return (
    <div className={className}>
      {sorts.length === 0 && <p className="text-xs text-muted-foreground">Aucun classement actif.</p>}
      {sorts.map((sort, idx) => {
        const usedIds = new Set(sorts.filter((_, i) => i !== idx).map((s) => s.columnId));
        return (
          <div key={`${sort.columnId}-${idx}`} className="flex items-center gap-2 flex-wrap">
            <span className="text-[10px] text-muted-foreground w-4 text-right shrink-0">{idx + 1}.</span>
            <select
              value={sort.columnId}
              onChange={(e) => updateSort(idx, { columnId: e.target.value })}
              className="text-xs px-2 py-1 rounded border bg-background"
            >
              {columns.map((col) => (
                <option key={col.id} value={col.id} disabled={usedIds.has(col.id)}>
                  {col.name}
                </option>
              ))}
            </select>
            <select
              value={sort.direction}
              onChange={(e) => updateSort(idx, { direction: e.target.value as "asc" | "desc" })}
              className="text-xs px-2 py-1 rounded border bg-background"
            >
              <option value="asc">A → Z</option>
              <option value="desc">Z → A</option>
            </select>
            <button
              onClick={() => moveSort(idx, -1)}
              disabled={idx === 0}
              className="p-1 rounded hover:bg-muted disabled:opacity-30"
              title="Monter la priorité"
              aria-label="Augmenter la priorité de ce classement"
            >
              <ChevronUp className="h-3 w-3" />
            </button>
            <button
              onClick={() => moveSort(idx, 1)}
              disabled={idx === sorts.length - 1}
              className="p-1 rounded hover:bg-muted disabled:opacity-30"
              title="Descendre la priorité"
              aria-label="Diminuer la priorité de ce classement"
            >
              <ChevronDown className="h-3 w-3" />
            </button>
            <button
              onClick={() => removeSort(idx)}
              className="p-1 rounded hover:bg-muted text-destructive"
              title="Supprimer ce classement"
              aria-label="Supprimer ce classement"
            >
              <X className="h-3 w-3" />
            </button>
          </div>
        );
      })}
      <div className="flex items-center gap-2">
        <button
          onClick={() => {
            if (available[0]) addSort(available[0].id);
          }}
          disabled={available.length === 0}
          className="text-xs px-2 py-1 rounded border bg-background hover:bg-muted disabled:opacity-40 inline-flex items-center gap-1"
        >
          <Plus className="h-3 w-3" /> Ajouter un classement
        </button>
        {sorts.length > 0 && (
          <button onClick={() => setSorts([])} className="text-xs text-destructive hover:underline ml-auto">
            Tout effacer
          </button>
        )}
      </div>
    </div>
  );
}
