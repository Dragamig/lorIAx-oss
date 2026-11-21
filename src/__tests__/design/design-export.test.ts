import { describe, it, expect } from "vitest";
import { slugify, pxToPt, exportMultiplier } from "@/components/editor/extensions/design-export";

describe("design-export helpers", () => {
  it("slugify produit un nom de fichier sûr", () => {
    expect(slugify("Mon Affiche d'été")).toBe("mon-affiche-d'été");
    expect(slugify("  Deux   mots  ")).toBe("deux-mots");
    expect(slugify("")).toBe("design");
  });

  it("pxToPt convertit 96 px CSS en 72 pt", () => {
    expect(pxToPt(96)).toBe(72);
    expect(pxToPt(595)).toBeCloseTo(446.25);
  });

  it("exportMultiplier compense le zoom du canvas", () => {
    expect(exportMultiplier(300, 100)).toBeCloseTo(3.125);
    expect(exportMultiplier(300, 50)).toBeCloseTo(6.25);
    expect(exportMultiplier(72, 100)).toBeCloseTo(0.75);
  });
});
