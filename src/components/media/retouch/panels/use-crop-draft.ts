"use client";

import { useState } from "react";
import { CROP_RATIOS, clampCrop, parseRatioInput, type Bounds, type Crop, type RatioKey } from "../crop";
import { centeredCrop, type RetouchRecipe } from "../recipe";

export interface CropDraft {
  pending: Crop;
  ratioKey: RatioKey;
  /** Ratio de sortie effectif dans le repère de l'image source (inversé après un quart de tour). */
  ratio: number | null;
  bounds: Bounds;
  setPending: (crop: Crop) => void;
  selectRatio: (key: RatioKey) => void;
  applyCustomRatio: (w: string, h: string) => boolean;
  /** Remet la zone de la recette (annuler le recadrage en cours). */
  revert: () => void;
  /** Zone entière, sans ratio imposé. */
  full: () => void;
}

/** Zone de recadrage en cours d'édition : partagée entre le panneau et la superposition sur l'image. */
export function useCropDraft(recipe: RetouchRecipe): CropDraft {
  const bounds: Bounds = { width: recipe.source.width, height: recipe.source.height };
  const odd = recipe.quarterTurns % 2 === 1;
  const [ratioKey, setRatioKey] = useState<RatioKey>("free");
  const [custom, setCustom] = useState<number | null>(null);
  const [pending, setPendingState] = useState<Crop>(recipe.crop);

  // Annuler ou rétablir dans l'historique remplace la zone de la recette (synchronisation pendant le rendu).
  const [syncedCrop, setSyncedCrop] = useState<Crop>(recipe.crop);
  if (syncedCrop !== recipe.crop) {
    setSyncedCrop(recipe.crop);
    setPendingState(recipe.crop);
  }

  const baseOf = (key: RatioKey): number | null =>
    key === "custom" ? custom : (CROP_RATIOS.find((r) => r.key === key)?.ratio ?? null);
  const effective = (base: number | null) => (base === null ? null : odd ? 1 / base : base);
  const ratio = effective(baseOf(ratioKey));

  const setPending = (c: Crop) => setPendingState(clampCrop(c, ratio, bounds));

  const selectRatio = (key: RatioKey) => {
    setRatioKey(key);
    const r = effective(baseOf(key));
    if (r !== null) setPendingState(centeredCrop(bounds, r));
  };

  const applyCustomRatio = (w: string, h: string) => {
    const parsed = parseRatioInput(w, h);
    if (!parsed.ok) return false;
    setCustom(parsed.ratio);
    setRatioKey("custom");
    setPendingState(centeredCrop(bounds, odd ? 1 / parsed.ratio : parsed.ratio));
    return true;
  };

  const revert = () => setPendingState(recipe.crop);
  const full = () => {
    setRatioKey("free");
    setPendingState({ x: 0, y: 0, w: 1, h: 1 });
  };

  return { pending, ratioKey, ratio, bounds, setPending, selectRatio, applyCustomRatio, revert, full };
}
