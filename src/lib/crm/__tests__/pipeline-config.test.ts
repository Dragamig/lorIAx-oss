import { describe, expect, it } from "vitest";
import { defaultTotalsConfig, pickTotalsSource } from "../pipeline-config";

const totals = (amountColumnId: string, extra: Record<string, unknown> = {}) => ({
  kanbanTotals: { amountColumnId, closedLanes: ["Perdu"], weights: { Gagne: 100 }, showWeighted: true, ...extra },
});

describe("pickTotalsSource", () => {
  it("ignore une vue personnelle", () => {
    const r = pickTotalsSource([{ id: "v1", scope: "personal", config: totals("c1") }], "c1");
    expect(r).toEqual({ viewId: null, config: null });
  });

  it("ignore les configs corrompues sans exception", () => {
    const views = [
      { id: "a", scope: "shared", config: { kanbanTotals: "x" } },
      { id: "b", scope: "shared", config: { kanbanTotals: [] } },
      { id: "c", scope: "shared", config: totals("c1", { weights: { Gagne: "beaucoup" } }) },
      { id: "d", scope: "shared", config: null },
      { id: "e", scope: "shared", config: "zz" },
    ];
    expect(pickTotalsSource(views, "c1")).toEqual({ viewId: null, config: null });
  });

  it("la premiere vue partagee valide gagne", () => {
    const views = [
      { id: "a", scope: "shared", config: { kanbanTotals: "x" } },
      { id: "b", scope: "shared", config: totals("c1") },
      { id: "c", scope: "shared", config: totals("c1", { closedLanes: [] }) },
    ];
    const r = pickTotalsSource(views, "c1");
    expect(r.viewId).toBe("b");
    expect(r.config?.closedLanes).toEqual(["Perdu"]);
  });

  it("remplace la colonne de montant par celle du raccordement", () => {
    const r = pickTotalsSource([{ id: "v", scope: "shared", config: totals("autre") }], "c9");
    expect(r.viewId).toBe("v");
    expect(r.config?.amountColumnId).toBe("c9");
    expect(r.config?.weights).toEqual({ Gagne: 100 });
  });

  it("aucune vue", () => {
    expect(pickTotalsSource([], "c1")).toEqual({ viewId: null, config: null });
  });

  it("sans montant raccorde, aucune config", () => {
    expect(pickTotalsSource([{ id: "v", scope: "shared", config: totals("c1") }], null)).toEqual({
      viewId: null,
      config: null,
    });
  });
});

describe("defaultTotalsConfig", () => {
  it("null sans montant", () => {
    expect(defaultTotalsConfig(null)).toBeNull();
  });
  it("config neutre avec montant", () => {
    expect(defaultTotalsConfig("c1")).toEqual({
      amountColumnId: "c1",
      closedLanes: [],
      weights: {},
      currency: "EUR",
      showWeighted: false,
    });
  });
});
