import { describe, it, expect } from "vitest";
import { addShape, addText, layerGeometry, lineEnds, nudgeLayer, OVERLAY_FONTS, overlayUnit, setLayerText, type ShapeLayer } from "./overlays";
import { emptyRecipe, recipeSchema } from "./recipe";
import { MAX_LAYERS, MAX_TEXT_LENGTH, OVERLAY_FONT_KEYS } from "./limits";

const base = emptyRecipe({ width: 4000, height: 3000 });

function must<T extends { ok: boolean }>(r: T): Extract<T, { ok: true }> {
  expect(r.ok).toBe(true);
  return r as Extract<T, { ok: true }>;
}

describe("mise à l'échelle des calques", () => {
  it("un calque occupe la même fraction de l'image à l'aperçu et à l'export", () => {
    const { recipe } = must(addShape(base, "rect"));
    const layer = recipe.layers[0];
    const preview = { width: 2048, height: 1536 };
    const full = { width: 4000, height: 3000 };
    const a = layerGeometry(layer, preview);
    const b = layerGeometry(layer, full);
    expect(a.left / preview.width).toBeCloseTo(b.left / full.width, 10);
    expect(a.top / preview.height).toBeCloseTo(b.top / full.height, 10);
    expect(a.width / preview.width).toBeCloseTo(b.width / full.width, 10);
    expect(a.height / preview.height).toBeCloseTo(b.height / full.height, 10);
  });

  it("corps de texte et épaisseur suivent la résolution (même fraction du petit côté)", () => {
    const t = must(addText(base, "Salut")).recipe.layers[0];
    const s = must(addShape(base, "line")).recipe.layers[0];
    const preview = { width: 2048, height: 1536 };
    const full = { width: 4000, height: 3000 };
    expect(layerGeometry(t, preview).fontSize / 1536).toBeCloseTo(layerGeometry(t, full).fontSize / 3000, 10);
    expect(layerGeometry(s, preview).strokeWidth / 1536).toBeCloseTo(layerGeometry(s, full).strokeWidth / 3000, 10);
    expect(overlayUnit(full)).toBe(3);
  });

  it("une ligne montante inverse les extrémités verticales", () => {
    const s = must(addShape(base, "arrow")).recipe.layers[0] as ShapeLayer;
    const size = { width: 1000, height: 1000 };
    const down = lineEnds(s, size);
    const up = lineEnds({ ...s, flip: true }, size);
    expect(down.y1).toBeLessThan(down.y2);
    expect(up.y1).toBeGreaterThan(up.y2);
  });
});

describe("limites et calques", () => {
  it("le 21e calque est refusé avec la raison limit", () => {
    let r = base;
    for (let i = 0; i < MAX_LAYERS; i++) r = must(addShape(r, "ellipse")).recipe;
    expect(r.layers).toHaveLength(20);
    const res = addText(r, "de trop");
    expect(res).toEqual({ ok: false, reason: "limit" });
    expect(addShape(r, "rect")).toEqual({ ok: false, reason: "limit" });
  });

  it("texte vide : ajout refusé, et une édition vide supprime le calque", () => {
    expect(addText(base, "   ")).toEqual({ ok: false, reason: "empty" });
    const { recipe, id } = must(addText(base, "abc"));
    expect(setLayerText(recipe, id, "").layers).toHaveLength(0);
  });

  it("texte de 10 000 caractères tronqué à 500", () => {
    const long = "x".repeat(10_000);
    const { recipe, id } = must(addText(base, long));
    const l = recipe.layers[0];
    expect(l.type === "text" && l.text.length).toBe(MAX_TEXT_LENGTH);
    const edited = setLayerText(recipe, id, long);
    const e = edited.layers[0];
    expect(e.type === "text" && e.text.length).toBe(MAX_TEXT_LENGTH);
    expect(recipeSchema.safeParse(edited).success).toBe(true);
  });

  it("polices : piles système seulement, aucune ressource distante", () => {
    expect(Object.keys(OVERLAY_FONTS).sort()).toEqual([...OVERLAY_FONT_KEYS].sort());
    for (const stack of Object.values(OVERLAY_FONTS)) {
      expect(stack).not.toMatch(/url\(|https?:|\/\//i);
    }
    const bad = { ...must(addText(base, "a")).recipe };
    (bad.layers[0] as { font?: string }).font = "Satoshi";
    expect(recipeSchema.safeParse(bad).success).toBe(false);
  });

  it("déplacement au clavier borné à l'image", () => {
    const { recipe, id } = must(addText(base, "a"));
    const moved = nudgeLayer(recipe, id, 5, -5);
    expect(moved.layers[0].x).toBe(1);
    expect(moved.layers[0].y).toBe(0);
    expect(nudgeLayer(recipe, "inconnu", 0.1, 0.1)).toBe(recipe);
  });

  it("les recettes produites restent valides au schéma", () => {
    let r = base;
    for (const k of ["rect", "ellipse", "line", "arrow"] as const) r = must(addShape(r, k)).recipe;
    r = must(addText(r, "ok")).recipe;
    expect(recipeSchema.safeParse(r).success).toBe(true);
  });
});
