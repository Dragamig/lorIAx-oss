"use client";

import { useEffect, useMemo, useRef, useState, type Dispatch, type SetStateAction } from "react";
import { toast } from "sonner";
import { useTranslations } from "next-intl";
import { apiPatch } from "@/components/editor/extensions/database-block/api";
import {
  countActiveConditions,
  normalizeFilterTree,
  type FilterContext,
} from "@/components/editor/extensions/database-block/filter-tree";
import type { FilterGroup, SortConfig } from "@/components/editor/extensions/database-block/types";
import { createLatestGate } from "@/lib/bases/latest-wins";
import { createSerialSaver } from "@/lib/bases/serial-saver";

interface Args {
  databaseId: string;
  viewId: string;
  viewConfig: Record<string, unknown>;
  viewerId?: string;
}

export interface KanbanFilterSort {
  sorts: SortConfig[];
  setSorts: Dispatch<SetStateAction<SortConfig[]>>;
  filterTree: FilterGroup;
  setFilterTree: Dispatch<SetStateAction<FilterGroup>>;
  ctx: FilterContext;
  activeFilterCount: number;
  saveError: boolean;
  retry(): void;
}

interface Saved {
  sorts: SortConfig[];
  filters: FilterGroup;
}

/**
 * Tri et filtres du kanban : mêmes clés `config.sorts` / `config.filters` que la grille,
 * persistées par PATCH (debounce 500 ms). Un échec revient à l'état confirmé et propose « Réessayer ».
 */
export function useKanbanFilterSort({ databaseId, viewId, viewConfig, viewerId }: Args): KanbanFilterSort {
  const t = useTranslations("basesTotals");
  const [sorts, setSorts] = useState<SortConfig[]>(() =>
    Array.isArray(viewConfig.sorts) ? (viewConfig.sorts as SortConfig[]) : [],
  );
  const [filterTree, setFilterTree] = useState<FilterGroup>(() => normalizeFilterTree(viewConfig.filters));
  const [saveError, setSaveError] = useState(false);

  const savedRef = useRef<Saved>({ sorts, filters: filterTree });
  const attemptedRef = useRef<Saved | null>(null);
  const hydratedRef = useRef(false);
  const skipRef = useRef(false);
  const gateRef = useRef(createLatestGate());
  const saverRef = useRef<ReturnType<typeof createSerialSaver<Saved>> | null>(null);
  const pendingRef = useRef<(() => void) | null>(null);
  const tRef = useRef(t);
  const retryRef = useRef<() => void>(() => {});

  useEffect(() => {
    tRef.current = t;
  });

  useEffect(() => {
    if (!hydratedRef.current) {
      hydratedRef.current = true;
      return;
    }
    if (skipRef.current) {
      skipRef.current = false;
      return;
    }
    const sent: Saved = { sorts, filters: filterTree };
    const send = () => {
      pendingRef.current = null;
      const token = gateRef.current.next("view");
      saverRef.current ??= createSerialSaver((value: Saved) =>
        apiPatch(`/api/databases/${databaseId}/views/${viewId}`, { config: { sorts: value.sorts, filters: value.filters } }),
      );
      void saverRef.current.save(sent).then((outcome) => {
        if (outcome === "superseded") return;
        if (outcome === "saved") {
          // Une seule requête en vol : l'ordre d'acquittement est l'ordre d'envoi.
          savedRef.current = sent;
          if (!gateRef.current.isLatest("view", token)) return;
          attemptedRef.current = null;
          setSaveError(false);
          return;
        }
        if (!gateRef.current.isLatest("view", token)) return;
        attemptedRef.current = sent;
        skipRef.current = true;
        setSorts(savedRef.current.sorts);
        setFilterTree(savedRef.current.filters);
        setSaveError(true);
        toast.error(tRef.current("saveError"), {
          action: { label: tRef.current("retry"), onClick: () => retryRef.current() },
        });
      });
    };
    pendingRef.current = send;
    const handle = setTimeout(send, 500);
    return () => clearTimeout(handle);
  }, [sorts, filterTree, databaseId, viewId]);

  // Un enregistrement différé encore en attente au démontage part tout de suite.
  useEffect(() => () => pendingRef.current?.(), []);

  useEffect(() => {
    retryRef.current = () => {
      const attempted = attemptedRef.current;
      if (!attempted) return;
      setSorts(attempted.sorts);
      setFilterTree(attempted.filters);
    };
  });

  const [now] = useState(() => new Date());
  const tz = useMemo(() => {
    try {
      return Intl.DateTimeFormat().resolvedOptions().timeZone;
    } catch {
      return undefined;
    }
  }, []);
  const ctx = useMemo<FilterContext>(() => ({ now, userId: viewerId, tz }), [now, viewerId, tz]);
  const activeFilterCount = useMemo(() => countActiveConditions(filterTree), [filterTree]);

  return {
    sorts,
    setSorts,
    filterTree,
    setFilterTree,
    ctx,
    activeFilterCount,
    saveError,
    retry: () => retryRef.current(),
  };
}
