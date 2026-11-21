"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { fetchJson } from "@/components/editor/extensions/database-block/api";
import type { RowTaskDto } from "@/lib/databases/row-tasks";
import type { PermissionLevel } from "@/types";

export type RowTasksStatus = "loading" | "ready" | "error";

interface RowTasksResponse {
  tasks: RowTaskDto[];
  openCount: number;
  permission?: PermissionLevel;
}

export interface UseRowTasksResult {
  status: RowTasksStatus;
  tasks: RowTaskDto[];
  /** Tasks open or in progress. */
  openCount: number;
  permission: PermissionLevel;
  reload: () => Promise<void>;
  setTasks: (updater: (prev: RowTaskDto[]) => RowTaskDto[]) => void;
}

const isOpen = (t: RowTaskDto) => t.status === "open" || t.status === "in_progress";

/** Tasks of one row, loaded as soon as the record opens (the badge needs the count). */
export function useRowTasks(databaseId: string, rowId: string): UseRowTasksResult {
  const [status, setStatus] = useState<RowTasksStatus>("loading");
  const [tasks, setTasksState] = useState<RowTaskDto[]>([]);
  const [permission, setPermission] = useState<PermissionLevel>("viewer");
  const t = useTranslations("rowTasks");
  const tRef = useRef(t);
  useEffect(() => {
    tRef.current = t;
  }, [t]);
  const controller = useRef<AbortController | null>(null);
  const url = `/api/databases/${databaseId}/rows/${rowId}/tasks`;

  /** `silent` keeps the current list on screen while refreshing. */
  const load = useCallback(
    async (silent: boolean) => {
      controller.current?.abort();
      const ctl = new AbortController();
      controller.current = ctl;
      if (!silent) setStatus("loading");
      try {
        const data = await fetchJson<RowTasksResponse>(url, { signal: ctl.signal });
        if (ctl.signal.aborted) return;
        setTasksState(Array.isArray(data.tasks) ? data.tasks : []);
        if (data.permission) setPermission(data.permission);
        setStatus("ready");
      } catch {
        if (ctl.signal.aborted) return;
        if (silent) toast.error(tRef.current("reloadError"));
        else setStatus("error");
      }
    },
    [url],
  );

  useEffect(() => {
    void load(false);
    return () => controller.current?.abort();
  }, [load]);

  const reload = useCallback(() => load(true), [load]);

  const setTasks = useCallback((updater: (prev: RowTaskDto[]) => RowTaskDto[]) => {
    setTasksState(updater);
  }, []);

  const openCount = useMemo(() => tasks.filter(isOpen).length, [tasks]);

  return { status, tasks, openCount, permission, reload, setTasks };
}
