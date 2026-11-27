"use client";

import { useTranslations } from "next-intl";
import { ActionButton } from "../../action-button";
import { DETAIL_BOUNDS } from "../limits";
import { PanelSection, type PanelProps } from "./panel-parts";
import { RetouchSlider } from "./retouch-slider";

export function DetailPanel({ recipe, onChange }: PanelProps) {
  const t = useTranslations("library.retouch");
  const common = {
    min: DETAIL_BOUNDS.min,
    max: DETAIL_BOUNDS.max,
    step: 1,
    neutral: 0,
    neutralReason: t("alreadyNeutral"),
  };
  const sharpen = t("detailSharpen");
  const blur = t("detailBlur");
  const dirty = recipe.sharpen !== 0 || recipe.blur !== 0;
  return (
    <div>
      <PanelSection title={sharpen}>
        <RetouchSlider
          {...common}
          label={sharpen}
          value={recipe.sharpen}
          onChange={(value) => onChange({ type: "setSharpen", value })}
          resetLabel={t("resetValue", { label: sharpen })}
          inputLabel={t("valueOf", { label: sharpen })}
        />
      </PanelSection>
      <PanelSection title={blur}>
        <RetouchSlider
          {...common}
          label={blur}
          value={recipe.blur}
          onChange={(value) => onChange({ type: "setBlur", value })}
          resetLabel={t("resetValue", { label: blur })}
          inputLabel={t("valueOf", { label: blur })}
        />
      </PanelSection>
      <div className="px-3 py-2.5">
        <ActionButton
          id="resetDetail"
          size="sm"
          variant="outline"
          showLabel
          wrapperClassName="w-full"
          className="w-full"
          disabledReason={dirty ? undefined : t("nothingToReset")}
          onAction={() => {
            if (recipe.sharpen !== 0) onChange({ type: "setSharpen", value: 0 });
            if (recipe.blur !== 0) onChange({ type: "setBlur", value: 0 });
          }}
        />
      </div>
    </div>
  );
}
