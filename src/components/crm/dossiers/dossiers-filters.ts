import { todayIn } from "@/lib/crm/dates";
import { toDisplayPatch, type ViewConfig } from "@/lib/bases/view-config";
import {
  applySortAndFilter,
  isFilterGroup,
  newFilterId,
  normalizeFilterTree,
} from "@/components/editor/extensions/database-block/filter-tree";
import type {
  DbColumn,
  DbRow,
  FilterCondition,
  FilterGroup,
  FilterNode,
} from "@/components/editor/extensions/database-block/types";

/** État des filtres de l'écran. `owner` vaut "mine", l'id d'un responsable ou null. */
export interface DossiersFilterState {
  q: string;
  status: string | null;
  owner: string | null;
  contactId: string | null;
  late: boolean;
}

export const EMPTY_STATE: DossiersFilterState = { q: "", status: null, owner: null, contactId: null, late: false };

/** Colonnes raccordées utiles aux filtres (null : champ non raccordé). */
export interface FilterColumnIds {
  titre: string | null;
  statut: string | null;
  responsable: string | null;
  relance: string | null;
  contact: string | null;
}

export function sameState(a: DossiersFilterState, b: DossiersFilterState): boolean {
  return a.q.trim() === b.q.trim() && a.status === b.status && a.owner === b.owner && a.contactId === b.contactId && a.late === b.late;
}

export function isEmptyState(s: DossiersFilterState): boolean {
  return sameState(s, EMPTY_STATE);
}

const cond = (columnId: string, operator: FilterCondition["operator"], value = ""): FilterCondition => ({
  id: newFilterId(),
  columnId,
  operator,
  value,
});

/** Arbre de filtres (ET à plat) exprimant l'état, hors recherche contact. */
export function stateToFilterTree(
  s: DossiersFilterState,
  cols: FilterColumnIds,
  today: string,
  closed: string[],
): FilterGroup {
  const children: FilterNode[] = [];
  if (s.q.trim() && cols.titre) children.push(cond(cols.titre, "contains", s.q.trim()));
  if (s.status && cols.statut) children.push(cond(cols.statut, "is", s.status));
  if (s.owner && cols.responsable) {
    children.push(s.owner === "mine" ? cond(cols.responsable, "is_me") : cond(cols.responsable, "contains", s.owner));
  }
  if (s.contactId && cols.contact) children.push(cond(cols.contact, "contains", s.contactId));
  if (s.late && cols.relance) {
    children.push(cond(cols.relance, "is_before", today));
    if (cols.statut) for (const lane of closed) children.push(cond(cols.statut, "is_not", lane));
  }
  return { id: newFilterId(), type: "group", conjunction: "and", children };
}

/** Config d'une vue de Bases : filtres de l'état et clés d'affichage toutes explicites. */
export function stateToViewConfig(s: DossiersFilterState, cols: FilterColumnIds, today: string, closed: string[]): ViewConfig {
  return { sorts: [], filters: stateToFilterTree(s, cols, today, closed), ...toDisplayPatch({}) };
}

export interface ParsedView {
  state: DossiersFilterState;
  /** Conditions que l'écran ne sait pas exprimer (colonne disparue ou condition d'une autre forme). */
  ignored: number;
}

function leaves(node: FilterNode): FilterCondition[] {
  return isFilterGroup(node) ? node.children.flatMap(leaves) : [node];
}

export function viewConfigToState(config: Record<string, unknown>, cols: FilterColumnIds): ParsedView {
  const root = normalizeFilterTree(config.filters);
  const state: DossiersFilterState = { ...EMPTY_STATE };
  let ignored = 0;
  let lateRel = false;
  let notClosed = 0;
  const flat: FilterCondition[] = [];
  for (const child of root.children) {
    if (isFilterGroup(child) || root.conjunction === "or") ignored += leaves(child).length;
    else flat.push(child);
  }
  for (const c of flat) {
    const needsValue = c.operator !== "is_me";
    if (needsValue && !c.value.trim()) continue;
    if (c.columnId === cols.titre && c.operator === "contains") state.q = c.value;
    else if (c.columnId === cols.statut && c.operator === "is") state.status = c.value;
    else if (c.columnId === cols.statut && c.operator === "is_not") notClosed += 1;
    else if (c.columnId === cols.responsable && c.operator === "is_me") state.owner = "mine";
    else if (c.columnId === cols.responsable && c.operator === "contains") state.owner = c.value;
    else if (c.columnId === cols.contact && c.operator === "contains") state.contactId = c.value;
    else if (c.columnId === cols.relance && c.operator === "is_before") lateRel = true;
    else ignored += 1;
  }
  state.late = lateRel;
  if (!lateRel) ignored += notClosed;
  return { state, ignored };
}

/** La vue enregistrée dont les filtres égalent l'état courant, sinon null (Vue personnalisée). */
export function matchViewTab(
  views: { id: string; config: Record<string, unknown> }[],
  state: DossiersFilterState,
  cols: FilterColumnIds,
): string | null {
  for (const v of views) {
    if (sameState(viewConfigToState(v.config, cols).state, state)) return v.id;
  }
  return null;
}

interface FilterInput<D extends { id: string; title: string; contactName: string | null }> {
  deals: D[];
  rows: { id: string; cells: Record<string, unknown> }[];
  columns: { id: string; name: string; type: string; config: Record<string, unknown> }[];
  cols: FilterColumnIds;
  state: DossiersFilterState;
  closed: string[];
  userId: string;
  now: Date;
  tz: string;
}

/** Dossiers visibles : filtres de l'arbre (mêmes opérateurs que Bases), puis recherche titre ou contact. */
export function applyDossiersFilters<D extends { id: string; title: string; contactName: string | null }>(
  input: FilterInput<D>,
): D[] {
  const { deals, rows, columns, cols, state, closed, userId, now, tz } = input;
  const today = todayIn(now, tz);
  // La recherche libre couvre aussi le contact : seule la partie colonne passe par l'arbre.
  const tree = stateToFilterTree({ ...state, q: "" }, cols, today, closed);
  const dbRows = rows.map((r, position) => ({ id: r.id, databaseId: "", cells: r.cells, position, createdAt: "", updatedAt: "" }));
  const kept = new Set(
    applySortAndFilter(dbRows as unknown as DbRow[], columns as unknown as DbColumn[], [], tree, { now, userId, tz }).map((r) => r.id),
  );
  const q = state.q.trim().toLowerCase();
  return deals.filter(
    (d) => kept.has(d.id) && (!q || d.title.toLowerCase().includes(q) || (d.contactName ?? "").toLowerCase().includes(q)),
  );
}
