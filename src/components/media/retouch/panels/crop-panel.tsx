"use client";

import { useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { RotateCcw, X } from "lucide-react";
import { ActionButton } from "../../action-button";
import { CROP_RATIOS, cropPixels } from "../crop";
import { useHotkeys } from "../use-hotkeys";
import { Hint, PanelSection, type PanelProps } from "./panel-parts";
import { useCropDraft, type CropDraft } from "./use-crop-draft";

export interface CropPanelProps extends PanelProps {
  /** Brouillon partagé avec `CropOverlay` ; sans lui, le panneau gère le sien. */
  draft?: CropDraft;
}

export function CropPanel({ recipe, onChange, draft: shared }: CropPanelProps) {
  const t = useTranslations("library.retouch");
  const locale = useLocale();
  const own = useCropDraft(recipe);
  const draft = shared ?? own;
  const [cw, setCw] = useState("");
  const [ch, setCh] = useState("");
  const [invalid, setInvalid] = useState(false);
  const nf = new Intl.NumberFormat(locale);

  const px = cropPixels(draft.pending, draft.bounds);
  const [shownW, shownH] = recipe.quarterTurns % 2 === 1 ? [px.height, px.width] : [px.width, px.height];

  const apply = () => {
    onChange({ type: "setCrop", crop: draft.pending });
    if (recipe.resize) onChange({ type: "clearResize" });
  };
  const cancel = () => draft.revert();
  const reset = () => {
    draft.full();
    onChange({ type: "setCrop", crop: { x: 0, y: 0, w: 1, h: 1 } });
    if (recipe.resize) onChange({ type: "clearResize" });
  };
  useHotkeys({ Enter: apply, Escape: cancel });

  return (
    <div>
      <PanelSection title={t("sectionFormat")}>
        <div className="grid grid-cols-4 gap-1.5" role="group" aria-label={t("sectionFormat")}>
          {CROP_RATIOS.map((r) => {
            const name = r.key === "free" ? t("ratioFree") : r.key;
            return (
              <ActionButton
                key={r.key}
                id="cropRatio"
                label={t("ratioAria", { ratio: name })}
                size="sm"
                variant={draft.ratioKey === r.key ? "secondary" : "outline"}
                pressed={draft.ratioKey === r.key}
                wrapperClassName="w-full"
                className="w-full"
                onAction={() => draft.selectRatio(r.key)}
              >
                <span>{name}</span>
              </ActionButton>
            );
          })}
        </div>
        <div className="flex items-end gap-1.5">
          <label className="flex flex-1 flex-col gap-0.5 text-xs">
            {t("customWidth")}
            <input
              type="number"
              min={1}
              inputMode="decimal"
              value={cw}
              placeholder="5"
              aria-invalid={invalid || undefined}
              onChange={(e) => setCw(e.target.value)}
              className="border-input bg-background h-7 w-full rounded-md border px-1.5 text-xs"
            />
          </label>
          <span className="pb-1">:</span>
          <label className="flex flex-1 flex-col gap-0.5 text-xs">
            {t("customHeight")}
            <input
              type="number"
              min={1}
              inputMode="decimal"
              value={ch}
              placeholder="4"
              aria-invalid={invalid || undefined}
              onChange={(e) => setCh(e.target.value)}
              className="border-input bg-background h-7 w-full rounded-md border px-1.5 text-xs"
            />
          </label>
        </div>
        {invalid ? (
          <p role="alert" className="text-destructive text-xs">
            {t("ratioInvalid")}
          </p>
        ) : null}
        <ActionButton
          id="applyCustomRatio"
          size="sm"
          variant="outline"
          showLabel
          wrapperClassName="w-full"
          className="w-full"
          onAction={() => setInvalid(!draft.applyCustomRatio(cw, ch))}
        />
      </PanelSection>
      <PanelSection title={t("sectionZone")}>
        <Hint role="status">{t("zoneInfo", { w: nf.format(shownW), h: nf.format(shownH) })}</Hint>
        <Hint>{t("zoneHint")}</Hint>
        <ActionButton id="cropApply" variant="default" size="default" showLabel wrapperClassName="w-full" className="w-full" onAction={apply} />
        <div className="grid grid-cols-2 gap-1.5">
          {/* Libellés courts affichés ; le nom accessible et l'info-bulle gardent le libellé complet du registre. */}
          <ActionButton id="cropCancel" size="sm" variant="outline" wrapperClassName="w-full" className="w-full" onAction={cancel}>
            <X aria-hidden="true" />
            <span className="truncate">{t("cropCancelShort")}</span>
          </ActionButton>
          <ActionButton id="cropReset" size="sm" variant="outline" wrapperClassName="w-full" className="w-full" onAction={reset}>
            <RotateCcw aria-hidden="true" />
            <span className="truncate">{t("cropResetShort")}</span>
          </ActionButton>
        </div>
      </PanelSection>
    </div>
  );
}
