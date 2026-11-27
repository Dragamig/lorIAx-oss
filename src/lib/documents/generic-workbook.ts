/**
 * Constructeur de classeur générique (une feuille : en-têtes puis lignes).
 * Pur : aucun import @univerjs/*, même enveloppe que demand-workbook.ts.
 */

export type GenericColumnType = "text" | "number" | "date";

export interface GenericColumn {
  name: string;
  type?: GenericColumnType;
}

export interface GenericWorkbookInput {
  columns: GenericColumn[];
  /** Cellules sous forme de chaînes ; un nombre est converti selon le type de colonne. */
  rows?: string[][];
  /** Nom de la feuille (défaut : « Feuille 1 »). */
  sheetTitle?: string;
}

type Cell = { v?: string | number; t?: number; s?: string };
type CellData = Record<number, Record<number, Cell>>;

const HEADER_STYLE = { bl: 1, bg: { rgb: "#F4F4F5" } };

function toCell(value: string | undefined, type: GenericColumnType | undefined): Cell | undefined {
  if (value === undefined || value === "") return undefined;
  if (type === "number") {
    const n = Number(value.replace(",", ".").trim());
    if (Number.isFinite(n) && value.trim() !== "") return { v: n, t: 2 };
  }
  return { v: value, t: 1 };
}

export function buildGenericWorkbook(input: GenericWorkbookInput): Record<string, unknown> {
  const { columns } = input;
  const rows = input.rows ?? [];
  const workbookId = crypto.randomUUID();
  const sheetId = `${workbookId}_feuille1`;

  const cellData: CellData = { 0: {} };
  columns.forEach((c, i) => {
    cellData[0][i] = { v: c.name, t: 1, s: "header" };
  });
  rows.forEach((r, ri) => {
    const row: Record<number, Cell> = {};
    columns.forEach((c, ci) => {
      const cell = toCell(r[ci], c.type);
      if (cell) row[ci] = cell;
    });
    cellData[ri + 1] = row;
  });

  const columnData: Record<number, { w: number }> = {};
  columns.forEach((_, i) => (columnData[i] = { w: 120 }));

  return {
    id: workbookId,
    name: input.sheetTitle ?? "Tableur",
    appVersion: "0.2.0",
    locale: "fr-FR",
    styles: { header: HEADER_STYLE },
    sheetOrder: [sheetId],
    sheets: {
      [sheetId]: {
        id: sheetId,
        name: input.sheetTitle ?? "Feuille 1",
        cellData,
        rowCount: Math.max(100, rows.length + 21),
        columnCount: columns.length,
        defaultColumnWidth: 100,
        defaultRowHeight: 24,
        defaultStyle: { ff: "Arial", fs: 10 },
        freeze: { xSplit: 0, ySplit: 1, startRow: 1, startColumn: 0 },
        mergeData: [],
        rowData: {},
        columnData,
      },
    },
    resources: [],
  };
}
