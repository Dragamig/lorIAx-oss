"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { ActionButton } from "../../action-button";
import { MAX_LAYERS } from "../limits";
import { addShape, DEFAULT_SHAPE_STROKE, type ShapeKind } from "../overlays";
import { LayerList } from "./layer-list";
import { PanelSection } from "./panel-parts";
import { FractionSlider, PositionSliders } from "./position-sliders";
import type { OverlayPanelProps } from "./text-panel";
import { RetouchSlider } from "./retouch-slider";

const KINDS: { kind: ShapeKind; id: "addRect" | "addEllipse" | "addLine" | "addArrow" }[] = [
  { kind: "rect", id: "addRect" },
  { kind: "ellipse", id: "addEllipse" },
  { kind: "line", id: "addLine" },
  { kind: "arrow", id: "addArrow" },
];

export function ShapesPanel({ recipe, onChange, selectedId, onSelect }: OverlayPanelProps) {
  const t = useTranslations("library.retouch");
  const [stroke, setStroke] = useState(DEFAULT_SHAPE_STROKE);
  const shapes = recipe.layers.filter((l) => l.type === "shape");
  const selected = shapes.find((l) => l.id === selectedId) ?? null;
  const full = recipe.layers.length >= MAX_LAYERS;
  const reason = full ? t("layerLimit", { max: String(MAX_LAYERS) }) : undefined;

  const add = (kind: ShapeKind) => {
    const res = addShape(recipe, kind, { stroke });
    if (!res.ok) return;
    onChange({ type: "addLayer", layer: res.recipe.layers[res.recipe.layers.length - 1] });
    onSelect(res.id);
  };

  return (
    <div>
      <PanelSection title={t("sectionAddShape")}>
        <label className="flex flex-col gap-1 text-xs">
          {t("strokeColor")}
          <input type="color" value={stroke} onChange={(e) => setStroke(e.target.value)} className="h-8 w-full" />
        </label>
        <div className="grid grid-cols-2 gap-1.5">
          {KINDS.map(({ kind, id }) => (
            <ActionButton key={id} id={id} size="sm" variant="outline" showLabel wrapperClassName="w-full" className="w-full" disabledReason={reason} onAction={() => add(kind)} />
          ))}
        </div>
      </PanelSection>

      <PanelSection title={t("layersTitle")}>
        <LayerList layers={shapes} selectedId={selectedId} onSelect={onSelect} onChange={onChange} />
      </PanelSection>

      {selected && selected.type === "shape" ? (
        <PanelSection title={t("sectionEditShape")}>
          <label className="flex flex-col gap-1 text-xs">
            {t("strokeColor")}
            <input
              type="color"
              value={selected.stroke ?? DEFAULT_SHAPE_STROKE}
              onChange={(e) => onChange({ type: "updateLayer", id: selected.id, patch: { stroke: e.target.value } })}
              className="h-8 w-full"
            />
          </label>
          {selected.shape === "rect" || selected.shape === "ellipse" ? (
            <>
              <label className="flex items-center gap-2 text-xs">
                <input
                  type="checkbox"
                  checked={selected.fill !== null}
                  onChange={(e) => onChange({ type: "updateLayer", id: selected.id, patch: { fill: e.target.checked ? (selected.stroke ?? DEFAULT_SHAPE_STROKE) : null } })}
                />
                {t("fillOn")}
              </label>
              {selected.fill !== null ? (
                <label className="flex flex-col gap-1 text-xs">
                  {t("fillColor")}
                  <input
                    type="color"
                    value={selected.fill}
                    onChange={(e) => onChange({ type: "updateLayer", id: selected.id, patch: { fill: e.target.value } })}
                    className="h-8 w-full"
                  />
                </label>
              ) : null}
            </>
          ) : (
            <label className="flex items-center gap-2 text-xs">
              <input
                type="checkbox"
                checked={Boolean(selected.flip)}
                onChange={(e) => onChange({ type: "updateLayer", id: selected.id, patch: { flip: e.target.checked } })}
              />
              {t("lineRising")}
            </label>
          )}
          <RetouchSlider
            label={t("strokeWidth")}
            value={selected.strokeWidth}
            min={0}
            max={100}
            step={1}
            neutral={6}
            onChange={(v) => onChange({ type: "updateLayer", id: selected.id, patch: { strokeWidth: v } })}
            neutralReason={t("alreadyNeutral")}
            resetLabel={t("resetValue", { label: t("strokeWidth") })}
            inputLabel={t("valueOf", { label: t("strokeWidth") })}
          />
          <FractionSlider layer={selected} field="w" label={t("shapeWidth")} onChange={onChange} />
          <FractionSlider layer={selected} field="h" label={t("shapeHeight")} onChange={onChange} />
          <PositionSliders layer={selected} onChange={onChange} />
        </PanelSection>
      ) : null}
    </div>
  );
}
