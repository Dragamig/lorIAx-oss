"use client";

import { useRef, useState } from "react";
import { toast } from "sonner";
import { apiPatch } from "@/components/editor/extensions/database-block/api";
import { pickDisplayConfig, toDisplayPatch, type DisplayConfig } from "@/lib/bases/view-config";

/**
 * Display settings of a view (visible columns, order, row height), persisted by view PATCH.
 * Failures roll back to the last confirmed state, but only when no newer change was issued.
 */
export function useViewDisplayConfig(databaseId: string, viewId: string, viewConfig: Record<string, unknown>) {
  const [display, setDisplay] = useState<DisplayConfig>(() => pickDisplayConfig(viewConfig));
  const savedRef = useRef<DisplayConfig>(display);
  const savedSeqRef = useRef(0);
  const seqRef = useRef(0);

  async function changeDisplay(next: DisplayConfig) {
    const seq = ++seqRef.current;
    setDisplay(next);
    try {
      await apiPatch(`/api/databases/${databaseId}/views/${viewId}`, { config: toDisplayPatch(next) });
      if (seq > savedSeqRef.current) {
        savedSeqRef.current = seq;
        savedRef.current = next;
      }
    } catch {
      if (seq !== seqRef.current) return; // a newer change owns the state
      setDisplay(savedRef.current);
      toast.error("Impossible d'enregistrer les réglages d'affichage");
    }
  }

  return { display, changeDisplay };
}
