"use client";

import { useTranslations } from "next-intl";
import type { Layer, RetouchOp } from "../recipe";
import { RetouchSlider } from "./retouch-slider";

/** Curseur en pourcentage de la sortie pour un champ fractionnaire d'un calque. */
export function FractionSlider({
  layer,
  field,
  label,
  onChange,
  min = 0,
}: {
  layer: Layer;
  field: "x" | "y" | "w" | "h";
  label: string;
  onChange: (op: RetouchOp) => void;
  min?: number;
}) {
  const t = useTranslations("library.retouch");
  const raw = (layer as unknown as Record<string, number | undefined>)[field] ?? 0.5;
  return (
    <RetouchSlider
      label={label}
      value={Math.round(raw * 100)}
      min={min}
      max={100}
      step={1}
      neutral={min}
      unit=" %"
      onChange={(v) => onChange({ type: "updateLayer", id: layer.id, patch: { [field]: v / 100 } as never })}
      neutralReason={t("alreadyNeutral")}
      resetLabel={t("resetValue", { label })}
      inputLabel={t("valueOf", { label })}
    />
  );
}

export function PositionSliders({ layer, onChange }: { layer: Layer; onChange: (op: RetouchOp) => void }) {
  const t = useTranslations("library.retouch");
  return (
    <>
      <FractionSlider layer={layer} field="x" label={t("posX")} onChange={onChange} />
      <FractionSlider layer={layer} field="y" label={t("posY")} onChange={onChange} />
    </>
  );
}
