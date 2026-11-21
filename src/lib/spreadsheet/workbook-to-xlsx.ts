/**
 * Conversion d'un classeur Univer (spreadsheet_data) vers un fichier .xlsx (exceljs).
 * Couvre valeurs, formules, en-têtes en gras (style « header » ou bl), largeurs,
 * volet figé et validations de liste (ressource SHEET_DATA_VALIDATION_PLUGIN).
 */

type Cell = { v?: string | number | boolean; f?: string; s?: unknown };
type SheetLike = {
  name?: string;
  cellData?: Record<string, Record<string, Cell>>;
  columnData?: Record<string, { w?: number }>;
  freeze?: { ySplit?: number; xSplit?: number };
};
type Rule = {
  type?: string;
  formula1?: string;
  allowBlank?: boolean;
  ranges?: { startRow: number; endRow: number; startColumn: number; endColumn: number }[];
};

const VALIDATION_PLUGIN = "SHEET_DATA_VALIDATION_PLUGIN";

function isBold(cell: Cell, styles: Record<string, Record<string, unknown>>): boolean {
  const s = typeof cell.s === "string" ? styles[cell.s] : (cell.s as Record<string, unknown> | undefined);
  return !!s && (s.bl === 1 || s.bl === true);
}

function parseRules(wb: Record<string, unknown>): Record<string, Rule[]> {
  const res = (wb.resources as { name: string; data: string }[] | undefined)?.find(
    (r) => r.name === VALIDATION_PLUGIN,
  );
  if (!res) return {};
  try {
    return JSON.parse(res.data) as Record<string, Rule[]>;
  } catch {
    return {};
  }
}

export async function workbookToXlsx(wb: Record<string, unknown>): Promise<Buffer> {
  const ExcelJS = await import("exceljs");
  const out = new ExcelJS.Workbook();
  out.creator = "LorIAx";
  out.created = new Date();

  const sheets = (wb.sheets ?? {}) as Record<string, SheetLike>;
  const order = ((wb.sheetOrder as string[] | undefined) ?? Object.keys(sheets)).filter(
    (id) => sheets[id],
  );
  const styles = (wb.styles ?? {}) as Record<string, Record<string, unknown>>;
  const rules = parseRules(wb);

  if (order.length === 0) out.addWorksheet("Feuille 1");

  for (const id of order) {
    const sh = sheets[id];
    const ws = out.addWorksheet((sh.name || "Feuille").replace(/[\\/?*[\]:]/g, "-").slice(0, 31));

    for (const [c, col] of Object.entries(sh.columnData ?? {})) {
      if (col?.w) ws.getColumn(Number(c) + 1).width = Math.max(6, Math.round(col.w / 7));
    }

    for (const [r, row] of Object.entries(sh.cellData ?? {})) {
      for (const [c, cell] of Object.entries(row ?? {})) {
        const target = ws.getCell(Number(r) + 1, Number(c) + 1);
        if (cell.f) {
          target.value = { formula: cell.f.replace(/^=/, ""), result: undefined };
        } else if (cell.v !== undefined && cell.v !== null && cell.v !== "") {
          target.value = cell.v;
        }
        if (isBold(cell, styles)) target.font = { bold: true };
      }
    }

    const ySplit = sh.freeze?.ySplit ?? 0;
    const xSplit = sh.freeze?.xSplit ?? 0;
    if (ySplit > 0 || xSplit > 0) {
      ws.views = [{ state: "frozen", xSplit, ySplit }];
    }

    for (const rule of rules[id] ?? []) {
      if (rule.type !== "list" || !rule.formula1) continue;
      for (const rg of rule.ranges ?? []) {
        for (let r = rg.startRow; r <= rg.endRow; r++) {
          for (let c = rg.startColumn; c <= rg.endColumn; c++) {
            ws.getCell(r + 1, c + 1).dataValidation = {
              type: "list",
              allowBlank: rule.allowBlank !== false,
              formulae: [`"${rule.formula1.replace(/"/g, "")}"`],
            };
          }
        }
      }
    }
  }

  return Buffer.from(await out.xlsx.writeBuffer());
}
