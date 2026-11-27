"use client";

import { useTranslations } from "next-intl";
import { ActionButton } from "../../action-button";
import { PRESET_KEYS, type PresetKey } from "../recipe";
import { PanelSection, type PanelProps } from "./panel-parts";

/** Aperçu approché des filtres sur la vignette (CSS) ; le rendu réel passe par Fabric. */
const CSS_FILTERS: Record<PresetKey, string> = {
  none: "none",
  blackWhite: "grayscale(1) contrast(1.1)",
  sepia: "sepia(1)",
  warm: "sepia(0.3) saturate(1.2) hue-rotate(-10deg)",
  cool: "saturate(1.1) hue-rotate(15deg)",
  highContrast: "contrast(1.45) saturate(1.1)",
  faded: "contrast(0.8) brightness(1.1) saturate(0.7)",
  vivid: "saturate(1.5) contrast(1.1)",
};

/** Gabarit unique de toutes les tuiles : largeur pleine de colonne, hauteur fixe, pied fixe tronqué. */
export const PRESET_TILE_CLASS =
  "flex h-[88px] w-full flex-col items-stretch justify-start gap-0 overflow-hidden p-0";
export const PRESET_THUMB_CLASS = "h-14 w-full shrink-0 overflow-hidden bg-muted";
export const PRESET_FOOT_CLASS = "flex h-[30px] w-full shrink-0 items-center px-1.5 text-xs";
export const PRESET_GRID_CLASS = "grid grid-cols-2 gap-2";

export interface FiltersPanelProps extends PanelProps {
  /** Image servie par la médiathèque, utilisée pour les vignettes ; absente : vignette neutre. */
  sourceUrl?: string;
}

export function FiltersPanel({ recipe, onChange, sourceUrl }: FiltersPanelProps) {
  const t = useTranslations("library.retouch");
  return (
    <div>
      <PanelSection title={t("presetsTitle")}>
        <div className={PRESET_GRID_CLASS} role="group" aria-label={t("presetsTitle")}>
          {PRESET_KEYS.map((key) => {
            const name = t(`presets.${key}`);
            const active = recipe.preset === key;
            return (
              <ActionButton
                key={key}
                id="applyPreset"
                label={t("presetAria", { name })}
                variant={active ? "secondary" : "outline"}
                size="default"
                pressed={active}
                wrapperClassName="w-full"
                className={`${PRESET_TILE_CLASS} ${active ? "ring-primary ring-2" : ""}`}
                onAction={() => onChange({ type: "setPreset", preset: key })}
              >
                <span className={PRESET_THUMB_CLASS}>
                  {sourceUrl ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      alt=""
                      src={sourceUrl}
                      className="h-full w-full object-cover"
                      style={{ filter: CSS_FILTERS[key] }}
                    />
                  ) : null}
                </span>
                <span className={PRESET_FOOT_CLASS}>
                  <span className="truncate">{name}</span>
                </span>
              </ActionButton>
            );
          })}
        </div>
      </PanelSection>
    </div>
  );
}
