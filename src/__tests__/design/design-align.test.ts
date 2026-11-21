import { describe, it, expect } from "vitest";
import { computeAlignDeltas, type AlignRect } from "@/components/editor/extensions/design-align";

const page = { width: 1000, height: 800 };
const r = (left: number, top: number, width: number, height: number): AlignRect => ({ left, top, width, height });

describe("computeAlignDeltas — objet seul (référence = page)", () => {
  it("aligne à gauche / centre / droite", () => {
    const rect = [r(100, 100, 200, 50)];
    expect(computeAlignDeltas(rect, "left", page)[0]).toEqual({ dx: -100, dy: 0 });
    expect(computeAlignDeltas(rect, "center-h", page)[0]).toEqual({ dx: 300, dy: 0 }); // (1000-200)/2 - 100
    expect(computeAlignDeltas(rect, "right", page)[0]).toEqual({ dx: 700, dy: 0 });    // 1000-200-100
  });

  it("aligne en haut / milieu / bas", () => {
    const rect = [r(100, 100, 200, 50)];
    expect(computeAlignDeltas(rect, "top", page)[0]).toEqual({ dx: 0, dy: -100 });
    expect(computeAlignDeltas(rect, "middle-v", page)[0]).toEqual({ dx: 0, dy: 275 }); // (800-50)/2 - 100
    expect(computeAlignDeltas(rect, "bottom", page)[0]).toEqual({ dx: 0, dy: 650 });   // 800-50-100
  });
});

describe("computeAlignDeltas — sélection multiple (référence = bbox de la sélection)", () => {
  const rects = [r(0, 0, 100, 100), r(300, 200, 100, 100)];
  it("aligne sur la bbox, pas sur la page", () => {
    const d = computeAlignDeltas(rects, "left", page);
    expect(d[0]).toEqual({ dx: 0, dy: 0 });
    expect(d[1]).toEqual({ dx: -300, dy: 0 });
  });
  it("centre horizontalement dans la bbox", () => {
    // bbox: left 0, width 400 → centre cible pour un objet de 100 = left 150
    const d = computeAlignDeltas(rects, "center-h", page);
    expect(d[0]).toEqual({ dx: 150, dy: 0 });
    expect(d[1]).toEqual({ dx: -150, dy: 0 });
  });
});

describe("computeAlignDeltas — distribution", () => {
  it("distribue horizontalement avec des espaces égaux (premiers/derniers fixes)", () => {
    const rects = [r(0, 0, 100, 10), r(110, 0, 100, 10), r(500, 0, 100, 10)];
    // espace total = 600 - 300 = 300 → 150 par intervalle ; objet du milieu : left cible = 250
    const d = computeAlignDeltas(rects, "distribute-h", page);
    expect(d[0]).toEqual({ dx: 0, dy: 0 });
    expect(d[1]).toEqual({ dx: 140, dy: 0 });
    expect(d[2]).toEqual({ dx: 0, dy: 0 });
  });
  it("ne fait rien avec moins de 3 objets", () => {
    const d = computeAlignDeltas([r(0, 0, 10, 10), r(50, 0, 10, 10)], "distribute-h", page);
    expect(d).toEqual([{ dx: 0, dy: 0 }, { dx: 0, dy: 0 }]);
  });
});
