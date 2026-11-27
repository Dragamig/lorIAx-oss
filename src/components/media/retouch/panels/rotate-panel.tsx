"use client";

import { useTranslations } from "next-intl";
import { ActionButton } from "../../action-button";
import { useHotkeys } from "../use-hotkeys";
import { Hint, PanelSection, type PanelProps } from "./panel-parts";
import { RetouchSlider } from "./retouch-slider";

export interface RotatePanelProps extends PanelProps {
  /** Raccourcis R, Maj+R, Maj+H, Maj+V portés par le panneau ; faux quand le retoucheur les gère globalement. */
  hotkeys?: boolean;
}

export function RotatePanel({ recipe, onChange, hotkeys = true }: RotatePanelProps) {
  const t = useTranslations("library.retouch");
  const left = () => onChange({ type: "rotate", quarters: -1 });
  const right = () => onChange({ type: "rotate", quarters: 1 });
  const flipH = () => onChange({ type: "flip", axis: "h" });
  const flipV = () => onChange({ type: "flip", axis: "v" });
  useHotkeys({ R: right, "Shift+R": left, "Shift+H": flipH, "Shift+V": flipV }, hotkeys);

  return (
    <div>
      <PanelSection title={t("sectionPivot")}>
        <div className="grid grid-cols-2 gap-1.5">
          <ActionButton id="rotateLeft" size="sm" variant="outline" showLabel wrapperClassName="w-full" className="w-full" onAction={left} />
          <ActionButton id="rotateRight" size="sm" variant="outline" showLabel wrapperClassName="w-full" className="w-full" onAction={right} />
        </div>
        <RetouchSlider
          label={t("angle")}
          value={recipe.angle}
          min={-45}
          max={45}
          step={1}
          neutral={0}
          unit="°"
          onChange={(value) => onChange({ type: "setAngle", angle: value })}
          neutralReason={t("alreadyNeutral")}
          resetLabel={t("resetValue", { label: t("angle") })}
          inputLabel={t("valueOf", { label: t("angle") })}
        />
        <Hint role="status">{t("rotationNow", { deg: String(recipe.quarterTurns * 90 + recipe.angle) })}</Hint>
      </PanelSection>
      <PanelSection title={t("sectionMirror")}>
        <div className="grid grid-cols-2 gap-1.5">
          <ActionButton id="flipH" size="sm" variant={recipe.flipH ? "secondary" : "outline"} pressed={recipe.flipH} showLabel wrapperClassName="w-full" className="w-full" onAction={flipH} />
          <ActionButton id="flipV" size="sm" variant={recipe.flipV ? "secondary" : "outline"} pressed={recipe.flipV} showLabel wrapperClassName="w-full" className="w-full" onAction={flipV} />
        </div>
      </PanelSection>
    </div>
  );
}
