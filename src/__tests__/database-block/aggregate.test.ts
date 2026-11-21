import { describe, it, expect } from "vitest";
import { computeKpi, computeGrouped } from "@/components/editor/extensions/database-block/aggregate";
import type { DbColumn, DbRow } from "@/components/editor/extensions/database-block/types";

const columns: DbColumn[] = [
  { id: "c_status", databaseId: "d", name: "Statut", type: "select", position: 0, config: { options: ["todo", "done"] }, createdAt: "" },
  { id: "c_amount", databaseId: "d", name: "Montant", type: "number", position: 1, config: {}, createdAt: "" },
  { id: "c_double", databaseId: "d", name: "Double", type: "formula", position: 2, config: { formula: 'prop("Montant") * 2' }, createdAt: "" },
];

function row(id: string, cells: Record<string, unknown>): DbRow {
  return { id, databaseId: "d", cells: cells as DbRow["cells"], position: 0, createdAt: "", updatedAt: "" };
}

const rows: DbRow[] = [
  row("1", { c_status: "todo", c_amount: 10 }),
  row("2", { c_status: "done", c_amount: 20 }),
  row("3", { c_status: "done", c_amount: 30 }),
  row("4", { c_status: "done", c_amount: null }),
];

describe("computeKpi", () => {
  it("count compte les lignes", () => {
    expect(computeKpi(rows, columns, null, { fn: "count" })).toBe(4);
  });
  it("sum additionne une colonne nombre", () => {
    expect(computeKpi(rows, columns, null, { fn: "sum", columnId: "c_amount" })).toBe(60);
  });
  it("avg ignore les cellules vides", () => {
    expect(computeKpi(rows, columns, null, { fn: "avg", columnId: "c_amount" })).toBe(20);
  });
  it("min / max", () => {
    expect(computeKpi(rows, columns, null, { fn: "min", columnId: "c_amount" })).toBe(10);
    expect(computeKpi(rows, columns, null, { fn: "max", columnId: "c_amount" })).toBe(30);
  });
  it("filled_pct = % de cellules non vides", () => {
    expect(computeKpi(rows, columns, null, { fn: "filled_pct", columnId: "c_amount" })).toBe(75);
  });
  it("unique compte les valeurs distinctes non vides", () => {
    expect(computeKpi(rows, columns, null, { fn: "unique", columnId: "c_status" })).toBe(2);
  });
  it("résout une colonne formule", () => {
    expect(computeKpi(rows, columns, null, { fn: "sum", columnId: "c_double" })).toBe(120);
  });
  it("applique un filtre (arbre récursif) avant l'agrégat", () => {
    const filter = {
      id: "g", type: "group", conjunction: "and",
      children: [{ id: "c1", columnId: "c_status", operator: "is", value: "done" }],
    };
    expect(computeKpi(rows, columns, filter as never, { fn: "count" })).toBe(3);
  });
  it("renvoie 0 si la colonne d'agrégat est introuvable", () => {
    expect(computeKpi(rows, columns, null, { fn: "sum", columnId: "absent" })).toBe(0);
  });
});

describe("computeGrouped", () => {
  it("groupe par select et applique l'agrégat par bucket", () => {
    const out = computeGrouped(rows, columns, null, { columnId: "c_status" }, { fn: "count" });
    expect(out).toEqual(expect.arrayContaining([
      { label: "todo", value: 1 },
      { label: "done", value: 3 },
    ]));
    expect(out).toHaveLength(2);
  });
  it("group-by + sum par bucket", () => {
    const out = computeGrouped(rows, columns, null, { columnId: "c_status" }, { fn: "sum", columnId: "c_amount" });
    const done = out.find((b) => b.label === "done");
    expect(done?.value).toBe(50);
  });
  it("range les valeurs vides sous (vide)", () => {
    const r = [row("1", { c_status: null, c_amount: 5 })];
    const out = computeGrouped(r, columns, null, { columnId: "c_status" }, { fn: "count" });
    expect(out).toEqual([{ label: "(vide)", value: 1 }]);
  });
  it("multi-valeur : une ligne compte dans chaque bucket", () => {
    const cols: DbColumn[] = [{ id: "c_tags", databaseId: "d", name: "Tags", type: "person", position: 0, config: { multiple: true }, createdAt: "" }];
    const r = [row("1", { c_tags: ["u1", "u2"] }), row("2", { c_tags: ["u1"] })];
    const out = computeGrouped(r, cols, null, { columnId: "c_tags" }, { fn: "count" });
    expect(out.find((b) => b.label === "u1")?.value).toBe(2);
    expect(out.find((b) => b.label === "u2")?.value).toBe(1);
  });
  it("renvoie [] si la colonne group-by est introuvable", () => {
    expect(computeGrouped(rows, columns, null, { columnId: "absent" }, { fn: "count" })).toEqual([]);
  });
});
