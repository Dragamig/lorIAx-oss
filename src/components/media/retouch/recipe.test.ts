/* eslint-disable @typescript-eslint/no-explicit-any -- mutations volontairement hors type pour les cas invalides */
import { describe, it, expect } from "vitest";
import { applyOp, centeredCrop, emptyRecipe, outputSize, recipeSchema, type Layer } from "./recipe";
import { MAX_OUTPUT_PIXELS, MAX_OUTPUT_SIDE } from "./limits";

const src = { width: 4000, height: 3000 };

describe("outputSize", () => {
  it("recette vide : taille de la source", () => {
    expect(outputSize(emptyRecipe(src))).toEqual(src);
  });
  it("rotation de 90 degrés : largeur et hauteur échangées", () => {
    const r = applyOp(emptyRecipe(src), { type: "rotate", quarters: 1 });
    expect(outputSize(r)).toEqual({ width: 3000, height: 4000 });
  });
  it("rotation de 180 degrés : taille inchangée", () => {
    expect(outputSize(applyOp(emptyRecipe(src), { type: "rotate", quarters: 2 }))).toEqual(src);
  });
  it("recadrage 16:9 centré de 4000x3000 : 4000x2250", () => {
    const r = applyOp(emptyRecipe(src), { type: "setCrop", crop: centeredCrop(src, 16 / 9) });
    expect(outputSize(r)).toEqual({ width: 4000, height: 2250 });
  });
  it("recadrage 1:1 d'une image large : carré de la hauteur", () => {
    const r = applyOp(emptyRecipe(src), { type: "setCrop", crop: centeredCrop(src, 1) });
    expect(outputSize(r)).toEqual({ width: 3000, height: 3000 });
  });
  it("redimensionnement par la largeur, ratio verrouillé", () => {
    const r = applyOp(emptyRecipe(src), { type: "resize", width: 2000 });
    expect(outputSize(r)).toEqual({ width: 2000, height: 1500 });
  });
  it("redimensionnement par la hauteur, ratio verrouillé", () => {
    const r = applyOp(emptyRecipe(src), { type: "resize", height: 600 });
    expect(outputSize(r)).toEqual({ width: 800, height: 600 });
  });
  it("redimensionnement sans verrou : côtés indépendants", () => {
    let r = applyOp(emptyRecipe(src), { type: "resize", width: 1000, lockRatio: false });
    r = applyOp(r, { type: "resize", height: 200, lockRatio: false });
    expect(outputSize(r)).toEqual({ width: 1000, height: 200 });
  });
  it("sortie plafonnée à 8 192 px de côté", () => {
    const r = applyOp(emptyRecipe(src), { type: "resize", width: 20000 });
    const o = outputSize(r);
    expect(Math.max(o.width, o.height)).toBeLessThanOrEqual(MAX_OUTPUT_SIDE);
    expect(o.width / o.height).toBeCloseTo(4 / 3, 1);
  });
  it("sortie plafonnée à 24 mégapixels", () => {
    const r = applyOp(emptyRecipe(src), { type: "resize", width: 8000 });
    const o = outputSize(r);
    expect(o.width * o.height).toBeLessThanOrEqual(MAX_OUTPUT_PIXELS);
  });
  it("source énorme sans redimensionnement : plafonnée aussi", () => {
    const o = outputSize(emptyRecipe({ width: 20000, height: 20000 }));
    expect(o.width).toBeLessThanOrEqual(MAX_OUTPUT_SIDE);
    expect(o.width * o.height).toBeLessThanOrEqual(MAX_OUTPUT_PIXELS);
  });
});

describe("applyOp", () => {
  it("ne mute pas l'entrée", () => {
    const r = emptyRecipe(src);
    const frozen = JSON.stringify(r);
    Object.freeze(r.adjustments);
    Object.freeze(r.crop);
    const next = applyOp(r, { type: "setAdjustment", key: "brightness", value: 40 });
    expect(JSON.stringify(r)).toBe(frozen);
    expect(next.adjustments.brightness).toBe(40);
    expect(next).not.toBe(r);
  });
  it("ramène un réglage dans ses bornes", () => {
    const r = emptyRecipe(src);
    expect(applyOp(r, { type: "setAdjustment", key: "contrast", value: 500 }).adjustments.contrast).toBe(100);
    expect(applyOp(r, { type: "setAdjustment", key: "exposure", value: 0 }).adjustments.exposure).toBe(0.5);
    expect(applyOp(r, { type: "setBlur", value: -5 }).blur).toBe(0);
  });
  it("le recadrage ne sort jamais de l'image", () => {
    const r = applyOp(emptyRecipe(src), { type: "setCrop", crop: { x: 0.9, y: 0.9, w: 0.5, h: 0.5 } });
    expect(r.crop.x + r.crop.w).toBeLessThanOrEqual(1);
    expect(r.crop.y + r.crop.h).toBeLessThanOrEqual(1);
  });
  it("quatre quarts de tour reviennent au départ, rotation négative incluse", () => {
    let r = emptyRecipe(src);
    for (let i = 0; i < 4; i++) r = applyOp(r, { type: "rotate", quarters: 1 });
    expect(r.quarterTurns).toBe(0);
    expect(applyOp(emptyRecipe(src), { type: "rotate", quarters: -1 }).quarterTurns).toBe(3);
  });
  it("miroir deux fois : neutre ; reset : recette vide", () => {
    let r = applyOp(emptyRecipe(src), { type: "flip", axis: "h" });
    expect(r.flipH).toBe(true);
    r = applyOp(applyOp(r, { type: "flip", axis: "h" }), { type: "setPreset", preset: "sepia" });
    expect(r.flipH).toBe(false);
    expect(applyOp(r, { type: "reset" })).toEqual(emptyRecipe(src));
  });
  it("calques : ajout, retrait, plafond", () => {
    const layer: Layer = { id: "a", type: "text", x: 0.1, y: 0.1, text: "Salut", fontSize: 24, color: "#ffffff" };
    let r = applyOp(emptyRecipe(src), { type: "addLayer", layer });
    expect(r.layers).toHaveLength(1);
    r = applyOp(r, { type: "removeLayer", id: "a" });
    expect(r.layers).toHaveLength(0);
    for (let i = 0; i < 60; i++) r = applyOp(r, { type: "addLayer", layer: { ...layer, id: String(i) } });
    expect(r.layers).toHaveLength(20);
  });
});

describe("recipeSchema", () => {
  const ok = () => emptyRecipe(src);
  it("accepte une recette vide et une recette retouchée", () => {
    expect(recipeSchema.safeParse(ok()).success).toBe(true);
    const r = applyOp(applyOp(ok(), { type: "setAdjustment", key: "tint", value: -30 }), { type: "resize", width: 2000 });
    expect(recipeSchema.safeParse(r).success).toBe(true);
  });
  it.each([
    ["luminosité 101", (r: any) => (r.adjustments.brightness = 101)],
    ["contraste -101", (r: any) => (r.adjustments.contrast = -101)],
    ["exposition 0,4", (r: any) => (r.adjustments.exposure = 0.4)],
    ["exposition 2,6", (r: any) => (r.adjustments.exposure = 2.6)],
    ["netteté 101", (r: any) => (r.sharpen = 101)],
    ["flou -1", (r: any) => (r.blur = -1)],
    ["angle 46", (r: any) => (r.angle = 46)],
    ["quart de tour 4", (r: any) => (r.quarterTurns = 4)],
    ["préréglage inconnu", (r: any) => (r.preset = "hdr")],
    ["recadrage hors image", (r: any) => (r.crop = { x: 0.6, y: 0, w: 0.6, h: 1 })],
    ["recadrage de largeur nulle", (r: any) => (r.crop = { x: 0, y: 0, w: 0, h: 1 })],
    ["sortie de 8 193 px", (r: any) => (r.resize = { width: 8193, height: 10 })],
    ["sortie de 8 192 x 8 192 (67 Mpx)", (r: any) => (r.resize = { width: 8192, height: 8192 })],
    ["taille non entière", (r: any) => (r.resize = { width: 10.5, height: 10 })],
    ["texte vide", (r: any) => (r.layers = [{ id: "a", type: "text", x: 0, y: 0, text: "", fontSize: 20, color: "#000000" }])],
    ["couleur invalide", (r: any) => (r.layers = [{ id: "a", type: "text", x: 0, y: 0, text: "a", fontSize: 20, color: "red" }])],
    ["21 calques", (r: any) => (r.layers = Array.from({ length: 21 }, (_, i) => ({ id: String(i), type: "text", x: 0, y: 0, text: "a", fontSize: 20, color: "#000000" })))],
  ])("refuse : %s", (_label, mutate) => {
    const r = ok() as any;
    mutate(r);
    expect(recipeSchema.safeParse(r).success).toBe(false);
  });
  it("accepte 8 192 x 2 929 (juste sous 24 Mpx)", () => {
    const r = { ...ok(), resize: { width: 8192, height: 2929 } };
    expect(recipeSchema.safeParse(r).success).toBe(true);
  });
});
