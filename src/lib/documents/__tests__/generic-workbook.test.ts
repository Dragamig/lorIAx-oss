import { describe, it, expect } from "vitest";
import { buildGenericWorkbook } from "../generic-workbook";

type Wb = {
  sheetOrder: string[];
  sheets: Record<string, { name: string; columnCount: number; cellData: Record<number, Record<number, { v?: string | number; t?: number; s?: string }>>; freeze: { ySplit: number } }>;
  styles: Record<string, unknown>;
  locale: string;
};

describe("buildGenericWorkbook", () => {
  const wb = buildGenericWorkbook({
    columns: [{ name: "Nom" }, { name: "Qté", type: "number" }, { name: "Jour", type: "date" }],
    rows: [["A", "12", "2026-11-25"], ["B", "x", ""]],
  }) as unknown as Wb;
  const sheet = wb.sheets[wb.sheetOrder[0]];

  it("produit l'enveloppe univer avec une seule feuille", () => {
    expect(wb.sheetOrder).toHaveLength(1);
    expect(wb.locale).toBe("fr-FR");
    expect(wb.styles.header).toBeDefined();
    expect(sheet.columnCount).toBe(3);
    expect(sheet.freeze.ySplit).toBe(1);
  });

  it("met les en-têtes en première ligne", () => {
    expect(sheet.cellData[0][0]).toMatchObject({ v: "Nom", t: 1, s: "header" });
    expect(sheet.cellData[0][1].v).toBe("Qté");
  });

  it("respecte les types", () => {
    expect(sheet.cellData[1][0]).toEqual({ v: "A", t: 1 });
    expect(sheet.cellData[1][1]).toEqual({ v: 12, t: 2 });
    expect(sheet.cellData[1][2]).toEqual({ v: "2026-11-25", t: 1 });
    expect(sheet.cellData[2][1]).toEqual({ v: "x", t: 1 });
    expect(sheet.cellData[2][2]).toBeUndefined();
  });

  it("accepte l'absence de lignes", () => {
    const w = buildGenericWorkbook({ columns: [{ name: "A" }] }) as unknown as Wb;
    expect(Object.keys(w.sheets[w.sheetOrder[0]].cellData)).toEqual(["0"]);
  });
});
