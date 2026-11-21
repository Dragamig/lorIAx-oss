"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { apiDelete, fetchJson } from "@/components/editor/extensions/database-block/api";
import type { RowActivityItem, RowActivityPage } from "@/lib/databases/row-activity-types";
import type { PermissionLevel } from "@/types";

export type RowActivityStatus = "loading" | "ready" | "empty" | "error";

export const REFETCH_DELAY_MS = 800;
const PAGE_SIZE = 20;

export function useRowActivity(databaseId: string, rowId: string, revision: string) {
  const [status, setStatus] = useState<RowActivityStatus>("loading");
  const [items, setItems] = useState<RowActivityItem[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [canClear, setCanClear] = useState(false);
  const [permission, setPermission] = useState<PermissionLevel | null>(null);
  const [viewerId, setViewerId] = useState<string | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);
  const [moreError, setMoreError] = useState(false);
  const controller = useRef<AbortController | null>(null);
  const cursorRef = useRef<string | null>(null);
  const base = `/api/databases/${databaseId}/rows/${rowId}/activity`;
  // Erasure stays on the history route (RGPD, admin only).
  const historyUrl = `/api/databases/${databaseId}/rows/${rowId}/history`;

  /** Loads the first page; `silent` keeps the current list on screen while refreshing. */
  const loadFirst = useCallback(
    async (silent: boolean) => {
      controller.current?.abort();
      const ctl = new AbortController();
      controller.current = ctl;
      setLoadingMore(false);
      if (!silent) setStatus("loading");
      try {
        const page = await fetchJson<RowActivityPage>(`${base}?limit=${PAGE_SIZE}`, { signal: ctl.signal });
        if (ctl.signal.aborted) return;
        setItems(page.items);
        setNextCursor(page.nextCursor);
        cursorRef.current = page.nextCursor;
        setCanClear(page.canClear);
        setPermission(page.permission);
        setViewerId(page.viewerId);
        setMoreError(false);
        setStatus(page.items.length === 0 ? "empty" : "ready");
      } catch {
        if (ctl.signal.aborted) return;
        if (!silent) setStatus("error");
      }
    },
    [base],
  );

  useEffect(() => {
    void loadFirst(false);
    return () => controller.current?.abort();
  }, [loadFirst]);

  const firstRevision = useRef(revision);
  useEffect(() => {
    if (firstRevision.current === revision) return;
    firstRevision.current = revision;
    const timer = setTimeout(() => void loadFirst(true), REFETCH_DELAY_MS);
    return () => clearTimeout(timer);
  }, [revision, loadFirst]);

  const loadMore = useCallback(async () => {
    const cursor = cursorRef.current;
    if (!cursor || loadingMore) return;
    const ctl = controller.current ?? new AbortController();
    setLoadingMore(true);
    setMoreError(false);
    try {
      const page = await fetchJson<RowActivityPage>(
        `${base}?limit=${PAGE_SIZE}&cursor=${encodeURIComponent(cursor)}`,
        { signal: ctl.signal },
      );
      if (ctl.signal.aborted) return;
      setItems((prev) => [...prev, ...page.items]);
      setNextCursor(page.nextCursor);
      cursorRef.current = page.nextCursor;
    } catch {
      if (!ctl.signal.aborted) setMoreError(true);
    } finally {
      if (!ctl.signal.aborted) setLoadingMore(false);
    }
  }, [base, loadingMore]);

  const retry = useCallback(() => loadFirst(false), [loadFirst]);
  /** Immediate silent refresh (no loading state, the current list stays on screen). */
  const reload = useCallback(() => loadFirst(true), [loadFirst]);

  const clear = useCallback(async () => {
    await apiDelete(historyUrl, {});
    await loadFirst(false);
  }, [historyUrl, loadFirst]);

  return {
    status,
    items,
    nextCursor,
    canClear,
    permission,
    viewerId,
    loadingMore,
    moreError,
    loadMore,
    retry,
    reload,
    clear,
  };
}
