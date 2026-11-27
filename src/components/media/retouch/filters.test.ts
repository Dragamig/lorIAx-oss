import { describe, it, expect } from "vitest";
import { filters as F } from "fabric";
import { buildFabricFilters, isNeutral, sharpenMatrix } from "./filters";
import { PRESETS } from "./presets";
import { PRESET_KEYS, neutralAdjustments } from "./recipe";

const neutral = neutralAdjustments();
const noDetail = { blur: 0, sharpen: 0 };

describe("buildFabricFilters", () => {
  it("réglages neutres : liste vide", () => {
    expect(buildFabricFilters(neutral, noDetail)).toEqual([]);
    expect(isNeutral(neutral, noDetail)).toBe(true);
  });

  it("luminosité 50 produit un Brightness de 0,25", () => {
    const [f] = buildFabricFilters({ ...neutral, brightness: 50 }, noDetail);
    expect(f).toBeInstanceOf(F.Brightness);
    expect((f as InstanceType<typeof F.Brightness>).brightness).toBeCloseTo(0.25);
  });

  it("exposition 2 produit un Gamma identique sur les trois canaux", () => {
    const [f] = buildFabricFilters({ ...neutral, exposure: 2 }, noDetail);
    expect(f).toBeInstanceOf(F.Gamma);
    expect((f as InstanceType<typeof F.Gamma>).gamma).toEqual([2, 2, 2]);
  });

  it("netteté 100 produit un Convolute 3x3 de somme 1", () => {
    const [f] = buildFabricFilters(neutral, { blur: 0, sharpen: 100 });
    expect(f).toBeInstanceOf(F.Convolute);
    const m = (f as InstanceType<typeof F.Convolute>).matrix;
    expect(m).toHaveLength(9);
    expect(m.reduce((s, v) => s + v, 0)).toBeCloseTo(1);
    expect(sharpenMatrix(0).reduce((s, v) => s + v, 0)).toBeCloseTo(1);
  });

  it("flou 0 n'ajoute aucun filtre, flou 50 ajoute un Blur", () => {
    expect(buildFabricFilters(neutral, { blur: 0, sharpen: 0 })).toHaveLength(0);
    const out = buildFabricFilters(neutral, { blur: 50, sharpen: 0 });
    expect(out).toHaveLength(1);
    expect(out[0]).toBeInstanceOf(F.Blur);
  });

  it("température ou teinte passe par un ColorMatrix", () => {
    const [f] = buildFabricFilters({ ...neutral, temperature: 40 }, noDetail);
    expect(f).toBeInstanceOf(F.ColorMatrix);
  });

  it("ordre fixe : exposition, luminosité, contraste, saturation, vibrance, teinte, netteté, flou", () => {
    const out = buildFabricFilters(
      { brightness: 10, contrast: 10, saturation: 10, vibrance: 10, exposure: 1.5, temperature: 10, tint: 0 },
      { blur: 10, sharpen: 10 },
    );
    expect(out.map((f) => f.type)).toEqual([
      "Gamma", "Brightness", "Contrast", "Saturation", "Vibrance", "ColorMatrix", "Convolute", "Blur",
    ]);
  });

  it("chaque clé de PRESETS est valide pour buildFabricFilters", () => {
    expect(Object.keys(PRESETS).sort()).toEqual([...PRESET_KEYS].sort());
    for (const key of PRESET_KEYS) {
      const out = buildFabricFilters(neutral, noDetail, key);
      expect(isNeutral(neutral, noDetail, key)).toBe(key === "none");
      expect(Array.isArray(out)).toBe(true);
      if (key !== "none") expect(out.length).toBeGreaterThan(0);
    }
    const bw = buildFabricFilters(neutral, noDetail, "blackWhite").map((f) => f.type);
    expect(bw).toContain("Grayscale");
  });
});
