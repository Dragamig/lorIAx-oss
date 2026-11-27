"use client";

import { useTranslations } from "next-intl";
import { ActionButton } from "../../action-button";
import type { Layer } from "../recipe";
import type { RetouchOp } from "../recipe";
import { Hint } from "./panel-parts";

/** Pas de déplacement au clavier : 1 % de la sortie, 10 % avec Maj. */
export const NUDGE_STEP = 0.01;

export interface LayerListProps {
  layers: readonly Layer[];
  selectedId: string | null;
  onSelect: (id: string | null) => void;
  onChange: (op: RetouchOp) => void;
}

function labelOf(layer: Layer, t: (k: string) => string): string {
  return layer.type === "text" ? layer.text.replace(/\s+/g, " ").slice(0, 40) : t(`shapes.${layer.shape}`);
}

/** Liste des calques : sélection (Entrée, Espace), flèches pour déplacer, Suppr pour retirer. */
export function LayerList({ layers, selectedId, onSelect, onChange }: LayerListProps) {
  const t = useTranslations("library.retouch");
  if (layers.length === 0) return <Hint>{t("layersEmpty")}</Hint>;
  return (
    <ul role="listbox" className="flex flex-col gap-1" aria-label={t("layersTitle")}>
      {layers.map((layer) => {
        const selected = layer.id === selectedId;
        const name = labelOf(layer, t);
        return (
          <li
            key={layer.id}
            tabIndex={0}
            role="option"
            aria-selected={selected}
            aria-label={t("layerRow", { name })}
            title={t("layerKeys")}
            data-layer-id={layer.id}
            className={`flex h-8 items-center justify-between gap-2 rounded-md border px-2 text-xs focus-visible:ring-2 focus-visible:ring-ring ${selected ? "border-ring bg-accent" : "border-border"}`}
            onClick={() => onSelect(layer.id)}
            onKeyDown={(e) => {
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                onSelect(layer.id);
                return;
              }
              if (!selected) return;
              const step = (e.shiftKey ? 10 : 1) * NUDGE_STEP;
              const moves: Record<string, [number, number] | undefined> = {
                ArrowLeft: [-step, 0],
                ArrowRight: [step, 0],
                ArrowUp: [0, -step],
                ArrowDown: [0, step],
              };
              const m = moves[e.key];
              if (m) {
                e.preventDefault();
                onChange({ type: "updateLayer", id: layer.id, patch: { x: layer.x + m[0], y: layer.y + m[1] } });
              } else if (e.key === "Delete" || e.key === "Backspace") {
                e.preventDefault();
                onChange({ type: "removeLayer", id: layer.id });
                onSelect(null);
              }
            }}
          >
            <span className="min-w-0 truncate">{name}</span>
            <ActionButton
              id="deleteLayer"
              label={t("deleteLayerNamed", { name })}
              size="icon-sm"
              onAction={() => {
                onChange({ type: "removeLayer", id: layer.id });
                if (selected) onSelect(null);
              }}
            />
          </li>
        );
      })}
    </ul>
  );
}
