"use client";

import { useRef, type CSSProperties } from "react";
import { GripVertical, Maximize2, Trash2 } from "lucide-react";
import { useDraggable } from "@dnd-kit/core";
import { cn } from "@/lib/utils";
import type { CellValue, DbColumn, DbListItem, DbRow } from "./types";
import type { RelationData } from "./use-relation-data";
import { CellEditor } from "./database-cell-editor";
import { evaluateFormula } from "./formula-evaluator";
import { Tip } from "./row-tip";
import { MOVE_DISABLED_SORTED } from "./use-row-actions";

export const CONTROL_COL_WIDTH = 76;
export const CONTROL_COL_WIDTH_READONLY = 48;
/** Largeur ajoutée à la colonne de contrôles par l'icône « Ouvrir la fiche ». */
export const OPEN_RECORD_EXTRA_WIDTH = 28;

export function controlColWidth(readOnly: boolean, withOpenRecord: boolean): number {
  return (readOnly ? CONTROL_COL_WIDTH_READONLY : CONTROL_COL_WIDTH) + (withOpenRecord ? OPEN_RECORD_EXTRA_WIDTH : 0);
}

// Cibles interactives d'une ligne : un clic dessus n'ouvre pas la fiche.
const INTERACTIVE_SELECTOR =
  "button, a, input, textarea, select, label, [contenteditable], [role=checkbox], [role=button], [data-row-control]";
const EDITABLE_SELECTOR = "input, textarea, select, [contenteditable]";

export type DropPosition = "before" | "after";

interface RowProps {
  row: DbRow;
  index: number;
  columns: DbColumn[];
  allColumns: DbColumn[];
  allDatabases: DbListItem[];
  relationData: RelationData;
  spaceId: string;
  readOnly: boolean;
  selected: boolean;
  anySelected: boolean;
  /** Le déplacement est possible (éditable et vue non triée). */
  canMove: boolean;
  dragging: boolean;
  dropPosition: DropPosition | null;
  style?: CSSProperties;
  onUpdateCell: (rowId: string, columnId: string, value: CellValue) => void;
  onCellKeyDown: (e: React.KeyboardEvent<HTMLTableCellElement>) => void;
  onToggle: (rowId: string, range: boolean) => void;
  onDelete: (rowId: string) => void;
  onMoveStep: (rowId: string, dir: -1 | 1) => void;
  /** Ouvre la fiche de la ligne. Absent : aucune icône, aucun clic de ligne, aucun raccourci. */
  onOpenRecord?: (rowId: string) => void;
  openRecordLabel?: string;
  openRecordKbd?: string;
}

export function DatabaseTableRow({
  row,
  index,
  columns,
  allColumns,
  allDatabases,
  relationData,
  spaceId,
  readOnly,
  selected,
  anySelected,
  canMove,
  dragging,
  dropPosition,
  style,
  onUpdateCell,
  onCellKeyDown,
  onToggle,
  onDelete,
  onMoveStep,
  onOpenRecord,
  openRecordLabel,
  openRecordKbd,
}: RowProps) {
  // Vrai quand le focus était dans un champ au moment de l'appui : ce clic termine une édition.
  const wasEditingRef = useRef(false);
  const { attributes, listeners, setNodeRef } = useDraggable({ id: row.id, disabled: readOnly || !canMove });
  const ctlWidth = controlColWidth(readOnly, !!onOpenRecord);
  const controlsVisible = anySelected
    ? "opacity-100"
    : "opacity-0 group-hover/row:opacity-100 group-focus-within/row:opacity-100";

  return (
    <tr
      className={cn(
        "database-block-tr group/row",
        onOpenRecord && "focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ring",
      )}
      data-row-id={row.id}
      data-selected={selected}
      data-dragging={dragging}
      data-drop={dropPosition ?? undefined}
      aria-selected={readOnly ? undefined : selected}
      style={style}
      tabIndex={onOpenRecord ? 0 : undefined}
      onMouseDownCapture={
        onOpenRecord
          ? () => {
              wasEditingRef.current = !!document.activeElement?.closest(EDITABLE_SELECTOR);
            }
          : undefined
      }
      onKeyDown={
        onOpenRecord
          ? (e) => {
              if (e.key === "Enter" && e.altKey && !e.ctrlKey && !e.metaKey && !e.shiftKey) {
                e.preventDefault();
                e.stopPropagation();
                onOpenRecord(row.id);
              }
            }
          : undefined
      }
      onClick={(e) => {
        const target = e.target as HTMLElement;
        const modified = e.ctrlKey || e.metaKey || e.shiftKey;
        if (!readOnly && !target.closest("[data-row-control]")) {
          if (e.ctrlKey || e.metaKey) onToggle(row.id, false);
          else if (e.shiftKey) onToggle(row.id, true);
        }
        if (!onOpenRecord || modified) return;
        const endedEdit = wasEditingRef.current;
        wasEditingRef.current = false;
        if (endedEdit || anySelected) return;
        if (target.closest(INTERACTIVE_SELECTOR)) return;
        onOpenRecord(row.id);
      }}
    >
      <td className="database-block-td" style={{ width: ctlWidth, minWidth: ctlWidth }} data-row-control>
        <div className="relative flex h-7 items-center justify-end pl-1.5 pr-1">
          <span
            aria-hidden="true"
            className={cn(
              "pointer-events-none absolute inset-0 flex items-center justify-center text-xs tabular-nums text-muted-foreground",
              (!readOnly || onOpenRecord) &&
                (anySelected && !readOnly ? "opacity-0" : "group-hover/row:opacity-0 group-focus-within/row:opacity-0"),
            )}
          >
            {index + 1}
          </span>
          {onOpenRecord && (
            <Tip label={openRecordLabel ?? ""} kbd={openRecordKbd}>
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  onOpenRecord(row.id);
                }}
                aria-label={openRecordLabel}
                className={cn(
                  "inline-flex size-7 items-center justify-center rounded text-muted-foreground transition-opacity hover:bg-accent hover:text-foreground focus-visible:opacity-100 focus-visible:outline-2 focus-visible:outline-ring",
                  controlsVisible,
                )}
              >
                <Maximize2 className="h-3.5 w-3.5" aria-hidden="true" />
              </button>
            </Tip>
          )}
          {!readOnly && (
            <>
              <Tip
                label={canMove ? "Glisser pour déplacer" : MOVE_DISABLED_SORTED}
                kbd={canMove ? "Alt+↑ ↓" : undefined}
              >
                <button
                  type="button"
                  {...(canMove ? attributes : {})}
                  {...(canMove ? listeners : {})}
                  ref={setNodeRef}
                  aria-label={`Déplacer la ligne ${index + 1}`}
                  aria-disabled={!canMove}
                  tabIndex={0}
                  onKeyDown={(e) => {
                    if (e.altKey && (e.key === "ArrowUp" || e.key === "ArrowDown")) {
                      e.preventDefault();
                      e.stopPropagation();
                      onMoveStep(row.id, e.key === "ArrowUp" ? -1 : 1);
                    }
                  }}
                  className={cn(
                    "inline-flex h-6 w-6 touch-none items-center justify-center rounded text-muted-foreground transition-opacity hover:bg-accent hover:text-foreground focus-visible:opacity-100 focus-visible:outline-2 focus-visible:outline-ring",
                    canMove ? "cursor-grab opacity-0 group-hover/row:opacity-100" : "cursor-not-allowed opacity-0 group-hover/row:opacity-45",
                  )}
                >
                  <GripVertical className="h-3.5 w-3.5" aria-hidden="true" />
                </button>
              </Tip>
              <label className={cn("inline-flex h-6 w-6 cursor-pointer items-center justify-center rounded", controlsVisible)}>
                <input
                  type="checkbox"
                  checked={selected}
                  onChange={() => {}}
                  onClick={(e) => onToggle(row.id, e.shiftKey)}
                  aria-label={`Sélectionner la ligne ${index + 1}`}
                  className="h-4 w-4 cursor-pointer accent-[var(--primary)]"
                />
              </label>
            </>
          )}
        </div>
      </td>
      {columns.map((col) => {
        const cellValue =
          col.type === "formula" && col.config?.formula
            ? evaluateFormula(col.config.formula as string, row, allColumns)
            : row.cells?.[col.id];
        return (
          <td
            key={col.id}
            className={`database-block-td${col.config?.wrap ? " database-block-td--wrap" : ""}`}
            data-row-id={row.id}
            data-col-id={col.id}
            onMouseDown={(e) => {
              e.stopPropagation();
              e.nativeEvent.stopImmediatePropagation();
            }}
            onPointerDown={(e) => e.stopPropagation()}
            onMouseDownCapture={(e) => {
              // Pas de focus dans l'éditeur de cellule ni de sélection de texte : le clavier reste sur la grille.
              if (readOnly || !(e.ctrlKey || e.metaKey || e.shiftKey)) return;
              e.preventDefault();
              e.currentTarget.closest<HTMLElement>('[role="application"]')?.focus();
            }}
            onClickCapture={(e) => {
              // Ctrl/Cmd/Maj+clic sur une cellule : sélection de ligne, sans ouvrir l'éditeur de cellule.
              if (readOnly || !(e.ctrlKey || e.metaKey || e.shiftKey)) return;
              e.stopPropagation();
              e.preventDefault();
              onToggle(row.id, !(e.ctrlKey || e.metaKey) && e.shiftKey);
            }}
            onKeyDown={(e) => {
              e.stopPropagation();
              onCellKeyDown(e);
            }}
          >
            <CellEditor
              column={col}
              value={cellValue}
              onChange={(val) => onUpdateCell(row.id, col.id, val)}
              allDatabases={allDatabases}
              relationData={relationData}
              spaceId={spaceId}
              editable={!readOnly}
            />
          </td>
        );
      })}
      {!readOnly && (
        <td className="database-block-td database-block-td--actions">
          <Tip label="Supprimer la ligne">
            <button
              type="button"
              onClick={() => onDelete(row.id)}
              className="rounded p-1 text-muted-foreground opacity-0 transition-opacity hover:bg-accent hover:text-destructive focus-visible:opacity-100 group-hover/row:opacity-100"
              aria-label="Supprimer la ligne"
            >
              <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
            </button>
          </Tip>
        </td>
      )}
    </tr>
  );
}
