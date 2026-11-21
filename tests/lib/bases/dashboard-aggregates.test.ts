import { describe, it, expect } from "vitest";
import { computeMetric, computeChartData } from "@/components/bases/dashboard-view";

function row(id: string, cells: Record<string, unknown>) {
  return { id, cells, updatedAt: "2026-05-26T00:00:00Z" };
}

describe("computeMetric", () => {
  const rows = [
    row("r1", { c1: 10, c2: "A" }),
    row("r2", { c1: 20, c2: "B" }),
    row("r3", { c1: 30, c2: "A" }),
    row("r4", { c1: null, c2: "A" }),
  ];

  it("count compte toutes les lignes (incluant nulls)", () => {
    expect(computeMetric(rows, undefined, "count")).toBe(4);
  });

  it("sum ignore les nulls et non-numériques", () => {
    expect(computeMetric(rows, "c1", "sum")).toBe(60);
  });

  it("avg = sum / count des valeurs non-nulles", () => {
    expect(computeMetric(rows, "c1", "avg")).toBeCloseTo(20);
  });

  it("min trouve le minimum", () => {
    expect(computeMetric(rows, "c1", "min")).toBe(10);
  });

  it("max trouve le maximum", () => {
    expect(computeMetric(rows, "c1", "max")).toBe(30);
  });

  it("retourne 0 si aucune valeur numérique", () => {
    expect(computeMetric([row("x", { c1: "abc" })], "c1", "sum")).toBe(0);
  });

  it("parse les nombres stockés en string", () => {
    expect(
      computeMetric([row("x", { c1: "12.5" }), row("y", { c1: "7.5" })], "c1", "sum")
    ).toBe(20);
  });
});

describe("computeChartData", () => {
  const rows = [
    row("1", { status: "À faire", count: 1 }),
    row("2", { status: "À faire", count: 2 }),
    row("3", { status: "Fait", count: 5 }),
    row("4", { status: null, count: 1 }),
  ];

  it("groupe par colonne, agg count", () => {
    const data = computeChartData(rows, "status", undefined, "count");
    expect(data).toEqual(
      expect.arrayContaining([
        { label: "À faire", value: 2 },
        { label: "Fait", value: 1 },
        { label: "—", value: 1 },
      ])
    );
  });

  it("groupe par colonne, agg sum sur colonne valeur", () => {
    const data = computeChartData(rows, "status", "count", "sum");
    const map = new Map(data.map((d) => [d.label, d.value]));
    expect(map.get("À faire")).toBe(3);
    expect(map.get("Fait")).toBe(5);
  });

  it("groupBy multi-sélection → label joint", () => {
    const data = computeChartData(
      [row("1", { tags: ["red", "blue"] })],
      "tags",
      undefined,
      "count"
    );
    expect(data[0].label).toBe("red, blue");
  });

  it("retourne [] si aucune ligne", () => {
    expect(computeChartData([], "status", undefined, "count")).toEqual([]);
  });
});
