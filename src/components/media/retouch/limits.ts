/** Plafonds de sortie du retoucheur (mémoire bornée côté navigateur et serveur). */
export const MAX_OUTPUT_SIDE = 8192;
export const MAX_OUTPUT_PIXELS = 24_000_000;
/** Côté maximal de la copie de travail de l'aperçu. */
export const PREVIEW_MAX_SIDE = 2048;
/** Nombre maximal d'états conservés par l'historique. */
export const HISTORY_LIMIT = 50;
/** Deux réglages d'un même curseur dans ce délai fusionnent en une entrée. */
export const HISTORY_MERGE_MS = 500;
export const MAX_LAYERS = 20;
export const MAX_TEXT_LENGTH = 500;

/** Bornes de chaque réglage. */
export const ADJUSTMENT_BOUNDS = {
  brightness: { min: -100, max: 100, neutral: 0 },
  contrast: { min: -100, max: 100, neutral: 0 },
  saturation: { min: -100, max: 100, neutral: 0 },
  vibrance: { min: -100, max: 100, neutral: 0 },
  exposure: { min: 0.5, max: 2.5, neutral: 1 },
  temperature: { min: -100, max: 100, neutral: 0 },
  tint: { min: -100, max: 100, neutral: 0 },
} as const;

export const DETAIL_BOUNDS = { min: 0, max: 100 } as const;

/** Polices des calques texte : piles système uniquement, aucune police chargée à distance. */
export const OVERLAY_FONT_KEYS = ["sans", "serif", "mono", "display"] as const;
