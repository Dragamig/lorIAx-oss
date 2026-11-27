"use client";

import { useId, useState } from "react";
import { useTranslations } from "next-intl";
import { ActionButton } from "../../action-button";
import { MAX_LAYERS, MAX_TEXT_LENGTH, OVERLAY_FONT_KEYS } from "../limits";
import { addText, DEFAULT_TEXT_COLOR, type FontKey } from "../overlays";
import { LayerList } from "./layer-list";
import { Hint, PanelSection, type PanelProps } from "./panel-parts";
import { PositionSliders, FractionSlider } from "./position-sliders";
import { RetouchSlider } from "./retouch-slider";

export interface OverlayPanelProps extends PanelProps {
  selectedId: string | null;
  onSelect: (id: string | null) => void;
}

const FIELD = "border-input bg-background h-8 rounded-md border px-2 text-sm";

export function TextPanel({ recipe, onChange, selectedId, onSelect }: OverlayPanelProps) {
  const t = useTranslations("library.retouch");
  const ids = useId();
  const [draft, setDraft] = useState("");
  const [color, setColor] = useState(DEFAULT_TEXT_COLOR);
  const [font, setFont] = useState<FontKey>("sans");
  const texts = recipe.layers.filter((l) => l.type === "text");
  const selected = texts.find((l) => l.id === selectedId) ?? null;
  const full = recipe.layers.length >= MAX_LAYERS;
  const reason = full ? t("layerLimit", { max: String(MAX_LAYERS) }) : draft.trim() === "" ? t("textEmpty") : undefined;

  const add = () => {
    const res = addText(recipe, draft, { color, font });
    if (!res.ok) return;
    onChange({ type: "addLayer", layer: res.recipe.layers[res.recipe.layers.length - 1] });
    onSelect(res.id);
    setDraft("");
  };

  return (
    <div>
      <PanelSection title={t("sectionAddText")}>
        <label htmlFor={`${ids}-text`} className="text-xs font-medium">
          {t("textLabel")}
        </label>
        <textarea
          id={`${ids}-text`}
          rows={2}
          maxLength={MAX_TEXT_LENGTH}
          value={draft}
          placeholder={t("textPlaceholder")}
          onChange={(e) => setDraft(e.target.value)}
          className="border-input bg-background rounded-md border p-2 text-sm"
        />
        <Hint>{t("textCount", { n: String(draft.length), max: String(MAX_TEXT_LENGTH) })}</Hint>
        <div className="grid grid-cols-2 gap-2">
          <label className="flex flex-col gap-1 text-xs">
            {t("textColor")}
            <input type="color" value={color} onChange={(e) => setColor(e.target.value)} className="h-8 w-full" />
          </label>
          <label className="flex flex-col gap-1 text-xs">
            {t("textFont")}
            <select value={font} onChange={(e) => setFont(e.target.value as FontKey)} className={FIELD}>
              {OVERLAY_FONT_KEYS.map((k) => (
                <option key={k} value={k}>
                  {t(`fonts.${k}`)}
                </option>
              ))}
            </select>
          </label>
        </div>
        <ActionButton id="addText" size="sm" variant="outline" showLabel wrapperClassName="w-full" className="w-full" disabledReason={reason} onAction={add} />
      </PanelSection>

      <PanelSection title={t("layersTitle")}>
        <LayerList layers={texts} selectedId={selectedId} onSelect={onSelect} onChange={onChange} />
      </PanelSection>

      {selected && selected.type === "text" ? (
        <PanelSection title={t("sectionEditText")}>
          <textarea
            aria-label={t("textLabel")}
            rows={2}
            maxLength={MAX_TEXT_LENGTH}
            value={selected.text}
            onChange={(e) => onChange({ type: "updateLayer", id: selected.id, patch: { text: e.target.value } })}
            className="border-input bg-background rounded-md border p-2 text-sm"
          />
          <Hint>{t("textEditHint")}</Hint>
          <div className="grid grid-cols-2 gap-2">
            <label className="flex flex-col gap-1 text-xs">
              {t("textColor")}
              <input
                type="color"
                value={selected.color}
                onChange={(e) => onChange({ type: "updateLayer", id: selected.id, patch: { color: e.target.value } })}
                className="h-8 w-full"
              />
            </label>
            <label className="flex flex-col gap-1 text-xs">
              {t("textFont")}
              <select
                value={selected.font ?? "sans"}
                onChange={(e) => onChange({ type: "updateLayer", id: selected.id, patch: { font: e.target.value as FontKey } })}
                className={FIELD}
              >
                {OVERLAY_FONT_KEYS.map((k) => (
                  <option key={k} value={k}>
                    {t(`fonts.${k}`)}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <RetouchSlider
            label={t("textSize")}
            value={selected.fontSize}
            min={4}
            max={400}
            step={1}
            neutral={60}
            onChange={(v) => onChange({ type: "updateLayer", id: selected.id, patch: { fontSize: v } })}
            neutralReason={t("alreadyNeutral")}
            resetLabel={t("resetValue", { label: t("textSize") })}
            inputLabel={t("valueOf", { label: t("textSize") })}
          />
          <FractionSlider layer={selected} field="w" label={t("boxWidth")} min={1} onChange={onChange} />
          <PositionSliders layer={selected} onChange={onChange} />
        </PanelSection>
      ) : null}
    </div>
  );
}
