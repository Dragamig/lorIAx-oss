"use client";

import { useCallback, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import type { DbRow } from "@/components/editor/extensions/database-block/types";
import { resolveRecordNav, type RecordNav } from "@/lib/bases/record-navigation";
import { readRowParam, withRowParam } from "@/lib/bases/row-deep-link";

export interface UseRecordSheetArgs {
  /** Every row of the database (merged with optimistic writes), used to resolve the open row. */
  rows: DbRow[];
  /** Ids of the calling view, in display order: the navigation context. */
  orderedIds: string[];
}

export interface UseRecordSheetResult {
  openRowId: string | null;
  /** Resolved row, or null when closed or not found. */
  openRow: DbRow | null;
  status: "closed" | "ready" | "notFound";
  nav: RecordNav | null;
  openRecord: (rowId: string) => void;
  closeRecord: () => void;
  navigate: (rowId: string) => void;
}

function writeUrl(rowId: string | null) {
  const { pathname, search, hash } = window.location;
  window.history.replaceState(null, "", withRowParam(pathname + search + hash, rowId));
}

const INVALID = "__invalid__";

export function useRecordSheet({ rows, orderedIds }: UseRecordSheetArgs): UseRecordSheetResult {
  const params = useSearchParams();
  const raw = params.get("row");
  const parsed = readRowParam(params);
  // A present but invalid param is a notFound, like an unknown uuid.
  const paramState = raw === null ? null : (parsed ?? INVALID);
  const [openState, setOpenState] = useState<string | null>(paramState);
  // Last known position of the open row in the view (state, not a ref: read in render).
  const [lastIndex, setLastIndex] = useState<number | null>(null);
  // Values this hook wrote itself (null = row param removed). Next syncs
  // useSearchParams asynchronously, so late echoes of them must be ignored.
  const [written, setWritten] = useState<(string | null)[]>([]);
  const [seenParam, setSeenParam] = useState<string | null>(paramState);

  // Follow an external row param change (link followed on the same page),
  // derived during render (previous-value-in-state pattern).
  if (seenParam !== paramState) {
    setSeenParam(paramState);
    if (written.includes(paramState)) {
      // Echo of our own write. When it is the latest one, we are in sync.
      if (paramState === openState) setWritten([]);
    } else {
      setWritten([]);
      setLastIndex(null);
      setOpenState(paramState);
    }
  }

  const openRowId = openState === INVALID ? null : openState;

  const openRow = useMemo(
    () => (openRowId ? (rows.find((r) => r.id === openRowId) ?? null) : null),
    [rows, openRowId],
  );

  const status: UseRecordSheetResult["status"] =
    openState === null ? "closed" : openRow ? "ready" : "notFound";

  const nav = useMemo(
    () =>
      status === "ready" && openRowId
        ? resolveRecordNav(orderedIds, openRowId, lastIndex)
        : null,
    [status, openRowId, orderedIds, lastIndex],
  );

  // Remember the last known position of the open row (previous-value-in-state pattern).
  const currentIndex = openRowId ? orderedIds.indexOf(openRowId) : -1;
  if (currentIndex !== -1 && currentIndex !== lastIndex) setLastIndex(currentIndex);

  const write = useCallback((rowId: string | null) => {
    setWritten((w) => [...w, rowId]);
    setOpenState(rowId);
    writeUrl(rowId);
  }, []);

  const openRecord = useCallback(
    (rowId: string) => {
      setLastIndex(null);
      write(rowId);
    },
    [write],
  );

  const navigate = useCallback((rowId: string) => write(rowId), [write]);

  const closeRecord = useCallback(() => {
    setLastIndex(null);
    write(null);
  }, [write]);

  return { openRowId, openRow, status, nav, openRecord, closeRecord, navigate };
}
