import { filters as fabricFilters } from "fabric";
import { ADJUSTMENT_BOUNDS, DETAIL_BOUNDS } from "./limits";
import { PRESETS } from "./presets";
import type { Adjustments, PresetKey } from "./recipe";
import { ADJUSTMENT_KEYS } from "./recipe";

export type FabricFilter = InstanceType<typeof fabricFilters.BaseFilter>;

export interface Detail {
  blur: number;
  sharpen: number;
}

/** Intensité maximale du coefficient de netteté (noyau 3x3, somme toujours égale à 1). */
const SHARPEN_MAX = 1;
/** Flou maximal en fraction de l'image (échelle du filtre Blur de Fabric). */
const BLUR_MAX = 0.15;
/** Amplitude de la température et de la teinte sur les canaux (0 à 1). */
const TONE_AMPLITUDE = 0.2;

const clamp = (v: number, min: number, max: number) => Math.min(max, Math.max(min, v));
const isZero = (v: number) => Math.abs(v) < 1e-9;

/** Réglages utilisateur additionnés au décalage du filtre prédéfini, ramenés dans leurs bornes. */
export function mergePreset(adjustments: Adjustments, preset: PresetKey): Adjustments {
  const offsets = PRESETS[preset] ?? {};
  const out = { ...adjustments };
  for (const k of ADJUSTMENT_KEYS) {
    const b = ADJUSTMENT_BOUNDS[k];
    out[k] = clamp(adjustments[k] + (offsets[k] ?? 0), b.min, b.max);
  }
  return out;
}

/** Matrice 4x5 de Fabric : température (rouge/bleu) et teinte (vert/magenta). */
export function toneMatrix(temperature: number, tint: number): number[] {
  const t = (temperature / 100) * TONE_AMPLITUDE;
  const g = (tint / 100) * TONE_AMPLITUDE;
  return [
    1 + t, 0, 0, 0, 0,
    0, 1 - g, 0, 0, 0,
    0, 0, 1 - t, 0, 0,
    0, 0, 0, 1, 0,
  ];
}

/** Noyau de netteté 3x3 (accentuation par laplacien), de somme 1. */
export function sharpenMatrix(sharpen: number): number[] {
  const a = (clamp(sharpen, DETAIL_BOUNDS.min, DETAIL_BOUNDS.max) / 100) * SHARPEN_MAX;
  return [0, -a, 0, -a, 1 + 4 * a, -a, 0, -a, 0];
}

export function isNeutral(adjustments: Adjustments, detail: Detail, preset: PresetKey = "none"): boolean {
  if (preset !== "none") return false;
  for (const k of ADJUSTMENT_KEYS) {
    if (!isZero(adjustments[k] - ADJUSTMENT_BOUNDS[k].neutral)) return false;
  }
  return isZero(detail.blur) && isZero(detail.sharpen);
}

/**
 * Filtres Fabric v7 d'une recette. Ordre fixe : exposition, luminosité, contraste, saturation,
 * vibrance, température et teinte, filtre prédéfini, netteté, flou. Réglages neutres : liste vide.
 */
export function buildFabricFilters(
  adjustments: Adjustments,
  detail: Detail,
  preset: PresetKey = "none",
): FabricFilter[] {
  const a = mergePreset(adjustments, preset);
  const out: FabricFilter[] = [];

  if (!isZero(a.exposure - ADJUSTMENT_BOUNDS.exposure.neutral)) {
    // Gamma de Fabric : valeurs documentées de 0,01 à 2,2 ; plus grand = plus clair.
    const g = clamp(a.exposure, 0.01, 2.2);
    out.push(new fabricFilters.Gamma({ gamma: [g, g, g] }));
  }
  if (!isZero(a.brightness)) out.push(new fabricFilters.Brightness({ brightness: a.brightness / 200 }));
  if (!isZero(a.contrast)) out.push(new fabricFilters.Contrast({ contrast: a.contrast / 100 }));
  if (!isZero(a.saturation)) out.push(new fabricFilters.Saturation({ saturation: a.saturation / 100 }));
  if (!isZero(a.vibrance)) out.push(new fabricFilters.Vibrance({ vibrance: a.vibrance / 100 }));
  if (!isZero(a.temperature) || !isZero(a.tint)) {
    out.push(new fabricFilters.ColorMatrix({ matrix: toneMatrix(a.temperature, a.tint) as never }));
  }
  if (preset === "blackWhite") out.push(new fabricFilters.Grayscale());
  if (preset === "sepia") out.push(new fabricFilters.Sepia());
  if (detail.sharpen > 0) out.push(new fabricFilters.Convolute({ matrix: sharpenMatrix(detail.sharpen) }));
  if (detail.blur > 0) out.push(new fabricFilters.Blur({ blur: (detail.blur / 100) * BLUR_MAX }));
  return out;
}
