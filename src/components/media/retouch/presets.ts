import type { Adjustments, PresetKey } from "./recipe";

/**
 * Décalages de réglages ajoutés à ceux de l'utilisateur par chaque filtre prédéfini.
 * Les filtres `blackWhite` et `sepia` ajoutent en plus un filtre Fabric dédié (voir filters.ts).
 */
export const PRESETS: Record<PresetKey, Partial<Adjustments>> = {
  none: {},
  blackWhite: { contrast: 10 },
  sepia: { contrast: 5 },
  warm: { temperature: 35, saturation: 10, tint: 5 },
  cool: { temperature: -35, saturation: 5, tint: -5 },
  highContrast: { contrast: 45, saturation: 10 },
  faded: { contrast: -25, brightness: 10, saturation: -25 },
  vivid: { saturation: 35, vibrance: 40, contrast: 10 },
};
