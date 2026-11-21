import { describe, it, expect } from "vitest";
import ExcelJS from "exceljs";
import { buildDemandWorkbook, LINES_HEADERS } from "../demand-workbook";
import { workbookToXlsx } from "../workbook-to-xlsx";

async function reload(wb: Record<string, unknown>) {
  const buf = await workbookToXlsx(wb);
  const out = new ExcelJS.Workbook();
  await out.xlsx.load(buf as unknown as ArrayBuffer);
  return out;
}

describe("workbookToXlsx", () => {
  const wb = buildDemandWorkbook({
    lines: [{ sku: "A1", modele: "Hoodie", quantite: 10, prixUnitaire: 5, type: "Production" }],
    requirements: [{ exigence: "Minimum", categorie: "Matière", statut: "Posée" }],
  });

  it("crée une feuille par onglet, dans l'ordre", async () => {
    const out = await reload(wb);
    expect(out.worksheets.map((w) => w.name)).toEqual(["Lignes", "Exigences"]);
  });

  it("écrit en-têtes en gras, valeurs, formule et volet figé", async () => {
    const out = await reload(wb);
    const ws = out.getWorksheet("Lignes")!;
    expect(ws.getCell("A1").value).toBe(LINES_HEADERS[0]);
    expect(ws.getCell("A1").font?.bold).toBe(true);
    expect(ws.getCell("A2").value).toBe("A1");
    expect(ws.getCell("F2").value).toBe(10);
    const k = ws.getCell("K2").value as { formula: string };
    expect(k.formula).toBe("F2*J2");
    expect(ws.views[0]).toMatchObject({ state: "frozen", ySplit: 1 });
    expect(ws.getColumn(1).width).toBeGreaterThan(5);
  });

  it("reporte les validations de liste", async () => {
    const out = await reload(wb);
    const ws = out.getWorksheet("Lignes")!;
    const dv = ws.getCell("G2").dataValidation;
    expect(dv.type).toBe("list");
    expect(dv.formulae[0]).toContain("Production");
    expect(out.getWorksheet("Exigences")!.getCell("E3").dataValidation.type).toBe("list");
  });

  it("reporte les largeurs de colonnes à liste (Type)", async () => {
    const out = await reload(wb);
    const ws = out.getWorksheet("Lignes")!;
    // 11 caractères (« Échantillon ») × 7 px + 32 px, converti en unités Excel (÷ 7)
    expect(ws.getColumn(7).width).toBeGreaterThanOrEqual(Math.round((11 * 7 + 32) / 7));
  });

  it("tolère un classeur vide", async () => {
    const out = await reload({ sheetOrder: [], sheets: {} });
    expect(out.worksheets.length).toBe(1);
  });
});
