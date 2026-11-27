import { z } from "zod";
import {
  ADJUSTMENT_BOUNDS,
  DETAIL_BOUNDS,
  MAX_LAYERS,
  MAX_OUTPUT_PIXELS,
  MAX_OUTPUT_SIDE,
  MAX_TEXT_LENGTH,
  OVERLAY_FONT_KEYS,
} from "./limits";

export const PRESET_KEYS = ["none", "blackWhite", "sepia", "warm", "cool", "highContrast", "faded", "vivid"] as const;
export type PresetKey = (typeof PRESET_KEYS)[number];

export const ADJUSTMENT_KEYS = ["brightness", "contrast", "saturation", "vibrance", "exposure", "temperature", "tint"] as const;
export type AdjustmentKey = (typeof ADJUSTMENT_KEYS)[number];
export type Adjustments = Record<AdjustmentKey, number>;

const HEX = /^#[0-9a-fA-F]{6}$/;
const fraction = z.number().min(0).max(1);
const adjustmentField = (k: AdjustmentKey) =>
  z.number().min(ADJUSTMENT_BOUNDS[k].min).max(ADJUSTMENT_BOUNDS[k].max);
const sideField = z.number().int().min(1).max(MAX_OUTPUT_SIDE);

const layerBase = { id: z.string().min(1).max(64), x: fraction, y: fraction };
const textLayerSchema = z.object({
  ...layerBase,
  type: z.literal("text"),
  text: z.string().min(1).max(MAX_TEXT_LENGTH),
  /** Largeur de la boîte, en fraction de la largeur de sortie (0,5 par défaut). */
  w: fraction.gt(0).optional(),
  /** Corps en millièmes du petit côté de sortie : même rendu à toute résolution. */
  fontSize: z.number().min(4).max(400),
  color: z.string().regex(HEX),
  font: z.enum(OVERLAY_FONT_KEYS).optional(),
});
const shapeLayerSchema = z.object({
  ...layerBase,
  type: z.literal("shape"),
  shape: z.enum(["rect", "ellipse", "line", "arrow"]),
  /** Ligne ou flèche : trace la diagonale montante (bas gauche vers haut droit). */
  flip: z.boolean().optional(),
  w: fraction,
  h: fraction,
  fill: z.string().regex(HEX).nullable(),
  stroke: z.string().regex(HEX).nullable(),
  /** Épaisseur en millièmes du petit côté de sortie. */
  strokeWidth: z.number().min(0).max(100),
});
export const layerSchema = z.discriminatedUnion("type", [textLayerSchema, shapeLayerSchema]);

export const recipeSchema = z
  .object({
    source: z.object({ width: z.number().int().min(1), height: z.number().int().min(1) }),
    /** Recadrage en fractions de l'image source. */
    crop: z.object({ x: fraction, y: fraction, w: z.number().gt(0).max(1), h: z.number().gt(0).max(1) }),
    /** Quarts de tour dans le sens horaire (0 à 3). */
    quarterTurns: z.number().int().min(0).max(3),
    /** Angle fin en degrés. */
    angle: z.number().min(-45).max(45),
    flipH: z.boolean(),
    flipV: z.boolean(),
    /** Taille de sortie imposée ; nulle = taille naturelle du recadrage. */
    resize: z.object({ width: sideField, height: sideField }).nullable(),
    adjustments: z.object({
      brightness: adjustmentField("brightness"),
      contrast: adjustmentField("contrast"),
      saturation: adjustmentField("saturation"),
      vibrance: adjustmentField("vibrance"),
      exposure: adjustmentField("exposure"),
      temperature: adjustmentField("temperature"),
      tint: adjustmentField("tint"),
    }),
    preset: z.enum(PRESET_KEYS),
    blur: z.number().min(DETAIL_BOUNDS.min).max(DETAIL_BOUNDS.max),
    sharpen: z.number().min(DETAIL_BOUNDS.min).max(DETAIL_BOUNDS.max),
    layers: z.array(layerSchema).max(MAX_LAYERS),
  })
  .refine((r) => r.crop.x + r.crop.w <= 1 + 1e-9 && r.crop.y + r.crop.h <= 1 + 1e-9, {
    message: "Le recadrage sort de l'image",
    path: ["crop"],
  })
  .refine((r) => !r.resize || (r.resize.width * r.resize.height <= MAX_OUTPUT_PIXELS), {
    message: "Sortie au-dessus de 24 mégapixels",
    path: ["resize"],
  });

export type Layer = z.infer<typeof layerSchema>;
export type RetouchRecipe = z.infer<typeof recipeSchema>;
type Fields<L> = Partial<Omit<L, "id" | "type">>;
/** Modification partielle d'un calque texte ou forme. */
export type LayerPatch = Fields<Extract<Layer, { type: "text" }>> | Fields<Extract<Layer, { type: "shape" }>>;

export function neutralAdjustments(): Adjustments {
  const out = {} as Adjustments;
  for (const k of ADJUSTMENT_KEYS) out[k] = ADJUSTMENT_BOUNDS[k].neutral;
  return out;
}

export function emptyRecipe(source: { width: number; height: number }): RetouchRecipe {
  return {
    source: { width: source.width, height: source.height },
    crop: { x: 0, y: 0, w: 1, h: 1 },
    quarterTurns: 0,
    angle: 0,
    flipH: false,
    flipV: false,
    resize: null,
    adjustments: neutralAdjustments(),
    preset: "none",
    blur: 0,
    sharpen: 0,
    layers: [],
  };
}

/** Plafonne en conservant le ratio : 8 192 px de côté et 24 mégapixels. */
function capSize(width: number, height: number): { width: number; height: number } {
  let w = Math.max(1, width);
  let h = Math.max(1, height);
  const sideScale = Math.min(1, MAX_OUTPUT_SIDE / Math.max(w, h));
  const pixelScale = Math.min(1, Math.sqrt(MAX_OUTPUT_PIXELS / (w * h)));
  const scale = Math.min(sideScale, pixelScale);
  if (scale < 1) {
    w = Math.floor(w * scale);
    h = Math.floor(h * scale);
  }
  return { width: Math.max(1, w), height: Math.max(1, h) };
}

/** Taille de sortie : recadrage, quarts de tour, redimensionnement, puis plafonds. */
export function outputSize(r: RetouchRecipe): { width: number; height: number } {
  if (r.resize) return capSize(r.resize.width, r.resize.height);
  let w = Math.round(r.source.width * r.crop.w);
  let h = Math.round(r.source.height * r.crop.h);
  if (r.quarterTurns % 2 === 1) [w, h] = [h, w];
  return capSize(w, h);
}

/** Recadrage centré au ratio demandé (largeur / hauteur), le plus grand possible. */
export function centeredCrop(source: { width: number; height: number }, ratio: number): RetouchRecipe["crop"] {
  const sourceRatio = source.width / source.height;
  if (ratio >= sourceRatio) {
    const h = sourceRatio / ratio;
    return { x: 0, y: (1 - h) / 2, w: 1, h };
  }
  const w = ratio / sourceRatio;
  return { x: (1 - w) / 2, y: 0, w, h: 1 };
}

const clamp = (v: number, min: number, max: number) => Math.min(max, Math.max(min, v));

export type RetouchOp =
  | { type: "setCrop"; crop: RetouchRecipe["crop"] }
  | { type: "rotate"; quarters: number }
  | { type: "setAngle"; angle: number }
  | { type: "flip"; axis: "h" | "v" }
  /** Un seul côté fourni : l'autre suit le ratio de la sortie naturelle (verrou actif par défaut). */
  | { type: "resize"; width?: number; height?: number; lockRatio?: boolean }
  | { type: "clearResize" }
  | { type: "setAdjustment"; key: AdjustmentKey; value: number }
  | { type: "setPreset"; preset: PresetKey }
  | { type: "setBlur"; value: number }
  | { type: "setSharpen"; value: number }
  | { type: "addLayer"; layer: Layer }
  | { type: "removeLayer"; id: string }
  /** Modifie un calque ; un texte vide le supprime, un texte long est tronqué. */
  | { type: "updateLayer"; id: string; patch: LayerPatch }
  | { type: "reset" };

function updateLayer(r: RetouchRecipe, id: string, patch: LayerPatch): RetouchRecipe {
  const layers: Layer[] = [];
  for (const l of r.layers) {
    if (l.id !== id) {
      layers.push(l);
      continue;
    }
    const next = { ...l, ...patch } as Layer;
    next.x = clamp(next.x, 0, 1);
    next.y = clamp(next.y, 0, 1);
    if (next.type === "text") {
      next.text = next.text.slice(0, MAX_TEXT_LENGTH);
      if (next.text.trim() === "") continue;
      if (next.w !== undefined) next.w = clamp(next.w, 0.01, 1);
      next.fontSize = clamp(next.fontSize, 4, 400);
    } else {
      next.w = clamp(next.w, 0, 1);
      next.h = clamp(next.h, 0, 1);
      next.strokeWidth = clamp(next.strokeWidth, 0, 100);
    }
    layers.push(next);
  }
  return { ...r, layers };
}

/** Applique une opération sans muter la recette ; les valeurs sont ramenées dans leurs bornes. */
export function applyOp(r: RetouchRecipe, op: RetouchOp): RetouchRecipe {
  switch (op.type) {
    case "setCrop": {
      const w = clamp(op.crop.w, 0.001, 1);
      const h = clamp(op.crop.h, 0.001, 1);
      return { ...r, crop: { x: clamp(op.crop.x, 0, 1 - w), y: clamp(op.crop.y, 0, 1 - h), w, h } };
    }
    case "rotate":
      return { ...r, quarterTurns: (((r.quarterTurns + op.quarters) % 4) + 4) % 4 };
    case "setAngle":
      return { ...r, angle: clamp(op.angle, -45, 45) };
    case "flip":
      return op.axis === "h" ? { ...r, flipH: !r.flipH } : { ...r, flipV: !r.flipV };
    case "resize": {
      const base = outputSize({ ...r, resize: null });
      const cur = r.resize ?? base;
      const ratio = base.width / base.height;
      let width = op.width ?? cur.width;
      let height = op.height ?? cur.height;
      if (op.lockRatio !== false) {
        if (op.width !== undefined) height = width / ratio;
        else if (op.height !== undefined) width = height * ratio;
      }
      return { ...r, resize: capSize(Math.round(width), Math.round(height)) };
    }
    case "clearResize":
      return { ...r, resize: null };
    case "setAdjustment": {
      const b = ADJUSTMENT_BOUNDS[op.key];
      return { ...r, adjustments: { ...r.adjustments, [op.key]: clamp(op.value, b.min, b.max) } };
    }
    case "setPreset":
      return { ...r, preset: op.preset };
    case "setBlur":
      return { ...r, blur: clamp(op.value, DETAIL_BOUNDS.min, DETAIL_BOUNDS.max) };
    case "setSharpen":
      return { ...r, sharpen: clamp(op.value, DETAIL_BOUNDS.min, DETAIL_BOUNDS.max) };
    case "addLayer":
      return r.layers.length >= MAX_LAYERS ? r : { ...r, layers: [...r.layers, op.layer] };
    case "removeLayer":
      return { ...r, layers: r.layers.filter((l) => l.id !== op.id) };
    case "updateLayer":
      return updateLayer(r, op.id, op.patch);
    case "reset":
      return emptyRecipe(r.source);
  }
}
