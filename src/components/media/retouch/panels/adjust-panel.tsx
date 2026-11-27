"use client";

import { useTranslations } from "next-intl";
import { ActionButton } from "../../action-button";
import { ADJUSTMENT_BOUNDS } from "../limits";
import { ADJUSTMENT_KEYS, type AdjustmentKey } from "../recipe";
import { PanelSection, type PanelProps } from "./panel-parts";
import { RetouchSlider } from "./retouch-slider";

const LIGHT: AdjustmentKey[] = ["brightness", "contrast", "exposure"];
const COLOR: AdjustmentKey[] = ["saturation", "vibrance", "temperature", "tint"];

export function AdjustPanel({ recipe, onChange }: PanelProps) {
  const t = useTranslations("library.retouch");
  const dirty = ADJUSTMENT_KEYS.filter((k) => recipe.adjustments[k] !== ADJUSTMENT_BOUNDS[k].neutral);

  const slider = (key: AdjustmentKey) => {
    const b = ADJUSTMENT_BOUNDS[key];
    const label = t(`adjustments.${key}`);
    return (
      <RetouchSlider
        key={key}
        label={label}
        value={recipe.adjustments[key]}
        min={b.min}
        max={b.max}
        step={key === "exposure" ? 0.05 : 1}
        neutral={b.neutral}
        onChange={(value) => onChange({ type: "setAdjustment", key, value })}
        neutralReason={t("alreadyNeutral")}
        resetLabel={t("resetValue", { label })}
        inputLabel={t("valueOf", { label })}
      />
    );
  };

  return (
    <div>
      <PanelSection title={t("sectionLight")}>{LIGHT.map(slider)}</PanelSection>
      <PanelSection title={t("sectionColor")}>{COLOR.map(slider)}</PanelSection>
      <div className="px-3 py-2.5">
        <ActionButton
          id="resetAdjustments"
          size="sm"
          variant="outline"
          showLabel
          wrapperClassName="w-full"
          className="w-full"
          disabledReason={dirty.length === 0 ? t("nothingToReset") : undefined}
          onAction={() =>
            dirty.forEach((key) => onChange({ type: "setAdjustment", key, value: ADJUSTMENT_BOUNDS[key].neutral }))
          }
        />
      </div>
    </div>
  );
}
