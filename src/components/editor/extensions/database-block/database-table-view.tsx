"use client";

import { useState, useEffect, useMemo, useRef } from "react";
import { toast } from "sonner";
import {
  Plus,
  ArrowUp,
  ArrowDown,
} from "lucide-react";
import { useVirtualizer } from "@tanstack/react-virtual";
import {
  DndContext,
  DragOverlay,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragMoveEvent,
  type DragStartEvent,
} from "@dnd-kit/core";
import type { DbData, ViewMode, ColumnConfig, CellValue } from "./types";
import { COLUMN_TYPE_ICONS } from "./constants";
import { FilterBuilder } from "./filter-builder";
import { operatorsExcludedFor, type FilterContext } from "./filter-tree";
import { describePairing } from "./relation-pairing";
import { ColumnHeaderMenu, AddColumnMenu, PairingBadge, type ColumnHeaderMenuHandle } from "./database-column-header";
import { KanbanView } from "./database-kanban-view";
import { GalleryView } from "./database-gallery-view";
import { DatabaseToolbar } from "./database-toolbar";
import { CsvImportModal } from "./database-import-modal";
import { useDatabaseData, type ViewPersistence } from "./use-database-data";
import { DatabaseTableRow, controlColWidth, type DropPosition } from "./database-table-row";
import { SelectionBar } from "./selection-bar";
import { Tip } from "./row-tip";
import { SortPanel } from "@/components/bases/sort-panel";
import { useRowActions } from "./use-row-actions";
import { dropBeforeId, headerCheckState, movingIdsFor } from "@/lib/bases/row-selection";
import { apiPatch } from "./api";
import { DatabaseDisplayControls } from "./database-display-controls";
import { resolveRowHeight, resolveVisibleColumns } from "@/lib/bases/view-config";

// ─── Database Table ──────────────────────────────────────────────────────────

export function DatabaseTable({
  data,
  spaceId,
  onRefresh,
  viewMode,
  onViewModeChange,
  viewModeDisabledReasons,
  fillHeight = false,
  viewPersistence,
  readOnly = false,
  onOpenRecord,
  openRecordLabel,
  openRecordKbd,
  onDisplayedIdsChange,
  writeCell,
  rowsResetKey,
  evalContext,
}: {
  data: DbData;
  spaceId: string;
  onRefresh: () => void;
  viewMode: ViewMode;
  onViewModeChange: (mode: ViewMode) => void;
  viewModeDisabledReasons?: Partial<Record<ViewMode, string>>;
  // Quand true, le tableau occupe toute la hauteur du parent (cas page /bases),
  // sinon il garde le cap inline (~500px) hérité du bloc TipTap.
  fillHeight?: boolean;
  viewPersistence?: ViewPersistence;
  // Base liée en lecture seule : on garde tri/filtre/vues mais on désactive
  // toute mutation de la base source (cellules, lignes, colonnes, import, sync).
  readOnly?: boolean;
  // Fiche latérale (page /bases uniquement) : sans onOpenRecord, la grille ne change pas.
  onOpenRecord?: (rowId: string) => void;
  openRecordLabel?: string;
  openRecordKbd?: string;
  // Ids affichés dans l'ordre de la grille (tri et filtres appliqués), appelé quand la liste change.
  onDisplayedIdsChange?: (ids: string[]) => void;
  // Écriture de cellule partagée avec la fiche latérale (remplace le PATCH direct).
  writeCell?: (rowId: string, columnId: string, value: CellValue) => Promise<boolean>;
  // Réinitialise l'état optimiste de la grille seulement quand cette valeur change (données serveur).
  rowsResetKey?: unknown;
  // Contexte d'évaluation des filtres relatifs (est moi, ce trimestre) ; sans lui, comportement inchangé.
  evalContext?: FilterContext;
}) {
  const {
    columns: allColumns,
    displayConfig,
    setDisplayConfig,
    displayPersisted,
    allDatabases,
    relationData,
    sorts,
    setSorts,
    filterTree,
    setFilterTree,
    clearFilters,
    activeFilterCount,
    showFilters,
    setShowFilters,
    showImport,
    setShowImport,
    updateCell,
    addRow,
    baseRows,
    mutateRows,
    setRowsOverride,
    addColumn,
    updateColumn,
    deleteColumn,
    toggleSort,
    filteredRows,
    rows,
  } = useDatabaseData(data, spaceId, onRefresh, viewPersistence, {
    writeCell,
    resetKey: rowsResetKey,
    evalContext,
  });

  const canEdit = !readOnly;
  // Déplacer une ligne n'a de sens que dans l'ordre naturel de la base.
  const canMove = canEdit && sorts.length === 0;
  const {
    selected,
    selectedIds,
    visibleIds,
    clearSelection,
    toggleAll,
    toggleRow,
    deleteRows,
    duplicateRows,
    moveRows,
    moveStep,
    onGridKeyDown,
  } = useRowActions({
    databaseId: data.id,
    baseRows,
    visibleRows: filteredRows,
    mutateRows,
    setRowsOverride,
    onRefresh,
    canEdit,
    canMove,
  });
  const displayedIds = useMemo(() => Array.from(new Set(filteredRows.map((r) => r.id))), [filteredRows]);
  const displayedKey = displayedIds.join("|");
  const reportedKeyRef = useRef<string | null>(null);
  useEffect(() => {
    if (!onDisplayedIdsChange || reportedKeyRef.current === displayedKey) return;
    reportedKeyRef.current = displayedKey;
    onDisplayedIdsChange(displayedIds);
  }, [onDisplayedIdsChange, displayedKey, displayedIds]);
  const headerState = headerCheckState(selectedIds.length, filteredRows.length);

  // Glisser-déposer des lignes : la cible est calculée depuis la position du
  // pointeur sur les lignes réellement rendues (compatible virtualisation).
  const [drag, setDrag] = useState<{ ids: string[]; drop: { rowId: string; before: boolean } | null } | null>(null);
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }));

  // Colonnes affichées dans la vue Tableau (visibilité + ordre par vue).
  const columns = useMemo(() => resolveVisibleColumns(allColumns, displayConfig), [allColumns, displayConfig]);
  const rowHeight = resolveRowHeight(displayConfig);

  const [showSort, setShowSort] = useState(false);
  const [resizing, setResizing] = useState<{ colId: string; startX: number; startWidth: number } | null>(null);
  const tableContainerRef = useRef<HTMLDivElement>(null);
  const colMenuRefs = useRef<Record<string, React.RefObject<ColumnHeaderMenuHandle | null>>>({});

  // Navigation clavier dans les cellules :
  // Entrée = valider et descendre, ↑/↓ = changer de ligne, Tab = colonne suivante (natif).
  const handleCellKeyDown = (e: React.KeyboardEvent<HTMLTableCellElement>) => {
    const target = e.target as HTMLElement;
    if (!target || (target.tagName !== "INPUT" && target.tagName !== "TEXTAREA" && target.tagName !== "SELECT")) return;
    if (e.key !== "Enter" && e.key !== "ArrowUp" && e.key !== "ArrowDown") return;
    // Pour textarea : Entrée seule = nouvelle ligne ; Ctrl/Cmd+Entrée = valider
    if (target.tagName === "TEXTAREA" && e.key === "Enter" && !(e.ctrlKey || e.metaKey)) return;
    const td = (target.closest("td[data-row-id]") as HTMLTableCellElement | null);
    if (!td) return;
    const rowId = td.getAttribute("data-row-id");
    const colId = td.getAttribute("data-col-id");
    if (!rowId || !colId) return;
    const direction = e.key === "ArrowUp" ? -1 : 1;
    const rowIds = filteredRows.map((r) => r.id);
    const currentIdx = rowIds.indexOf(rowId);
    if (currentIdx < 0) return;
    const nextIdx = currentIdx + direction;
    if (nextIdx < 0 || nextIdx >= rowIds.length) return;
    const nextRowId = rowIds[nextIdx];
    e.preventDefault();
    (target as HTMLInputElement).blur();
    requestAnimationFrame(() => {
      const nextTd = tableContainerRef.current?.querySelector<HTMLTableCellElement>(
        `td[data-row-id="${nextRowId}"][data-col-id="${colId}"]`
      );
      const nextInput = nextTd?.querySelector<HTMLElement>("input, textarea, select");
      if (nextInput) {
        nextInput.focus();
        if (nextInput instanceof HTMLInputElement || nextInput instanceof HTMLTextAreaElement) {
          const len = nextInput.value?.length ?? 0;
          try { nextInput.setSelectionRange(len, len); } catch { /* select unsupported on some types */ }
        }
      }
    });
  };

  // Virtualisation activée au-delà de 50 lignes — désactivée si une colonne a
  // le retour à la ligne (hauteur de ligne variable, incompatible avec la
  // hauteur fixe ROW_HEIGHT utilisée par le virtualizer).
  const hasWrapColumn = columns.some((c) => c.config?.wrap);
  const useVirtual = filteredRows.length > 50 && !hasWrapColumn && rowHeight !== "tall";
  const ROW_HEIGHT = rowHeight === "compact" ? 28 : 36;

  const virtualizer = useVirtualizer({
    count: filteredRows.length,
    getScrollElement: () => tableContainerRef.current,
    estimateSize: () => ROW_HEIGHT,
    overscan: 10,
    enabled: useVirtual,
  });

  function renderRow(row: DbData["rows"][number], index: number, style?: React.CSSProperties) {
    const dropPosition: DropPosition | null =
      drag?.drop?.rowId === row.id ? (drag.drop.before ? "before" : "after") : null;
    return (
      <DatabaseTableRow
        key={row.id}
        row={row}
        index={index}
        columns={columns}
        allColumns={allColumns}
        allDatabases={allDatabases}
        relationData={relationData}
        spaceId={data.spaceId}
        readOnly={readOnly}
        selected={selected.has(row.id)}
        anySelected={selectedIds.length > 0}
        canMove={canMove}
        dragging={!!drag?.ids.includes(row.id)}
        dropPosition={dropPosition}
        style={style}
        onUpdateCell={updateCell}
        onCellKeyDown={handleCellKeyDown}
        onToggle={toggleRow}
        onDelete={(id) => void deleteRows([id])}
        onMoveStep={moveStep}
        onOpenRecord={onOpenRecord}
        openRecordLabel={openRecordLabel}
        openRecordKbd={openRecordKbd}
      />
    );
  }

  function handleDragStart(e: DragStartEvent) {
    const ids = movingIdsFor(String(e.active.id), selected, visibleIds);
    setDrag({ ids, drop: null });
  }

  function handleDragMove(e: DragMoveEvent) {
    const start = e.activatorEvent as PointerEvent;
    const y = start.clientY + e.delta.y;
    const trs = Array.from(
      tableContainerRef.current?.querySelectorAll<HTMLElement>("tbody tr[data-row-id]") ?? [],
    );
    if (trs.length === 0) return;
    let target = trs[trs.length - 1];
    let before = false;
    for (const tr of trs) {
      const r = tr.getBoundingClientRect();
      if (y < r.top + r.height) {
        target = tr;
        before = y < r.top + r.height / 2;
        break;
      }
    }
    const rowId = target.dataset.rowId!;
    setDrag((prev) => {
      if (!prev) return prev;
      const valid = dropBeforeId(visibleIds, prev.ids, rowId, before) !== undefined;
      const drop = valid ? { rowId, before } : null;
      if (prev.drop?.rowId === drop?.rowId && prev.drop?.before === drop?.before) return prev;
      return { ...prev, drop };
    });
  }

  function handleDragEnd(_e: DragEndEvent) {
    const current = drag;
    setDrag(null);
    if (!current?.drop) return;
    const beforeId = dropBeforeId(visibleIds, current.ids, current.drop.rowId, current.drop.before);
    if (beforeId !== undefined) void moveRows(current.ids, beforeId);
  }

  useEffect(() => {
    if (!resizing) return;
    // Neutralise la sélection de texte du navigateur / de l'éditeur pendant
    // le glisser : sinon le drag sélectionne le contenu des cellules, ce qui
    // donne l'impression que la sélection « saute » et part en miroir.
    const prevUserSelect = document.body.style.userSelect;
    const prevCursor = document.body.style.cursor;
    document.body.style.userSelect = "none";
    document.body.style.cursor = "col-resize";

    const handleMouseMove = (e: MouseEvent) => {
      e.preventDefault();
      const diff = e.clientX - resizing.startX;
      const newWidth = Math.max(60, resizing.startWidth + diff);
      const th = document.querySelector(`[data-col-id="${resizing.colId}"]`) as HTMLElement;
      if (th) th.style.width = `${newWidth}px`;
    };
    const handleMouseUp = (e: MouseEvent) => {
      const diff = e.clientX - resizing.startX;
      const newWidth = Math.max(60, resizing.startWidth + diff);
      const col = columns.find((c) => c.id === resizing.colId);
      if (col) {
        apiPatch(`/api/databases/${data.id}/columns`, {
          columns: [{ id: resizing.colId, config: { ...col.config, width: newWidth } }],
        }).catch(() => toast.error("Largeur de colonne non enregistrée"));
      }
      setResizing(null);
    };
    document.addEventListener("mousemove", handleMouseMove);
    document.addEventListener("mouseup", handleMouseUp);
    return () => {
      document.body.style.userSelect = prevUserSelect;
      document.body.style.cursor = prevCursor;
      document.removeEventListener("mousemove", handleMouseMove);
      document.removeEventListener("mouseup", handleMouseUp);
    };
  }, [resizing, columns, data.id]);

  return (
    <div
      className={
        fillHeight
          ? "database-block-table-wrapper database-block-table-wrapper--fill"
          : "database-block-table-wrapper"
      }
    >
      {/* View / Sort / Filter / Import-Export controls */}
      <DatabaseToolbar
        data={data}
        viewMode={viewMode}
        onViewModeChange={onViewModeChange}
        viewModeDisabledReasons={viewModeDisabledReasons}
        showFilters={showFilters}
        onFiltersOpenChange={setShowFilters}
        filtersCount={activeFilterCount}
        filterContent={
          <FilterBuilder
            tree={filterTree}
            setTree={setFilterTree}
            columns={allColumns}
            onClear={clearFilters}
            excludeOperators={operatorsExcludedFor(evalContext)}
          />
        }
        showSort={showSort}
        onToggleSort={() => setShowSort(!showSort)}
        hasSort={sorts.length > 0}
        onShowImport={() => setShowImport(true)}
        onRefresh={onRefresh}
        readOnly={readOnly}
        displayControls={
          viewMode === "table" && displayPersisted && !readOnly ? (
            <DatabaseDisplayControls
              columns={allColumns}
              config={displayConfig}
              onChange={setDisplayConfig}
              globalShortcuts={fillHeight}
            />
          ) : undefined
        }
      />

      {/* Sort panel — multi-classements (priorité du haut vers le bas) */}
      {showSort && <SortPanel sorts={sorts} setSorts={setSorts} columns={allColumns} />}

      {/* Table view */}
      {viewMode === "table" && (
        <>
          <div
            ref={tableContainerRef}
            className={`flex-1 overflow-auto min-h-0 database-block-rows--${rowHeight}`}
            tabIndex={0}
            role="application"
            aria-label={`Grille ${data.name}${canEdit ? ". Ctrl+A tout sélectionner, Échap désélectionner, Suppr supprimer." : ""}`}
            onKeyDown={onGridKeyDown}
          >
            <DndContext
              sensors={sensors}
              onDragStart={handleDragStart}
              onDragMove={handleDragMove}
              onDragEnd={handleDragEnd}
              onDragCancel={() => setDrag(null)}
              accessibility={{
                screenReaderInstructions: {
                  draggable: "Glisser avec la souris, ou Alt avec flèche haut ou bas pour déplacer la ligne.",
                },
                announcements: {
                  onDragStart: () => "Ligne saisie",
                  onDragOver: () => undefined,
                  onDragEnd: () => "Ligne déposée",
                  onDragCancel: () => "Déplacement annulé",
                },
              }}
            >
            <table className="database-block-table">
              <thead>
                <tr>
                  <th
                    className="database-block-th"
                    style={{ width: controlColWidth(!canEdit, !!onOpenRecord), minWidth: controlColWidth(!canEdit, !!onOpenRecord), padding: 0 }}
                  >
                    {canEdit && (
                      <div className="flex h-7 items-center justify-end pr-1">
                        <Tip label="Tout sélectionner" kbd="Ctrl+A">
                          <label className="inline-flex h-6 w-6 cursor-pointer items-center justify-center rounded">
                            <input
                              type="checkbox"
                              checked={headerState === "all"}
                              ref={(el) => {
                                if (el) el.indeterminate = headerState === "some";
                              }}
                              disabled={filteredRows.length === 0}
                              onChange={(e) => toggleAll(e.target.checked)}
                              aria-label="Tout sélectionner"
                              className="h-4 w-4 cursor-pointer accent-[var(--primary)]"
                            />
                          </label>
                        </Tip>
                      </div>
                    )}
                  </th>
                  {columns.map((col) => {
                    const headerMenuRef = colMenuRefs.current[col.id] ?? (colMenuRefs.current[col.id] = { current: null });
                    return (
                    <th
                      key={col.id}
                      data-col-id={col.id}
                      className="database-block-th group/col"
                      style={{ width: col.config?.width ? `${col.config.width}px` : col.type === "image" ? "80px" : "200px" }}
                    >
                      <div className="flex items-center gap-1.5">
                        <span className="text-muted-foreground">{COLUMN_TYPE_ICONS[col.type]}</span>
                        <button
                          className="truncate hover:underline"
                          onClick={() => toggleSort(col.id)}
                          onDoubleClick={(e) => {
                            e.preventDefault();
                            e.stopPropagation();
                            headerMenuRef.current?.startRename();
                          }}
                          title="Trier (double-clic pour renommer)"
                        >
                          {col.name}
                        </button>
                        <PairingBadge pairing={describePairing(col, relationData, allDatabases)} />
                        {(() => {
                          const sortIdx = sorts.findIndex((s) => s.columnId === col.id);
                          if (sortIdx < 0) return null;
                          const sort = sorts[sortIdx];
                          return (
                            <span className="inline-flex items-center gap-0.5 text-primary shrink-0" title={`Classement ${sortIdx + 1}`}>
                              {sort.direction === "asc"
                                ? <ArrowUp className="h-3 w-3" />
                                : <ArrowDown className="h-3 w-3" />}
                              {sorts.length > 1 && (
                                <span className="text-[9px] font-semibold leading-none">{sortIdx + 1}</span>
                              )}
                            </span>
                          );
                        })()}
                        {!readOnly && (
                          <ColumnHeaderMenu
                            ref={headerMenuRef}
                            column={col}
                            onRename={(name) => updateColumn(col.id, { name })}
                            onChangeType={(type) => updateColumn(col.id, { type })}
                            onDelete={(alsoDeleteInverse) => deleteColumn(col.id, alsoDeleteInverse)}
                            pairing={describePairing(col, relationData, allDatabases)}
                            onUpdateConfig={(config) => updateColumn(col.id, { config: config as ColumnConfig })}
                            allDatabases={allDatabases}
                            currentDatabaseId={data.id}
                          />
                        )}
                      </div>
                      {!readOnly && (
                        <div
                          className="database-col-resize-handle"
                          onMouseDown={(e) => {
                            e.preventDefault();
                            e.stopPropagation();
                            const th = e.currentTarget.parentElement;
                            setResizing({ colId: col.id, startX: e.clientX, startWidth: th?.offsetWidth ?? 200 });
                          }}
                        />
                      )}
                    </th>
                    );
                  })}
                  {!readOnly && (
                    <th className="database-block-th database-block-th--actions">
                      <AddColumnMenu
                        onAdd={addColumn}
                        allDatabases={allDatabases}
                        currentDatabaseId={data.id}
                        currentDatabaseName={data.name}
                      />
                    </th>
                  )}
                </tr>
              </thead>
              <tbody style={useVirtual ? { height: virtualizer.getTotalSize(), position: "relative" } : undefined}>
                {useVirtual
                  ? virtualizer.getVirtualItems().map((virtualRow) =>
                      renderRow(filteredRows[virtualRow.index], virtualRow.index, {
                        position: "absolute",
                        top: 0,
                        left: 0,
                        width: "100%",
                        height: ROW_HEIGHT,
                        transform: `translateY(${virtualRow.start}px)`,
                      }),
                    )
                  : filteredRows.map((row, i) => renderRow(row, i))}
              </tbody>
            </table>
              <DragOverlay dropAnimation={null}>
                {drag && (
                  <div className="pointer-events-none w-max rounded-md border border-border bg-background px-3 py-1.5 text-xs font-medium shadow-lg">
                    {drag.ids.length} {drag.ids.length > 1 ? "lignes" : "ligne"}
                  </div>
                )}
              </DragOverlay>
            </DndContext>
            {!readOnly && (
              <button
                onClick={addRow}
                className="database-block-add-row"
              >
                <Plus className="h-3.5 w-3.5" />
                Nouvelle ligne
              </button>
            )}
            {/* Espaceur : garde la dernière ligne et « Nouvelle ligne » atteignables sous la barre de sélection flottante. */}
            <div aria-hidden="true" className="h-24 shrink-0" />
          </div>

          <SelectionBar
            count={selectedIds.length}
            onDuplicate={() => void duplicateRows(selectedIds)}
            onDelete={() => void deleteRows(selectedIds)}
            onClear={() => {
              clearSelection();
              tableContainerRef.current?.focus();
            }}
          />

        </>
      )}

      {/* Kanban view */}
      {viewMode === "kanban" && (
        <KanbanView columns={allColumns} rows={filteredRows} />
      )}

      {/* Gallery view */}
      {viewMode === "gallery" && (
        <GalleryView
          data={data}
          columns={allColumns}
          rows={filteredRows}
        />
      )}

      {/* Filtered count */}
      {activeFilterCount > 0 && filteredRows.length !== rows.length && (
        <div className="px-3 py-1.5 text-xs text-muted-foreground border-t border-border">
          {filteredRows.length} / {rows.length} lignes affichées
        </div>
      )}

      {/* CSV Import Modal */}
      {showImport && (
        <CsvImportModal
          databaseId={data.id}
          existingColumns={allColumns}
          onComplete={() => {
            setShowImport(false);
            onRefresh();
          }}
          onClose={() => setShowImport(false)}
        />
      )}
    </div>
  );
}
