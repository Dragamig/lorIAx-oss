import type { RetouchRecipe } from "./recipe";

export type Crop = RetouchRecipe["crop"];
export type Bounds = { width: number; height: number };
export type CropHandle = "nw" | "n" | "ne" | "e" | "se" | "s" | "sw" | "w";

export const CROP_HANDLES: readonly CropHandle[] = ["nw", "n", "ne", "e", "se", "s", "sw", "w"];

/** Plus petite zone de recadrage, en fraction de chaque côté. */
export const MIN_CROP_FRACTION = 0.02;
const MAX_RATIO_TERM = 1000;

export const CROP_RATIOS = [
  { key: "free", ratio: null },
  { key: "1:1", ratio: 1 },
  { key: "4:3", ratio: 4 / 3 },
  { key: "3:2", ratio: 3 / 2 },
  { key: "16:9", ratio: 16 / 9 },
  { key: "9:16", ratio: 9 / 16 },
  { key: "4:5", ratio: 4 / 5 },
] as const;
export type RatioKey = (typeof CROP_RATIOS)[number]["key"] | "custom";

const clamp = (v: number, min: number, max: number) => Math.min(max, Math.max(min, v));

/** Ratio saisi à la main (largeur et hauteur) : deux nombres finis strictement positifs. */
export function parseRatioInput(w: string | number, h: string | number): { ok: true; ratio: number } | { ok: false } {
  const a = typeof w === "number" ? w : Number(String(w).trim().replace(",", "."));
  const b = typeof h === "number" ? h : Number(String(h).trim().replace(",", "."));
  const valid = (n: number) => Number.isFinite(n) && n > 0 && n <= MAX_RATIO_TERM;
  if (!valid(a) || !valid(b)) return { ok: false };
  return { ok: true, ratio: a / b };
}

/** Hauteur (fraction) qui donne le ratio demandé en pixels pour une largeur (fraction) donnée. */
const heightFor = (w: number, ratio: number, b: Bounds) => (w * b.width) / (ratio * b.height);
const widthFor = (h: number, ratio: number, b: Bounds) => (h * b.height * ratio) / b.width;

/**
 * Ramène une zone dans l'image : taille minimale, ratio de sortie si fourni (largeur / hauteur en pixels),
 * jamais de débordement. Avec un ratio, le centre de la zone est conservé.
 */
export function clampCrop(crop: Crop, ratio: number | null, bounds: Bounds): Crop {
  let w = clamp(crop.w, MIN_CROP_FRACTION, 1);
  let h = clamp(crop.h, MIN_CROP_FRACTION, 1);
  if (ratio === null) {
    return { x: clamp(crop.x, 0, 1 - w), y: clamp(crop.y, 0, 1 - h), w, h };
  }
  const cx = crop.x + crop.w / 2;
  const cy = crop.y + crop.h / 2;
  h = heightFor(w, ratio, bounds);
  if (h > 1) {
    h = 1;
    w = widthFor(h, ratio, bounds);
  }
  if (h < MIN_CROP_FRACTION) {
    h = MIN_CROP_FRACTION;
    w = widthFor(h, ratio, bounds);
  }
  if (w > 1) {
    w = 1;
    h = heightFor(w, ratio, bounds);
  }
  return { x: clamp(cx - w / 2, 0, 1 - w), y: clamp(cy - h / 2, 0, 1 - h), w, h };
}

/** Taille de la zone en pixels de l'image source. */
export function cropPixels(crop: Crop, bounds: Bounds): { width: number; height: number } {
  return {
    width: Math.max(1, Math.round(crop.w * bounds.width)),
    height: Math.max(1, Math.round(crop.h * bounds.height)),
  };
}

const KEY_DELTA: Record<string, [number, number]> = {
  ArrowLeft: [-1, 0],
  ArrowRight: [1, 0],
  ArrowUp: [0, -1],
  ArrowDown: [0, 1],
};

export function isArrowKey(key: string): boolean {
  return key in KEY_DELTA;
}

/** Une flèche déplace la zone de 1 px, avec Maj de 10 px ; la taille ne change pas. */
export function moveCropByKey(crop: Crop, key: string, shift: boolean, bounds: Bounds): Crop {
  const d = KEY_DELTA[key];
  if (!d) return crop;
  const step = shift ? 10 : 1;
  return {
    ...crop,
    x: clamp(crop.x + (d[0] * step) / bounds.width, 0, 1 - crop.w),
    y: clamp(crop.y + (d[1] * step) / bounds.height, 0, 1 - crop.h),
  };
}

/** Déplace les bords portés par la poignée de `dx` et `dy` (fractions), en gardant le ratio si fourni. */
export function resizeCropByEdges(
  crop: Crop,
  handle: CropHandle,
  dx: number,
  dy: number,
  ratio: number | null,
  bounds: Bounds,
): Crop {
  let x0 = crop.x;
  let y0 = crop.y;
  let x1 = crop.x + crop.w;
  let y1 = crop.y + crop.h;
  if (handle.includes("w")) x0 = clamp(x0 + dx, 0, x1 - MIN_CROP_FRACTION);
  if (handle.includes("e")) x1 = clamp(x1 + dx, x0 + MIN_CROP_FRACTION, 1);
  if (handle.includes("n")) y0 = clamp(y0 + dy, 0, y1 - MIN_CROP_FRACTION);
  if (handle.includes("s")) y1 = clamp(y1 + dy, y0 + MIN_CROP_FRACTION, 1);
  let next: Crop = { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
  if (ratio !== null) {
    const horizontalOnly = handle === "e" || handle === "w";
    const verticalOnly = handle === "n" || handle === "s";
    const widthDriven =
      horizontalOnly || (!verticalOnly && Math.abs(dx) * bounds.width >= Math.abs(dy) * bounds.height);
    if (widthDriven) {
      const h = heightFor(next.w, ratio, bounds);
      const y = handle.includes("n") ? y1 - h : handle.includes("s") ? y0 : crop.y + crop.h / 2 - h / 2;
      next = { ...next, y, h };
    } else {
      const w = widthFor(next.h, ratio, bounds);
      const x = handle.includes("w") ? x1 - w : handle.includes("e") ? x0 : crop.x + crop.w / 2 - w / 2;
      next = { ...next, x, w };
    }
  }
  return clampCrop(next, ratio, bounds);
}

/** Flèche sur une poignée : le bord qu'elle porte avance de 1 px (Maj : 10 px) dans le sens de la flèche. */
export function resizeCropByKey(
  crop: Crop,
  handle: CropHandle,
  key: string,
  shift: boolean,
  ratio: number | null,
  bounds: Bounds,
): Crop {
  const d = KEY_DELTA[key];
  if (!d) return crop;
  const step = shift ? 10 : 1;
  const dx = handle.includes("e") || handle.includes("w") ? (d[0] * step) / bounds.width : 0;
  const dy = handle.includes("n") || handle.includes("s") ? (d[1] * step) / bounds.height : 0;
  if (dx === 0 && dy === 0) return crop;
  return resizeCropByEdges(crop, handle, dx, dy, ratio, bounds);
}
