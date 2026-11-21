import { describe, it, expect } from "vitest";
import { createLatestGate } from "./latest-wins";

describe("createLatestGate", () => {
  it("seule la dernière requête d'une clé est la plus récente", () => {
    const g = createLatestGate();
    const a = g.next("k");
    const b = g.next("k");
    expect(g.isLatest("k", a)).toBe(false);
    expect(g.isLatest("k", b)).toBe(true);
  });
  it("les clés sont indépendantes", () => {
    const g = createLatestGate();
    const a = g.next("x");
    g.next("y");
    expect(g.isLatest("x", a)).toBe(true);
  });
});
