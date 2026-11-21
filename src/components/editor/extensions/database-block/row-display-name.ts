import type { CellValue, DbColumn, DbRow } from "./types";
import { evaluateFormula } from "./formula-evaluator";
import { formatAutonumber } from "./autonumber-format";

function isFilled(v: CellValue | undefined): v is CellValue {
  return !(v == null || v === "" || (Array.isArray(v) && v.length === 0));
}

// Valeur affichée d'une cellule, en texte, selon le type de la colonne
// (formule évaluée, numérotation auto formatée). Chaîne vide si vide.
function displayedCellText(row: DbRow, col: DbColumn, columns: DbColumn[]): string {
  if (col.type === "formula") {
    const f = col.config?.formula;
    if (typeof f !== "string" || !f) return "";
    const v = evaluateFormula(f, row, columns);
    return isFilled(v) && !Array.isArray(v) ? String(v) : "";
  }
  const raw = row.cells?.[col.id];
  if (col.type === "autonumber") {
    return formatAutonumber(raw, {
      padding: col.config?.padding as number | undefined,
      prefix: col.config?.prefix as string | undefined,
      suffix: col.config?.suffix as string | undefined,
    });
  }
  if (!isFilled(raw) || typeof raw === "boolean" || Array.isArray(raw)) return "";
  return String(raw);
}

/** Libellé d'une ligne liée : première colonne (par position) dont la valeur affichée est non vide. */
export function getRowDisplayName(row: DbRow, targetColumns?: DbColumn[]): string {
  const cells = row.cells ?? {};

  if (targetColumns && targetColumns.length > 0) {
    for (const col of targetColumns) {
      const text = displayedCellText(row, col, targetColumns);
      if (text !== "") return text;
    }
  }

  // Repli : première valeur brute non vide
  for (const val of Object.values(cells)) {
    if (val != null && val !== "" && typeof val !== "boolean" && !Array.isArray(val)) {
      return String(val);
    }
  }

  return `Ligne ${row.position + 1}`;
}

/** Libellés des lignes liées (ids) ; « … » tant que la base cible n'est pas chargée, l'id si la ligne est absente. */
export function getRelationLabels(
  ids: unknown,
  target: { rows: DbRow[]; columns: DbColumn[] } | undefined,
): string[] {
  if (!Array.isArray(ids)) return [];
  return ids.map((id) => {
    if (!target) return "…";
    const row = target.rows.find((r) => r.id === id);
    return row ? getRowDisplayName(row, target.columns) : String(id);
  });
}
