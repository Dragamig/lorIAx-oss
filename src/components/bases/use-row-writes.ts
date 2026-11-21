"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { apiPatch } from "@/components/editor/extensions/database-block/api";
import type { CellValue, DbRow } from "@/components/editor/extensions/database-block/types";
import { createLatestGate } from "@/lib/bases/latest-wins";

/**
 * Optimistic cell writes (PATCH /rows, which triggers automations) with toast.
 * A failure only rolls back when no newer write was issued on the same cell.
 */
export function useRowWrites(databaseId: string, rows: DbRow[]) {
  const t = useTranslations("recordSheet");
  const [overrides, setOverrides] = useState<Record<string, Record<string, CellValue>>>({});
  const gateRef = useRef(createLatestGate());
  // Last value known to be saved (or the baseline before the first pending write) per cell.
  const confirmedRef = useRef(new Map<string, { value: CellValue; token: number }>());

  useEffect(() => {
    setOverrides({});
    confirmedRef.current.clear();
  }, [rows]);

  const mergedRows = useMemo(
    () => rows.map((r) => (overrides[r.id] ? { ...r, cells: { ...r.cells, ...overrides[r.id] } } : r)),
    [rows, overrides],
  );

  /** `silent`: the caller reports the failure itself (the record sheet names the column), so no toast here. */
  async function writeCell(
    rowId: string,
    columnId: string,
    value: CellValue,
    opts?: { silent?: boolean },
  ): Promise<boolean> {
    const key = `${rowId}:${columnId}`;
    if (!confirmedRef.current.has(key)) {
      const baseline = (mergedRows.find((r) => r.id === rowId)?.cells[columnId] ?? null) as CellValue;
      confirmedRef.current.set(key, { value: baseline, token: 0 });
    }
    const token = gateRef.current.next(key);
    setOverrides((o) => ({ ...o, [rowId]: { ...(o[rowId] ?? {}), [columnId]: value } }));
    try {
      await apiPatch(`/api/databases/${databaseId}/rows`, { rows: [{ id: rowId, cells: { [columnId]: value } }] });
      const confirmed = confirmedRef.current.get(key);
      if (!confirmed || token > confirmed.token) confirmedRef.current.set(key, { value, token });
      return true;
    } catch {
      if (gateRef.current.isLatest(key, token)) {
        const restore = (confirmedRef.current.get(key)?.value ?? null) as CellValue;
        setOverrides((o) => ({ ...o, [rowId]: { ...(o[rowId] ?? {}), [columnId]: restore } }));
      }
      if (!opts?.silent) toast.error(t("cellWriteError"));
      return false;
    }
  }

  return { mergedRows, writeCell };
}
