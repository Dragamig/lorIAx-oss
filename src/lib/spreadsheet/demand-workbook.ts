/**
 * Constructeur du classeur d'une demande (feuilles « Lignes » et « Exigences »).
 * Pur : aucun import @univerjs/*, forme alignée sur fortune-to-univer.ts.
 */

export const LINES_HEADERS = [
  "SKU", "Modèle", "Couleur", "Taille", "Matière et grammage", "Quantité",
  "Type", "Personnalisation", "Industriel", "Prix unitaire (€)",
  "Prix total (€)", "Délai", "Pays de confection", "Statut", "Provenance",
  "Fichiers",
] as const;

export const REQUIREMENTS_HEADERS = [
  "Exigence", "Catégorie", "Détail", "Réponse industriel", "Statut",
] as const;

export const LINE_TYPES = ["Production", "Échantillon"] as const;
export const LINE_STATUSES = ["À chiffrer", "Chiffrée", "Validée"] as const;
export const LINE_ORIGINS = ["Extrait", "Deviné", "Saisi"] as const;
export const REQUIREMENT_CATEGORIES = [
  "Minimum et couleurs", "Matière", "Coupe et finitions", "Frais", "Délais",
  "Corrections", "Échantillons", "Devis",
] as const;
export const REQUIREMENT_STATUSES = ["À poser", "Posée", "Répondue", "Validée"] as const;

export interface DemandLine {
  sku?: string;
  modele?: string;
  couleur?: string;
  taille?: string;
  matiere?: string;
  quantite?: number;
  type?: string;
  personnalisation?: string;
  industriel?: string;
  prixUnitaire?: number;
  delai?: string;
  paysConfection?: string;
  statut?: string;
  provenance?: string;
  fichiers?: string[];
}

export interface DemandRequirement {
  exigence?: string;
  categorie?: string;
  detail?: string;
  reponse?: string;
  statut?: string;
}

export interface DemandWorkbookInput {
  lines?: DemandLine[];
  requirements?: DemandRequirement[];
}

type Cell = { v?: string | number; f?: string; t?: number; s?: string };
type CellData = Record<number, Record<number, Cell>>;

const VALIDATION_PLUGIN = "SHEET_DATA_VALIDATION_PLUGIN";
const HEADER_STYLE = { bl: 1, bg: { rgb: "#F4F4F5" } };

function text(v: string | undefined): Cell | undefined {
  return v === undefined || v === "" ? undefined : { v, t: 1 };
}
function num(v: number | undefined): Cell | undefined {
  return v === undefined || v === null || Number.isNaN(v) ? undefined : { v, t: 2 };
}

function headerRow(headers: readonly string[]): Record<number, Cell> {
  const row: Record<number, Cell> = {};
  headers.forEach((h, c) => {
    row[c] = { v: h, t: 1, s: "header" };
  });
  return row;
}

function putRow(cellData: CellData, r: number, cells: (Cell | undefined)[]) {
  const row: Record<number, Cell> = {};
  cells.forEach((cell, c) => {
    if (cell) row[c] = cell;
  });
  cellData[r] = row;
}

function sheet(
  id: string,
  name: string,
  cellData: CellData,
  columnCount: number,
  widths: number[],
) {
  const columnData: Record<number, { w: number }> = {};
  widths.forEach((w, c) => (columnData[c] = { w }));
  return {
    id,
    name,
    cellData,
    rowCount: Math.max(100, Object.keys(cellData).length + 20),
    columnCount,
    defaultColumnWidth: 100,
    defaultRowHeight: 24,
    defaultStyle: { ff: "Arial", fs: 10 },
    freeze: { xSplit: 0, ySplit: 1, startRow: 1, startColumn: 0 },
    mergeData: [],
    rowData: {},
    columnData,
  };
}

const CHAR_PX = 7;
const DROPDOWN_PX = 32;

/** Largeur d'une colonne à liste : valeur la plus longue + pastille, sans passer sous le minimum. */
function listWidth(values: readonly string[], min: number): number {
  const longest = Math.max(...values.map((v) => v.length));
  return Math.max(min, longest * CHAR_PX + DROPDOWN_PX);
}

function listRule(column: number, values: readonly string[], rowCount: number) {
  return {
    uid: crypto.randomUUID(),
    type: "list",
    formula1: values.join(","),
    ranges: [{ startRow: 1, endRow: rowCount - 1, startColumn: column, endColumn: column }],
    allowBlank: true,
  };
}

export function buildDemandWorkbook(input: DemandWorkbookInput = {}): Record<string, unknown> {
  const lines = input.lines ?? [];
  const requirements = input.requirements ?? [];

  const workbookId = crypto.randomUUID();
  const linesId = `${workbookId}_lignes`;
  const reqId = `${workbookId}_exigences`;

  const linesData: CellData = { 0: headerRow(LINES_HEADERS) };
  lines.forEach((l, i) => {
    const n = i + 2; // numéro de ligne 1-based, en-tête = 1
    putRow(linesData, i + 1, [
      text(l.sku), text(l.modele), text(l.couleur), text(l.taille), text(l.matiere),
      num(l.quantite), text(l.type), text(l.personnalisation), text(l.industriel),
      num(l.prixUnitaire), { f: `=F${n}*J${n}` }, text(l.delai), text(l.paysConfection),
      text(l.statut), text(l.provenance),
      text(l.fichiers && l.fichiers.length ? l.fichiers.join(", ") : undefined),
    ]);
  });

  const reqData: CellData = { 0: headerRow(REQUIREMENTS_HEADERS) };
  requirements.forEach((q, i) => {
    putRow(reqData, i + 1, [
      text(q.exigence), text(q.categorie), text(q.detail), text(q.reponse), text(q.statut),
    ]);
  });

  const linesRows = Math.max(100, lines.length + 20);
  const reqRows = Math.max(100, requirements.length + 20);
  const validation = {
    [linesId]: [
      listRule(6, LINE_TYPES, linesRows),
      listRule(13, LINE_STATUSES, linesRows),
      listRule(14, LINE_ORIGINS, linesRows),
    ],
    [reqId]: [
      listRule(1, REQUIREMENT_CATEGORIES, reqRows),
      listRule(4, REQUIREMENT_STATUSES, reqRows),
    ],
  };

  return {
    id: workbookId,
    name: "Demande",
    appVersion: "0.2.0",
    locale: "fr-FR",
    styles: { header: HEADER_STYLE },
    sheetOrder: [linesId, reqId],
    sheets: {
      [linesId]: sheet(linesId, "Lignes", linesData, LINES_HEADERS.length,
        [
          90, 120, 90, 70, 150, 80,
          listWidth(LINE_TYPES, 100), 140, 120, 110, 100, 90, 130,
          listWidth(LINE_STATUSES, 100), listWidth(LINE_ORIGINS, 100), 180,
        ]),
      [reqId]: sheet(reqId, "Exigences", reqData, REQUIREMENTS_HEADERS.length,
        [
          180, listWidth(REQUIREMENT_CATEGORIES, 160), 260, 220,
          listWidth(REQUIREMENT_STATUSES, 100),
        ]),
    },
    resources: [{ name: VALIDATION_PLUGIN, data: JSON.stringify(validation) }],
  };
}
