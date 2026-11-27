"use client";

import { useCallback, useState } from "react";
import type { DragEvent } from "react";

/** Type MIME propre au Pipeline : un dépôt venant du kanban Bases (autre type) est ignoré. */
export const DEAL_MIME = "application/x-crm-deal";

export interface DragResult {
  dealId: string;
  laneKey: string;
  ok: boolean;
}

interface Options {
  /** Même fonction que le menu de déplacement : true si l'écriture a réussi. */
  onMove: (dealId: string, laneKey: string) => Promise<boolean>;
  disabled: boolean;
}

const hasDealType = (e: DragEvent) => Array.from(e.dataTransfer?.types ?? []).includes(DEAL_MIME);

/** Glisser-déposer HTML5 natif des cartes de dossier entre voies (comme kanban-board.tsx). */
export function usePipelineDrag({ onMove, disabled }: Options) {
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const [overLane, setOverLane] = useState<string | null>(null);
  const [result, setResult] = useState<DragResult | null>(null);

  const cardProps = useCallback(
    (dealId: string, laneKey: string) => ({
      draggable: !disabled,
      onDragStart: (e: DragEvent) => {
        if (disabled) {
          e.preventDefault();
          return;
        }
        e.dataTransfer.setData(DEAL_MIME, JSON.stringify({ id: dealId, from: laneKey }));
        e.dataTransfer.effectAllowed = "move";
        setResult(null);
        setDraggingId(dealId);
      },
      onDragEnd: () => {
        setDraggingId(null);
        setOverLane(null);
      },
    }),
    [disabled],
  );

  const laneProps = useCallback(
    (laneKey: string) => ({
      onDragOver: (e: DragEvent) => {
        if (disabled || !hasDealType(e)) return;
        e.preventDefault();
        e.dataTransfer.dropEffect = "move";
        setOverLane(laneKey);
      },
      onDragLeave: (e: DragEvent) => {
        // Ignore les sorties vers un enfant de la voie.
        if (e.currentTarget.contains(e.relatedTarget as Node | null)) return;
        setOverLane((cur) => (cur === laneKey ? null : cur));
      },
      onDrop: async (e: DragEvent) => {
        if (!hasDealType(e)) return;
        e.preventDefault();
        setOverLane(null);
        setDraggingId(null);
        if (disabled) return;
        let payload: { id?: unknown; from?: unknown };
        try {
          payload = JSON.parse(e.dataTransfer.getData(DEAL_MIME)) as typeof payload;
        } catch {
          return;
        }
        if (typeof payload.id !== "string" || payload.from === laneKey) return;
        const ok = await onMove(payload.id, laneKey);
        setResult({ dealId: payload.id, laneKey, ok });
      },
    }),
    [disabled, onMove],
  );

  return { cardProps, laneProps, draggingId, overLane, result };
}
