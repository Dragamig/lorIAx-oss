// Logique pure de la vue Kanban de /bases : regroupement des lignes en colonnes
// et valeur à écrire dans la cellule de regroupement lors d'un déplacement.
import { normalizeOptions } from "@/components/editor/extensions/database-block/options";
import { evaluateFormula } from "@/components/editor/extensions/database-block/formula-evaluator";
import type { DbColumn, DbRow } from "@/components/editor/extensions/database-block/types";
import { kanbanTotalsSchema, type KanbanTotalsConfig } from "@/lib/bases/view-config";

export type KanbanCellValue = string | number | boolean | string[] | null;

export interface KanbanColumnLike {
  id: string;
  name: string;
  type: string;
  config?: Record<string, unknown> | null;
}

export interface KanbanRowLike {
  id: string;
  cells: Record<string, unknown>;
}

export interface KanbanLane<R extends KanbanRowLike = KanbanRowLike> {
  /** Libellé de l'option, "" pour la colonne « Sans valeur ». */
  key: string;
  rows: R[];
}

/** Colonnes pouvant servir de regroupement (select). */
export function groupableColumns<C extends KanbanColumnLike>(columns: C[]): C[] {
  return columns.filter((c) => c.type === "select");
}

/** Colonne de regroupement lue dans la config de la vue, null si absente ou invalide. */
export function resolveGroupColumn<C extends KanbanColumnLike>(
  columns: C[],
  viewConfig: Record<string, unknown> | null | undefined,
): C | null {
  const id = viewConfig?.groupByColumnId;
  if (typeof id !== "string") return null;
  return groupableColumns(columns).find((c) => c.id === id) ?? null;
}

export function isMultiple(column: KanbanColumnLike): boolean {
  return !!column.config?.multiple;
}

/** Regroupe les lignes : une voie par option, plus « Sans valeur » en dernier. */
export function groupRowsIntoLanes<R extends KanbanRowLike>(
  column: KanbanColumnLike,
  rows: R[],
): KanbanLane<R>[] {
  const options = normalizeOptions(column.config?.options);
  const map = new Map<string, R[]>();
  options.forEach((o) => map.set(o, []));
  map.set("", []);
  const multiple = isMultiple(column);
  for (const row of rows) {
    const v = row.cells?.[column.id];
    const values: string[] = multiple && Array.isArray(v)
      ? v.map(String)
      : v == null || v === "" || (Array.isArray(v) && v.length === 0)
        ? [""]
        : [String(v)];
    for (const val of values.length ? values : [""]) {
      if (!map.has(val)) map.set(val, []);
      map.get(val)!.push(row);
    }
  }
  const keys = [...options.filter((o, i) => options.indexOf(o) === i), ...[...map.keys()].filter((k) => k !== "" && !options.includes(k)), ""];
  return keys.map((key) => ({ key, rows: map.get(key) ?? [] }));
}

/**
 * Valeur à écrire dans la cellule de regroupement quand une carte passe de la
 * voie `from` à la voie `to`. Null si rien ne change.
 */
export function valueForMove(
  column: KanbanColumnLike,
  current: unknown,
  from: string,
  to: string,
): KanbanCellValue | undefined {
  if (from === to) return undefined;
  if (isMultiple(column)) {
    const list = Array.isArray(current) ? current.map(String) : [];
    const next = list.filter((x) => x !== from);
    if (to !== "" && !next.includes(to)) next.push(to);
    return next;
  }
  return to === "" ? null : to;
}

/** Cellules initiales d'une nouvelle carte créée dans une voie. */
export function cellsForNewCard(
  column: KanbanColumnLike,
  lane: string,
): Record<string, KanbanCellValue> {
  if (lane === "") return {};
  return { [column.id]: isMultiple(column) ? [lane] : lane };
}

// ---------------------------------------------------------------------------
// Totaux du kanban (fonctions pures, aucun arrondi : le formatage est fait à l'affichage)
// ---------------------------------------------------------------------------

export type ActiveTotalsConfig = KanbanTotalsConfig & {
  currency: string;
  /** Valeur brute du montant d'une ligne (formule évaluée à la volée) ; absent = lecture de la cellule. */
  amountOf?: (row: KanbanRowLike) => unknown;
};

export type TotalsResolution =
  | { active: ActiveTotalsConfig }
  | { active: null; reason: "none" | "missing_column" | "bad_type" };

/** Config des totaux de la vue, ou la raison pour laquelle elle est inactive. */
export function resolveTotalsConfig(
  columns: KanbanColumnLike[],
  viewConfig: Record<string, unknown> | null | undefined,
): TotalsResolution {
  const raw = viewConfig?.kanbanTotals;
  if (raw == null) return { active: null, reason: "none" };
  const parsed = kanbanTotalsSchema.safeParse(raw);
  if (!parsed.success) return { active: null, reason: "none" };
  const column = columns.find((c) => c.id === parsed.data.amountColumnId);
  if (!column) return { active: null, reason: "missing_column" };
  if (column.type !== "number" && column.type !== "formula") {
    return { active: null, reason: "bad_type" };
  }
  const active: ActiveTotalsConfig = { ...parsed.data, currency: parsed.data.currency || "EUR" };
  if (column.type === "formula") {
    // Les valeurs de formule ne sont jamais stockées : même évaluation que aggregate.ts.
    const formula = String(column.config?.formula ?? "");
    active.amountOf = (row) =>
      evaluateFormula(formula, row as unknown as DbRow, columns as unknown as DbColumn[]);
  }
  return { active };
}

/** Montant d'une cellule : nombre fini seulement, jamais de parsing de texte. */
export function readAmount(cell: unknown): number | null {
  return typeof cell === "number" && Number.isFinite(cell) ? cell : null;
}

function amountFor(row: KanbanRowLike, cfg: ActiveTotalsConfig): number | null {
  return readAmount(cfg.amountOf ? cfg.amountOf(row) : row.cells?.[cfg.amountColumnId]);
}

function weightOf(cfg: ActiveTotalsConfig, key: string): number {
  const w = Object.prototype.hasOwnProperty.call(cfg.weights, key) ? cfg.weights[key] : 0;
  return typeof w === "number" && Number.isFinite(w) ? w : 0;
}

/** La voie « Sans valeur » (clé "") n'est jamais close. */
function isClosed(cfg: ActiveTotalsConfig, key: string): boolean {
  return key !== "" && cfg.closedLanes.includes(key);
}

export function laneTotals(
  lane: KanbanLane,
  cfg: ActiveTotalsConfig,
): { count: number; sum: number; weighted: number; unpriced: number } {
  let sum = 0;
  let unpriced = 0;
  for (const row of lane.rows) {
    const amount = amountFor(row, cfg);
    if (amount === null) unpriced += 1;
    else sum += amount;
  }
  return { count: lane.rows.length, sum, weighted: (sum * weightOf(cfg, lane.key)) / 100, unpriced };
}

export function boardTotals(
  lanes: KanbanLane[],
  cfg: ActiveTotalsConfig,
): { count: number; open: number; openSum: number; weightedSum: number } {
  const all = new Set<string>();
  // Par ligne ouverte : montant et poids maximal de ses voies ouvertes.
  const open = new Map<string, { amount: number; weight: number }>();
  for (const lane of lanes) {
    const closed = isClosed(cfg, lane.key);
    const w = weightOf(cfg, lane.key);
    for (const row of lane.rows) {
      all.add(row.id);
      if (closed) continue;
      const prev = open.get(row.id);
      if (prev) prev.weight = Math.max(prev.weight, w);
      else open.set(row.id, { amount: amountFor(row, cfg) ?? 0, weight: w });
    }
  }
  let openSum = 0;
  let weightedSum = 0;
  for (const { amount, weight } of open.values()) {
    openSum += amount;
    weightedSum += (amount * weight) / 100;
  }
  return { count: all.size, open: open.size, openSum, weightedSum };
}

/** Vrai si une carte peut apparaître dans plusieurs voies (mention du menu Totaux). */
export function isMultiValueGrouping(column: KanbanColumnLike): boolean {
  return isMultiple(column);
}
