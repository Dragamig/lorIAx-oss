"use client";

import { useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { ActionButton } from "../../action-button";
import { MAX_OUTPUT_PIXELS, MAX_OUTPUT_SIDE } from "../limits";
import { outputSize } from "../recipe";
import { Hint, PanelSection, type PanelProps } from "./panel-parts";

const SCALES = [100, 50, 25] as const;

export function ResizePanel({ recipe, onChange }: PanelProps) {
  const t = useTranslations("library.retouch");
  const locale = useLocale();
  const nf = new Intl.NumberFormat(locale, { maximumFractionDigits: 1 });
  const out = outputSize(recipe);
  const natural = outputSize({ ...recipe, resize: null });
  const [lock, setLock] = useState(true);
  const [w, setW] = useState(String(out.width));
  const [h, setH] = useState(String(out.height));

  // Les champs suivent la taille de sortie quand elle change ailleurs (annuler, échelle, recadrage).
  const [synced, setSynced] = useState(`${out.width}x${out.height}`);
  if (synced !== `${out.width}x${out.height}`) {
    setSynced(`${out.width}x${out.height}`);
    setW(String(out.width));
    setH(String(out.height));
  }

  const commit = (axis: "width" | "height") => {
    const n = Math.round(Number(axis === "width" ? w : h));
    if (!Number.isFinite(n) || n < 1) {
      setW(String(out.width));
      setH(String(out.height));
      return;
    }
    if (n === out[axis]) return;
    onChange({ type: "resize", [axis]: n, lockRatio: lock });
  };

  const typedW = Number(w);
  const typedH = Number(h);
  const capped =
    typedW > MAX_OUTPUT_SIDE || typedH > MAX_OUTPUT_SIDE || typedW * typedH > MAX_OUTPUT_PIXELS;
  const limits = { side: nf.format(MAX_OUTPUT_SIDE), pixels: nf.format(MAX_OUTPUT_PIXELS / 1e6) };
  const rawCrop = {
    w: Math.round(recipe.source.width * recipe.crop.w),
    h: Math.round(recipe.source.height * recipe.crop.h),
  };
  const field = (id: string, label: string, value: string, set: (v: string) => void, axis: "width" | "height") => (
    <label className="flex min-w-0 flex-1 flex-col gap-0.5 text-xs">
      {label}
      <input
        id={id}
        type="number"
        min={1}
        max={MAX_OUTPUT_SIDE}
        value={value}
        onChange={(e) => set(e.target.value)}
        onBlur={() => commit(axis)}
        onKeyDown={(e) => {
          if (e.key === "Enter") commit(axis);
        }}
        className="border-input bg-background h-7 w-full rounded-md border px-1.5 text-xs tabular-nums"
      />
    </label>
  );

  return (
    <div>
      <PanelSection title={t("sizeTitle")}>
        <div className="flex items-end gap-1.5">
          {field("retouch-width", t("widthPx"), w, setW, "width")}
          <ActionButton
            id="lockRatio"
            label={lock ? t("lockOn") : t("lockOff")}
            size="icon-sm"
            variant={lock ? "secondary" : "outline"}
            pressed={lock}
            onAction={() => setLock((v) => !v)}
          />
          {field("retouch-height", t("heightPx"), h, setH, "height")}
        </div>
        <Hint>
          {t("megapixels", { value: nf.format((out.width * out.height) / 1e6), ...limits })}
        </Hint>
        {capped ? (
          <Hint role="status">{t("capped", limits)}</Hint>
        ) : null}
        <div className="grid grid-cols-3 gap-1.5">
          {SCALES.map((p) => (
            <ActionButton
              key={p}
              id="scaleTo"
              label={t("scaleAria", { percent: String(p) })}
              size="sm"
              variant="outline"
              wrapperClassName="w-full"
              className="w-full"
              onAction={() => onChange({ type: "resize", width: Math.round((natural.width * p) / 100), lockRatio: true })}
            >
              <span>{t("scaleLabel", { percent: String(p) })}</span>
            </ActionButton>
          ))}
        </div>
      </PanelSection>
      <PanelSection title={t("sourceTitle")}>
        <Hint>{t("sourceOriginal", { w: nf.format(recipe.source.width), h: nf.format(recipe.source.height) })}</Hint>
        <Hint>{t("sourceCropped", { w: nf.format(rawCrop.w), h: nf.format(rawCrop.h) })}</Hint>
      </PanelSection>
    </div>
  );
}
