import { describe, expect, it } from "vitest";
import { clampCrop, cropPixels, moveCropByKey, parseRatioInput, resizeCropByKey, CROP_HANDLES, CROP_RATIOS } from "./crop";

const bounds = { width: 1000, height: 500 };
const inside = (c: { x: number; y: number; w: number; h: number }) =>
  c.x >= -1e-9 && c.y >= -1e-9 && c.x + c.w <= 1 + 1e-9 && c.y + c.h <= 1 + 1e-9 && c.w > 0 && c.h > 0;

describe("clampCrop", () => {
  it("la zone ne sort jamais de l'image quel que soit le ratio", () => {
    const wild = [
      { x: -0.4, y: 0.9, w: 3, h: 0.001 },
      { x: 0.95, y: 0.95, w: 0.5, h: 0.5 },
      { x: 0.2, y: 0.2, w: 0, h: 0 },
      { x: 1, y: 1, w: 1, h: 1 },
    ];
    for (const r of [null, ...CROP_RATIOS.map((x) => x.ratio), 0.05, 20]) {
      for (const c of wild) expect(inside(clampCrop(c, r, bounds))).toBe(true);
    }
  });

  it("le ratio 1:1 conserve le centre", () => {
    const c = clampCrop({ x: 0.25, y: 0.25, w: 0.5, h: 0.5 }, 1, bounds);
    const px = cropPixels(c, bounds);
    expect(px.width).toBe(px.height);
    expect(c.x + c.w / 2).toBeCloseTo(0.5, 6);
    expect(c.y + c.h / 2).toBeCloseTo(0.5, 6);
  });

  it("un ratio respecté en pixels", () => {
    const c = clampCrop({ x: 0, y: 0, w: 0.6, h: 0.9 }, 16 / 9, bounds);
    expect((c.w * bounds.width) / (c.h * bounds.height)).toBeCloseTo(16 / 9, 6);
  });
});

describe("clavier", () => {
  const crop = { x: 0.4, y: 0.4, w: 0.2, h: 0.2 };
  it("une flèche déplace de 1 px, Maj de 10 px", () => {
    expect(moveCropByKey(crop, "ArrowRight", false, bounds).x).toBeCloseTo(0.4 + 1 / 1000, 9);
    expect(moveCropByKey(crop, "ArrowRight", true, bounds).x).toBeCloseTo(0.4 + 10 / 1000, 9);
    expect(moveCropByKey(crop, "ArrowUp", false, bounds).y).toBeCloseTo(0.4 - 1 / 500, 9);
  });
  it("le déplacement s'arrête au bord", () => {
    expect(moveCropByKey({ ...crop, x: 0 }, "ArrowLeft", true, bounds).x).toBe(0);
    expect(inside(moveCropByKey({ ...crop, x: 0.8 }, "ArrowRight", true, bounds))).toBe(true);
  });
  it("une touche étrangère ne change rien", () => {
    expect(moveCropByKey(crop, "a", false, bounds)).toBe(crop);
  });
  it("une poignée agrandit ou réduit le bord qu'elle porte", () => {
    const grown = resizeCropByKey(crop, "e", "ArrowRight", false, null, bounds);
    expect(grown.w).toBeCloseTo(0.2 + 1 / 1000, 9);
    expect(grown.x).toBeCloseTo(0.4, 9);
    const west = resizeCropByKey(crop, "w", "ArrowLeft", true, null, bounds);
    expect(west.x).toBeCloseTo(0.4 - 10 / 1000, 9);
    expect(west.w).toBeCloseTo(0.2 + 10 / 1000, 9);
    expect(resizeCropByKey(crop, "e", "ArrowUp", false, null, bounds)).toBe(crop);
  });
  it("une poignée garde le ratio et reste dans l'image", () => {
    for (const h of CROP_HANDLES) {
      const c = resizeCropByKey({ x: 0, y: 0, w: 1, h: 1 }, h, "ArrowRight", true, 1, bounds);
      expect(inside(c)).toBe(true);
    }
    const c = resizeCropByKey({ x: 0.2, y: 0.2, w: 0.25, h: 0.5 }, "e", "ArrowRight", true, 1, bounds);
    expect((c.w * 1000) / (c.h * 500)).toBeCloseTo(1, 6);
  });
});

describe("parseRatioInput", () => {
  it("accepte deux nombres positifs", () => {
    expect(parseRatioInput("5", "4")).toEqual({ ok: true, ratio: 1.25 });
    expect(parseRatioInput("2,5", 1)).toEqual({ ok: true, ratio: 2.5 });
  });
  it("refuse zéro, négatif, vide et texte", () => {
    for (const [a, b] of [["0", "4"], ["-1", "2"], ["", "3"], ["x", "3"], ["3", "Infinity"], ["5000", "1"]]) {
      expect(parseRatioInput(a, b).ok).toBe(false);
    }
  });
});
