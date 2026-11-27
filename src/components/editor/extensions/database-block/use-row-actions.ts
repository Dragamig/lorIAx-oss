"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type React from "react";
import { toast } from "sonner";
import type { CellValue, DbRow } from "./types";
import { apiDelete, apiPatch, apiPost } from "./api";
import { deleteRowsRequest, restoreRowsRequest, type ServerRow } from "@/lib/bases/delete-rows";
import {
  applyReorder,
  invertReorder,
  movingIdsFor,
  pruneSelection,
  rangeBetween,
  reinsertRows,
  revertMove,
  shouldIgnoreGridKey,
  sameOrder,
  stepReorder,
} from "@/lib/bases/row-selection";

type DuplicatedRow = ServerRow & { sourceId: string };
type PositionRow = { id: string; position: number };

export const MOVE_DISABLED_SORTED =
  "Déplacement indisponible : la vue est triée. Retirez le tri pour réordonner.";

const lines = (n: number, one: string, many: string) => `${n} ${n > 1 ? many : one}`;

interface Options {
  databaseId: string;
  /** Lignes de la base (ordre serveur, hors tri/filtre) y compris les mises à jour optimistes. */
  baseRows: DbRow[];
  /** Lignes affichées (après filtre et tri). */
  visibleRows: DbRow[];
  mutateRows: (fn: (rows: DbRow[]) => DbRow[]) => void;
  setRowsOverride: (rows: DbRow[] | null) => void;
  onRefresh: () => void;
  canEdit: boolean;
  /** Faux si la vue est triée ou en lecture seule. */
  canMove: boolean;
}

/** Sélection multiple des lignes et actions en lot (supprimer, dupliquer, déplacer) avec Annuler. */
export function useRowActions({
  databaseId,
  baseRows,
  visibleRows,
  mutateRows,
  setRowsOverride,
  onRefresh,
  canEdit,
  canMove,
}: Options) {
  const [selected, setSelected] = useState<Set<string>>(() => new Set());
  const anchorRef = useRef<string | null>(null);
  const busyRef = useRef(false);
  const baseRowsRef = useRef(baseRows);
  useEffect(() => {
    baseRowsRef.current = baseRows;
  }, [baseRows]);

  const visibleIds = useMemo(() => visibleRows.map((r) => r.id), [visibleRows]);
  const visibleIdsRef = useRef(visibleIds);
  useEffect(() => {
    visibleIdsRef.current = visibleIds;
  }, [visibleIds]);

  // Sélection effacée des lignes qui ne sont plus visibles (filtre, suppression distante).
  useEffect(() => {
    setSelected((prev) => pruneSelection(prev, visibleIds));
  }, [visibleIds]);

  const selectedRef = useRef(selected);
  useEffect(() => {
    selectedRef.current = selected;
  }, [selected]);

  const clearSelection = useCallback(() => {
    anchorRef.current = null;
    setSelected((prev) => (prev.size === 0 ? prev : new Set()));
  }, []);

  const selectAll = useCallback(() => {
    setSelected(new Set(visibleIdsRef.current));
  }, []);

  const toggleAll = useCallback(
    (checked: boolean) => {
      if (checked) selectAll();
      else clearSelection();
    },
    [selectAll, clearSelection],
  );

  const toggleRow = useCallback((id: string, range: boolean) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (range && anchorRef.current != null) {
        for (const x of rangeBetween(visibleIdsRef.current, anchorRef.current, id)) next.add(x);
      } else if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
    if (!range) anchorRef.current = id;
  }, []);

  // ─── Suppression ───────────────────────────────────────────────────────────
  const deleteRows = useCallback(
    async (rowIds: string[]) => {
      if (!canEdit || rowIds.length === 0) return;
      const original = baseRowsRef.current;
      const originalIds = original.map((r) => r.id);
      const removed = new Set(rowIds);
      const removedRows = original.filter((r) => removed.has(r.id));
      mutateRows((rs) => rs.filter((r) => !removed.has(r.id)));
      clearSelection();
      const request = deleteRowsRequest(databaseId, rowIds);
      const message = lines(rowIds.length, "ligne supprimée", "lignes supprimées");
      let undone = false;
      const toastId = toast(message, {
        duration: 8000,
        action: {
          label: "Annuler",
          onClick: async () => {
            if (undone) return;
            undone = true;
            try {
              const { deleted } = await request;
              // `deleted` est renvoyé tel que reçu du DELETE (champ `tracking` inclus).
              const res = await restoreRowsRequest(databaseId, deleted);
              void res; // alreadyRestored: true vaut succès
              toast.success(lines(deleted.length, "ligne restaurée", "lignes restaurées"));
            } catch {
              toast.error("Impossible d'annuler la suppression");
            }
            onRefresh();
          },
        },
      });
      try {
        await request;
        onRefresh();
      } catch {
        mutateRows((rs) => reinsertRows(rs, removedRows, originalIds));
        toast.dismiss(toastId);
        toast.error("Échec de la suppression");
      }
    },
    [canEdit, databaseId, mutateRows, clearSelection, onRefresh],
  );

  // ─── Duplication ───────────────────────────────────────────────────────────
  const duplicateRows = useCallback(
    async (rowIds: string[]) => {
      if (!canEdit || rowIds.length === 0 || busyRef.current) return;
      busyRef.current = true;
      try {
        const { rows: copies } = await apiPost<{ rows: DuplicatedRow[] }>(
          `/api/databases/${databaseId}/rows/duplicate`,
          { rowIds },
        );
        const now = new Date().toISOString();
        const bySource = new Map<string, DuplicatedRow[]>();
        for (const c of copies) bySource.set(c.sourceId, [...(bySource.get(c.sourceId) ?? []), c]);
        mutateRows((rs) =>
          rs.flatMap((r) => [
            r,
            ...(bySource.get(r.id) ?? []).map(
              (c): DbRow => ({ ...r, id: c.id, cells: c.cells, position: c.position, createdAt: now, updatedAt: now }),
            ),
          ]),
        );
        const copyIds = copies.map((c) => c.id);
        anchorRef.current = null;
        setSelected(new Set(copyIds));
        let dupUndone = false;
        toast(lines(copies.length, "ligne dupliquée", "lignes dupliquées"), {
          duration: 8000,
          action: {
            label: "Annuler",
            onClick: async () => {
              if (dupUndone) return;
              dupUndone = true;
              const gone = new Set(copyIds);
              mutateRows((rs) => rs.filter((r) => !gone.has(r.id)));
              try {
                await apiDelete(`/api/databases/${databaseId}/rows`, { rowIds: copyIds });
              } catch {
                toast.error("Impossible d'annuler la duplication");
              }
              onRefresh();
            },
          },
        });
        onRefresh();
      } catch {
        toast.error("Échec de la duplication");
      } finally {
        busyRef.current = false;
      }
    },
    [canEdit, databaseId, mutateRows, onRefresh],
  );

  // ─── Déplacement ───────────────────────────────────────────────────────────
  const applyPositions = useCallback(
    (positions: PositionRow[] | undefined) => {
      if (!positions?.length) return;
      const byId = new Map(positions.map((p) => [p.id, p.position]));
      mutateRows((rs) => rs.map((r) => (byId.has(r.id) ? { ...r, position: byId.get(r.id)! } : r)));
    },
    [mutateRows],
  );

  const moveRows = useCallback(
    async (rowIds: string[], beforeRowId: string | null) => {
      if (!canMove || rowIds.length === 0) return;
      const before = baseRowsRef.current;
      const next = applyReorder(before, rowIds, beforeRowId);
      if (sameOrder(before, next)) return;
      const beforeIds = before.map((r) => r.id);
      mutateRows((rs) => applyReorder(rs, rowIds, beforeRowId));
      try {
        const res = await apiPatch<{ rows?: PositionRow[] }>(`/api/databases/${databaseId}/rows/reorder`, {
          rowIds,
          beforeRowId,
        });
        applyPositions(res?.rows);
      } catch {
        mutateRows((rs) => revertMove(rs, beforeIds, rowIds));
        toast.error("Échec du déplacement");
        return;
      }
      let moveUndone = false;
      toast(rowIds.length > 1 ? `${rowIds.length} lignes déplacées` : "Ligne déplacée", {
        duration: 8000,
        action: {
          label: "Annuler",
          onClick: async () => {
            if (moveUndone) return;
            moveUndone = true;
            try {
              for (const op of invertReorder(beforeIds, rowIds)) {
                mutateRows((rs) => applyReorder(rs, op.rowIds, op.beforeRowId));
                const res = await apiPatch<{ rows?: PositionRow[] }>(
                  `/api/databases/${databaseId}/rows/reorder`,
                  op,
                );
                applyPositions(res?.rows);
              }
            } catch {
              toast.error("Impossible d'annuler le déplacement");
              onRefresh();
            }
          },
        },
      });
    },
    [canMove, databaseId, mutateRows, applyPositions, onRefresh],
  );

  /** Alt+flèche : déplace la ligne (ou le lot sélectionné) d'un cran. */
  const moveStep = useCallback(
    (rowId: string, dir: -1 | 1) => {
      if (!canMove) {
        if (canEdit) toast("Déplacement indisponible : la vue est triée");
        return;
      }
      const ordered = visibleIdsRef.current;
      const moving = movingIdsFor(rowId, selectedRef.current, ordered);
      const op = stepReorder(ordered, moving, dir);
      if (op) void moveRows(op.rowIds, op.beforeRowId);
    },
    [canMove, canEdit, moveRows],
  );

  // ─── Clavier (conteneur de la grille) ─────────────────────────────────────
  const onGridKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (!canEdit) return;
      if (shouldIgnoreGridKey(e.currentTarget, e.target as HTMLElement)) return;
      const mod = e.ctrlKey || e.metaKey;
      const key = e.key;
      const has = selectedRef.current.size > 0;
      const handled = () => {
        e.preventDefault();
        e.stopPropagation();
      };
      if (mod && key.toLowerCase() === "a") {
        handled();
        selectAll();
      } else if (key === "Escape" && has) {
        handled();
        clearSelection();
      } else if ((key === "Delete" || key === "Backspace") && has) {
        handled();
        void deleteRows(visibleIdsRef.current.filter((id) => selectedRef.current.has(id)));
      } else if (mod && key.toLowerCase() === "d" && has) {
        handled();
        void duplicateRows(visibleIdsRef.current.filter((id) => selectedRef.current.has(id)));
      }
    },
    [canEdit, selectAll, clearSelection, deleteRows, duplicateRows],
  );

  const selectedIds = useMemo(() => visibleIds.filter((id) => selected.has(id)), [visibleIds, selected]);

  return {
    selected,
    selectedIds,
    visibleIds,
    clearSelection,
    selectAll,
    toggleAll,
    toggleRow,
    deleteRows,
    duplicateRows,
    moveRows,
    moveStep,
    onGridKeyDown,
  };
}
