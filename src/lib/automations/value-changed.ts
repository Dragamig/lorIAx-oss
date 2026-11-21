/**
 * Logique pure du déclencheur d'automatisation « changement de valeur » (C2).
 *
 * Isolée de l'executor (qui importe des modules serveur — DNS, BDD) pour rester
 * testable sans dépendances lourdes. L'executor importe `shouldFireValueChanged`
 * et l'applique au diff avant/après d'une ligne lors d'un PATCH.
 *
 * Réutilise `matchesFilter` (filter-tree) pour la condition optionnelle sur la
 * nouvelle valeur → parité exacte avec les opérateurs des filtres de l'UI.
 */
import { matchesFilter } from "@/components/editor/extensions/database-block/filter-tree";
import { IS_ME_REJECTED_MESSAGE } from "@/lib/automations/automation-graph";
import type {
  CellValue,
  ColumnType,
  FilterOperator,
} from "@/components/editor/extensions/database-block/types";

/** Configuration JSON du déclencheur, stockée dans `triggerConfig`. */
export interface ValueChangedConfig {
  /** Id de la colonne surveillée (requis). */
  columnId?: string;
  /** Opérateur de condition sur la NOUVELLE valeur (optionnel). */
  operator?: FilterOperator;
  /** Valeur de comparaison de la condition (optionnel). */
  value?: string;
  /** Type de colonne, pour la sémantique calendaire des dates (optionnel). */
  colType?: ColumnType;
}

/**
 * Valide la configuration enregistrée du déclencheur : `is_me` est refusé
 * (pas d'utilisateur courant dans un automatisme). Renvoie le message
 * d'erreur, ou null si la configuration est acceptable.
 */
export function validateValueChangedConfig(config: unknown): string | null {
  if (
    config &&
    typeof config === "object" &&
    (config as { operator?: unknown }).operator === "is_me"
  ) {
    return IS_ME_REJECTED_MESSAGE;
  }
  return null;
}

/**
 * Normalise une valeur de cellule pour comparaison d'égalité. null / undefined /
 * "" sont tous traités comme « vide » (chaîne vide). Les tableaux sont comparés
 * via leur forme JSON (ordre significatif). Le reste passe par String().
 */
function normalizeCell(raw: unknown): string {
  if (raw === null || raw === undefined || raw === "") return "";
  // Tableau vide = absence de valeur (même sémantique que matchesFilter).
  if (Array.isArray(raw)) return raw.length === 0 ? "" : JSON.stringify(raw);
  return String(raw);
}

/** Vrai si la valeur de cellule a changé entre `before` et `after`. */
export function hasCellChanged(before: unknown, after: unknown): boolean {
  return normalizeCell(before) !== normalizeCell(after);
}

/**
 * Décide si une automation « changement de valeur » doit se déclencher pour le
 * diff d'une ligne. Renvoie false si la config est invalide (pas de columnId),
 * si la colonne surveillée n'a pas changé, ou si une condition est fournie et
 * que la nouvelle valeur ne la satisfait pas.
 */
export function shouldFireValueChanged(
  beforeCells: Record<string, unknown>,
  afterCells: Record<string, unknown>,
  config: ValueChangedConfig,
): boolean {
  const { columnId, operator, value, colType } = config;
  if (!columnId) return false;

  const oldVal = beforeCells[columnId];
  const newVal = afterCells[columnId];
  if (!hasCellChanged(oldVal, newVal)) return false;

  // Pas de condition → tout changement de la colonne déclenche.
  if (!operator) return true;

  return matchesFilter(newVal as CellValue, operator, value ?? "", { colType });
}
