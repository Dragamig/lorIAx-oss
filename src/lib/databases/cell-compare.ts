/**
 * Comparaison de cellules pour le dédoublonnage (create_row avec `match`).
 * Fonctions pures : partagées par l'exécution réelle et la simulation.
 */

type Cells = Record<string, unknown> | null | undefined;

/** Vide : absent, null, chaîne blanche ou tableau vide. */
export function isEmptyCell(value: unknown): boolean {
  if (value === undefined || value === null) return true;
  if (typeof value === "string") return value.trim() === "";
  if (Array.isArray(value)) return value.length === 0;
  return false;
}

function normalizeScalar(value: unknown): string {
  return typeof value === "string" ? value.trim().toLowerCase() : JSON.stringify(value);
}

/** Forme comparable : texte trimé sans casse, tableau en ensemble trié. */
export function normalizeCellValue(value: unknown): string {
  if (isEmptyCell(value)) return "";
  if (Array.isArray(value)) {
    return JSON.stringify([...new Set(value.map(normalizeScalar))].sort());
  }
  return normalizeScalar(value);
}

function normalizedSet(value: unknown): Set<string> {
  return new Set(Array.isArray(value) ? value.map(normalizeScalar) : []);
}

/** Cellules écrites par l'action qui ont une valeur à écrire (les vides n'écrivent rien en fill_empty). */
function hasIncomingAddition(existing: unknown, incoming: unknown): boolean {
  const have = normalizedSet(existing);
  return [...normalizedSet(incoming)].some((v) => !have.has(v));
}

/**
 * Doublon exact : toutes les cellules écrites ont déjà une valeur identique.
 * Relation en mode append : exact si rien de nouveau à ajouter.
 */
export function cellsAlreadyMatch(
  existing: Cells,
  cells: Record<string, unknown>,
  appendColumns: string[] = []
): boolean {
  const current = existing ?? {};
  return Object.entries(cells).every(([col, incoming]) => {
    if (appendColumns.includes(col) && Array.isArray(incoming)) {
      return !hasIncomingAddition(current[col], incoming);
    }
    return normalizeCellValue(current[col]) === normalizeCellValue(incoming);
  });
}

/**
 * Colonnes que `fill_empty` remplirait : cellule vide dans l'existant et valeur
 * à écrire non vide, ou relation append qui ajoute de nouveaux liens.
 */
export function columnsToFill(
  existing: Cells,
  cells: Record<string, unknown>,
  appendColumns: string[] = []
): string[] {
  const current = existing ?? {};
  return Object.entries(cells)
    .filter(([col, incoming]) => {
      if (appendColumns.includes(col) && Array.isArray(incoming)) {
        return hasIncomingAddition(current[col], incoming);
      }
      return isEmptyCell(current[col]) && !isEmptyCell(incoming);
    })
    .map(([col]) => col);
}
