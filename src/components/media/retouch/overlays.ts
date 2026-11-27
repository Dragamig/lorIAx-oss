import { MAX_LAYERS, MAX_TEXT_LENGTH, OVERLAY_FONT_KEYS } from "./limits";
import { applyOp, type Layer, type RetouchRecipe } from "./recipe";

export type FontKey = (typeof OVERLAY_FONT_KEYS)[number];
export type ShapeKind = Extract<Layer, { type: "shape" }>["shape"];
export type TextLayer = Extract<Layer, { type: "text" }>;
export type ShapeLayer = Extract<Layer, { type: "shape" }>;
export type Overlay = Layer;

/** Piles de polices système : disponibles sans réseau (aucune police web, aucune URL). */
export const OVERLAY_FONTS: Record<FontKey, string> = {
  sans: "Arial, Helvetica, sans-serif",
  serif: "Georgia, 'Times New Roman', serif",
  mono: "'Courier New', Courier, monospace",
  display: "Impact, 'Arial Black', sans-serif",
};

export const DEFAULT_TEXT_BOX_WIDTH = 0.5;
export const DEFAULT_TEXT_COLOR = "#ffffff";
export const DEFAULT_SHAPE_STROKE = "#ff3b30";

export function fontStack(key: FontKey | undefined): string {
  return OVERLAY_FONTS[key && key in OVERLAY_FONTS ? key : "sans"];
}

/** Unité des corps et épaisseurs : un millième du petit côté de la sortie. */
export function overlayUnit(size: { width: number; height: number }): number {
  return Math.min(size.width, size.height) / 1000;
}

export function truncateText(text: string): string {
  return text.slice(0, MAX_TEXT_LENGTH);
}

export interface LayerGeometry {
  left: number;
  top: number;
  width: number;
  height: number;
  /** Corps de texte en pixels de la sortie considérée. */
  fontSize: number;
  strokeWidth: number;
}

/**
 * Géométrie en pixels d'un calque pour une taille de sortie donnée. L'aperçu (2 048 px)
 * et l'export (pleine résolution) passent par cette seule fonction : même fraction de l'image.
 */
export function layerGeometry(layer: Layer, size: { width: number; height: number }): LayerGeometry {
  const unit = overlayUnit(size);
  const left = layer.x * size.width;
  const top = layer.y * size.height;
  if (layer.type === "text") {
    return {
      left,
      top,
      width: (layer.w ?? DEFAULT_TEXT_BOX_WIDTH) * size.width,
      height: 0,
      fontSize: layer.fontSize * unit,
      strokeWidth: 0,
    };
  }
  return {
    left,
    top,
    width: layer.w * size.width,
    height: layer.h * size.height,
    fontSize: 0,
    strokeWidth: layer.strokeWidth * unit,
  };
}

/** Extrémités (départ, arrivée) d'une ligne ou d'une flèche, en pixels. */
export function lineEnds(layer: ShapeLayer, size: { width: number; height: number }) {
  const g = layerGeometry(layer, size);
  return layer.flip
    ? { x1: g.left, y1: g.top + g.height, x2: g.left + g.width, y2: g.top }
    : { x1: g.left, y1: g.top, x2: g.left + g.width, y2: g.top + g.height };
}

export function newLayerId(): string {
  const c = globalThis.crypto;
  return c && "randomUUID" in c ? c.randomUUID() : `l${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
}

export type AddResult =
  | { ok: true; recipe: RetouchRecipe; id: string }
  | { ok: false; reason: "limit" | "empty" };

/** Décalage en cascade pour que deux calques successifs ne se superposent pas exactement. */
const cascade = (n: number) => (n % 8) * 0.04;

export function addText(
  r: RetouchRecipe,
  text: string,
  opts: { color?: string; font?: FontKey; fontSize?: number } = {},
): AddResult {
  const clean = truncateText(text);
  if (clean.trim() === "") return { ok: false, reason: "empty" };
  if (r.layers.length >= MAX_LAYERS) return { ok: false, reason: "limit" };
  const id = newLayerId();
  const layer: Layer = {
    id,
    type: "text",
    x: 0.1 + cascade(r.layers.length),
    y: 0.1 + cascade(r.layers.length),
    w: DEFAULT_TEXT_BOX_WIDTH,
    text: clean,
    fontSize: opts.fontSize ?? 60,
    color: opts.color ?? DEFAULT_TEXT_COLOR,
    font: opts.font ?? "sans",
  };
  return { ok: true, recipe: applyOp(r, { type: "addLayer", layer }), id };
}

export function addShape(
  r: RetouchRecipe,
  kind: ShapeKind,
  style: { fill?: string | null; stroke?: string | null; strokeWidth?: number } = {},
): AddResult {
  if (r.layers.length >= MAX_LAYERS) return { ok: false, reason: "limit" };
  const id = newLayerId();
  const isLine = kind === "line" || kind === "arrow";
  const layer: Layer = {
    id,
    type: "shape",
    shape: kind,
    x: 0.2 + cascade(r.layers.length),
    y: 0.2 + cascade(r.layers.length),
    w: isLine ? 0.35 : 0.4,
    h: isLine ? 0.2 : 0.3,
    fill: style.fill ?? null,
    stroke: style.stroke === undefined ? DEFAULT_SHAPE_STROKE : style.stroke,
    strokeWidth: style.strokeWidth ?? 6,
  };
  return { ok: true, recipe: applyOp(r, { type: "addLayer", layer }), id };
}

/** Remplace le texte d'un calque ; un texte vide le supprime, un texte trop long est tronqué. */
export function setLayerText(r: RetouchRecipe, id: string, text: string): RetouchRecipe {
  return applyOp(r, { type: "updateLayer", id, patch: { text: truncateText(text) } });
}

/** Déplace un calque d'une fraction de la sortie, sans sortir de l'image. */
export function nudgeLayer(r: RetouchRecipe, id: string, dx: number, dy: number): RetouchRecipe {
  const l = r.layers.find((x) => x.id === id);
  if (!l) return r;
  return applyOp(r, { type: "updateLayer", id, patch: { x: l.x + dx, y: l.y + dy } });
}
