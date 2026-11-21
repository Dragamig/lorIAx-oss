import type {
  CellValue,
  ColumnType,
  DbColumn,
  DbRow,
  FilterCondition,
  FilterConjunction,
  FilterGroup,
  FilterNode,
  FilterOperator,
  SortConfig,
} from "./types";
import { DAY_MS, toDate, startOfDay, startOfWeek } from "./date-helpers";
import { dayNumber, isValidTz, quarterOf, zonedParts } from "@/lib/bases/tz-date";

// Contexte d'évaluation des filtres. Sans contexte (ou sans tz), le comportement
// reste celui du processus : heure locale, new Date().
export type FilterContext = { now?: Date; userId?: string; tz?: string };

/** Opérateurs à ne pas proposer : « est moi » sans utilisateur courant ne correspondrait à rien. */
export function operatorsExcludedFor(ctx: FilterContext | undefined): FilterOperator[] | undefined {
  return ctx?.userId ? undefined : ["is_me"];
}

// Opérateur de filtre par défaut selon le type de colonne. Défini ici (module
// pur, sans React) pour être importable côté serveur ; ré-exporté par
// constants.tsx pour les consommateurs UI.
export const DEFAULT_FILTER_OPERATOR: Record<ColumnType, FilterOperator> = {
  text: "contains",
  url: "contains",
  email: "contains",
  formula: "contains",
  number: "eq",
  autonumber: "eq",
  date: "is",
  time: "is",
  select: "is",
  checkbox: "is_checked",
  relation: "contains",
  image: "is_not_empty",
  attachment: "is_not_empty",
  person: "is_not_empty",
  document_link: "contains",
};

// ─── Identifiants ───────────────────────────────────────────────────────────
// Identifiant stable pour les clés React et le ciblage des mutations par nœud.

let idCounter = 0;
export function newFilterId(): string {
  idCounter += 1;
  const rnd =
    typeof crypto !== "undefined" && "randomUUID" in crypto
      ? crypto.randomUUID().slice(0, 8)
      : idCounter.toString(36);
  return `f_${rnd}_${idCounter}`;
}

// ─── Garde de type ────────────────────────────────────────────────────────────

export function isFilterGroup(node: FilterNode): node is FilterGroup {
  return (node as FilterGroup).type === "group";
}

// Opérateurs qui n'ont pas besoin d'une valeur saisie (input masqué côté UI).
export const NO_VALUE_OPS = new Set<FilterOperator>([
  "is_empty",
  "is_not_empty",
  "is_checked",
  "is_not_checked",
  // Dates relatives : la référence est « aujourd'hui », aucune valeur à saisir.
  "is_today",
  "is_this_week",
  "is_this_month",
  "is_this_year",
  "is_this_quarter",
  // Personne : la référence est l'utilisateur courant.
  "is_me",
]);

// ─── Fabriques ────────────────────────────────────────────────────────────────

export function createCondition(columns: DbColumn[]): FilterCondition {
  const col = columns[0];
  return {
    id: newFilterId(),
    columnId: col?.id ?? "",
    operator: col ? DEFAULT_FILTER_OPERATOR[col.type] : "contains",
    value: "",
  };
}

export function createGroup(columns: DbColumn[]): FilterGroup {
  // Comme Airtable : un nouveau groupe démarre avec une condition vide.
  return {
    id: newFilterId(),
    type: "group",
    conjunction: "and",
    children: [createCondition(columns)],
  };
}

export function emptyTree(): FilterGroup {
  return { id: newFilterId(), type: "group", conjunction: "and", children: [] };
}

// ─── Migration / normalisation ──────────────────────────────────────────────
// Accepte l'ancien format plat (FilterConfig[]) ou un arbre déjà structuré,
// et renvoie toujours un FilterGroup racine valide (ids garantis).

export function normalizeFilterTree(input: unknown): FilterGroup {
  if (input == null) return emptyTree();

  // Ancien format : tableau plat de conditions en ET implicite.
  if (Array.isArray(input)) {
    return {
      id: newFilterId(),
      type: "group",
      conjunction: "and",
      children: input
        .map(normalizeCondition)
        .filter((c): c is FilterCondition => c !== null),
    };
  }

  if (typeof input === "object") {
    const obj = input as Record<string, unknown>;
    if (obj.type === "group") return normalizeGroup(obj);
  }

  return emptyTree();
}

function normalizeGroup(obj: Record<string, unknown>): FilterGroup {
  const conjunction: FilterConjunction = obj.conjunction === "or" ? "or" : "and";
  const rawChildren = Array.isArray(obj.children) ? obj.children : [];
  const children: FilterNode[] = [];
  for (const raw of rawChildren) {
    if (raw && typeof raw === "object") {
      const r = raw as Record<string, unknown>;
      if (r.type === "group") {
        children.push(normalizeGroup(r));
        continue;
      }
      const cond = normalizeCondition(r);
      if (cond) children.push(cond);
    }
  }
  return {
    id: typeof obj.id === "string" ? obj.id : newFilterId(),
    type: "group",
    conjunction,
    children,
  };
}

function normalizeCondition(raw: unknown): FilterCondition | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  if (typeof r.columnId !== "string") return null;
  return {
    id: typeof r.id === "string" ? r.id : newFilterId(),
    columnId: r.columnId,
    operator: (typeof r.operator === "string" ? r.operator : "contains") as FilterOperator,
    value: typeof r.value === "string" ? r.value : "",
  };
}

// ─── Élagage des conditions incomplètes ─────────────────────────────────────
// Une condition exigeant une valeur mais sans valeur n'a aucun effet (comme
// Airtable). Les groupes vidés disparaissent. Renvoie null si l'arbre est vide.

export function pruneFilterTree(node: FilterNode): FilterNode | null {
  if (isFilterGroup(node)) {
    const kids = node.children
      .map(pruneFilterTree)
      .filter((n): n is FilterNode => n !== null);
    if (kids.length === 0) return null;
    return { ...node, children: kids };
  }
  if (!NO_VALUE_OPS.has(node.operator) && !node.value.trim()) return null;
  return node;
}

// ─── Comparaisons de dates (granularité jour, comme Airtable) ────────────────
// Les helpers de date sont partagés avec le moteur de formules (date-helpers.ts).

interface CalParts {
  year: number;
  month: number;
  day: number;
  weekday: number;
}

function civil(year: number, month: number, day: number): CalParts | null {
  const t = new Date(Date.UTC(year, month - 1, day));
  if (t.getUTCFullYear() !== year || t.getUTCMonth() !== month - 1 || t.getUTCDate() !== day) {
    return null;
  }
  return { year, month, day, weekday: t.getUTCDay() };
}

const WALL_CLOCK = /^(\d{4})-(\d{2})-(\d{2})(?:[T ]\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?)?$/;

// Jour civil d'une cellule ou d'une cible dans le fuseau `tz`. Une date seule ou
// une heure murale sans fuseau désigne déjà un jour civil (non convertie) ; un
// instant (suffixe Z ou décalage, nombre) est converti dans `tz`.
function calParts(v: unknown, tz: string): CalParts | null {
  if (typeof v === "string") {
    const m = v.trim().match(WALL_CLOCK);
    if (m) return civil(Number(m[1]), Number(m[2]), Number(m[3]));
  }
  const d = toDate(v);
  return d ? zonedParts(d, tz) : null;
}

// Évalue un opérateur de date avec un fuseau explicite : jours civils du fuseau.
function matchesDateFilterTz(
  raw: CellValue,
  operator: FilterOperator,
  value: string,
  now: Date,
  tz: string,
): boolean {
  const cell = calParts(raw, tz);
  if (!cell) return false;
  const cellDay = dayNumber(cell);
  const today = zonedParts(now, tz);
  const todayDay = dayNumber(today);

  switch (operator) {
    case "is_today":
      return cellDay === todayDay;
    case "is_this_week": {
      const ws = todayDay - ((today.weekday + 6) % 7);
      return cellDay >= ws && cellDay < ws + 7;
    }
    case "is_this_month":
      return cell.year === today.year && cell.month === today.month;
    case "is_this_quarter":
      return cell.year === today.year && quarterOf(cell) === quarterOf(today);
    case "is_this_year":
      return cell.year === today.year;
    case "is_within_days": {
      const n = Number(value);
      if (!Number.isFinite(n)) return false;
      return cellDay >= todayDay && cellDay <= todayDay + n;
    }
  }

  const target = calParts(value, tz);
  if (!target) return false;
  const targetDay = dayNumber(target);
  switch (operator) {
    case "is":
      return cellDay === targetDay;
    case "is_not":
      return cellDay !== targetDay;
    case "is_before":
      return cellDay < targetDay;
    case "is_after":
      return cellDay > targetDay;
    case "is_on_or_before":
      return cellDay <= targetDay;
    case "is_on_or_after":
      return cellDay >= targetDay;
    default:
      return true;
  }
}

// Évalue un opérateur de date sur une cellule (raw) vis-à-vis de `value`/`now`.
// Sans `tz` valide : logique historique (jours locaux du processus).
function matchesDateFilter(
  raw: CellValue,
  operator: FilterOperator,
  value: string,
  now: Date,
  tz?: string,
): boolean {
  if (isValidTz(tz)) return matchesDateFilterTz(raw, operator, value, now, tz);

  const cell = toDate(raw);
  if (!cell) return false;
  const cellDay = startOfDay(cell);

  switch (operator) {
    case "is_today":
      return cellDay === startOfDay(now);
    case "is_this_week": {
      const ws = startOfWeek(now);
      return cellDay >= ws && cellDay < ws + 7 * DAY_MS;
    }
    case "is_this_month":
      return cell.getFullYear() === now.getFullYear() && cell.getMonth() === now.getMonth();
    case "is_this_quarter":
      return (
        cell.getFullYear() === now.getFullYear() &&
        quarterOf({ month: cell.getMonth() + 1 }) === quarterOf({ month: now.getMonth() + 1 })
      );
    case "is_this_year":
      return cell.getFullYear() === now.getFullYear();
    case "is_within_days": {
      const n = Number(value);
      if (!Number.isFinite(n)) return false;
      const today = startOfDay(now);
      return cellDay >= today && cellDay <= today + n * DAY_MS;
    }
  }

  // Opérateurs comparant à une date saisie.
  const target = toDate(value);
  if (!target) return false;
  const targetDay = startOfDay(target);
  switch (operator) {
    case "is":
      return cellDay === targetDay;
    case "is_not":
      return cellDay !== targetDay;
    case "is_before":
      return cellDay < targetDay;
    case "is_after":
      return cellDay > targetDay;
    case "is_on_or_before":
      return cellDay <= targetDay;
    case "is_on_or_after":
      return cellDay >= targetDay;
    default:
      return true;
  }
}

// ─── Évaluation d'une cellule contre un opérateur ───────────────────────────

export function matchesFilter(
  raw: CellValue,
  operator: FilterOperator,
  value: string,
  opts?: { colType?: ColumnType; now?: Date; userId?: string; tz?: string },
): boolean {
  const isEmpty = raw == null || raw === "" || (Array.isArray(raw) && raw.length === 0);

  switch (operator) {
    case "is_empty":
      return isEmpty;
    case "is_not_empty":
      return !isEmpty;
    case "is_checked":
      return raw === true || raw === "true" || raw === 1;
    case "is_not_checked":
      return !(raw === true || raw === "true" || raw === 1);
    case "is_me": {
      // Cellule person : tableau d'identifiants (ou chaîne scalaire héritée).
      const uid = opts?.userId;
      if (!uid) return false;
      return Array.isArray(raw) ? raw.includes(uid) : raw === uid;
    }
    case "is_this_quarter":
      // Toujours évalué comme une date, quel que soit le type de colonne.
      return isEmpty ? false : matchesDateFilter(raw, operator, value, opts?.now ?? new Date(), opts?.tz);
  }

  if (isEmpty) return false;

  // Colonnes date/heure : sémantique calendaire (jour), pas de comparaison de chaînes.
  if (opts?.colType === "date" || opts?.colType === "time") {
    return matchesDateFilter(raw, operator, value, opts.now ?? new Date(), opts.tz);
  }

  const strVal = Array.isArray(raw) ? raw.join(", ") : String(raw);
  const query = value.toLowerCase();

  switch (operator) {
    case "contains":
      return strVal.toLowerCase().includes(query);
    case "not_contains":
      return !strVal.toLowerCase().includes(query);
    case "is":
      return strVal.toLowerCase() === query;
    case "is_not":
      return strVal.toLowerCase() !== query;
    case "is_before":
      return strVal < value;
    case "is_after":
      return strVal > value;
    case "eq":
      return Number(raw) === Number(value);
    case "neq":
      return Number(raw) !== Number(value);
    case "lt":
      return Number(raw) < Number(value);
    case "lte":
      return Number(raw) <= Number(value);
    case "gt":
      return Number(raw) > Number(value);
    case "gte":
      return Number(raw) >= Number(value);
    default:
      return true;
  }
}

// ─── Évaluation récursive de l'arbre pour une ligne ─────────────────────────
// Suppose l'arbre déjà élagué (pruneFilterTree). Un groupe vide passe (true).

export function evaluateNode(
  node: FilterNode,
  row: DbRow,
  colTypes?: Record<string, ColumnType>,
  ctx?: FilterContext,
): boolean {
  if (isFilterGroup(node)) {
    if (node.children.length === 0) return true;
    return node.conjunction === "and"
      ? node.children.every((c) => evaluateNode(c, row, colTypes, ctx))
      : node.children.some((c) => evaluateNode(c, row, colTypes, ctx));
  }
  return matchesFilter(row.cells?.[node.columnId] ?? null, node.operator, node.value, {
    colType: colTypes?.[node.columnId],
    now: ctx?.now,
    userId: ctx?.userId,
    tz: ctx?.tz,
  });
}

// Filtre une liste de lignes selon l'arbre (gère l'élagage en interne).
// `columns` permet la sémantique calendaire des colonnes date/heure.
export function filterRows(
  rows: DbRow[],
  tree: FilterGroup,
  columns?: DbColumn[],
  ctx?: FilterContext,
): DbRow[] {
  const pruned = pruneFilterTree(tree);
  if (!pruned) return rows;
  const colTypes = columns
    ? Object.fromEntries(columns.map((c) => [c.id, c.type]))
    : undefined;
  return rows.filter((row) => evaluateNode(pruned, row, colTypes, ctx));
}

// ─── Tri + filtre combinés ──────────────────────────────────────────────────
// Module pur (sans React) : partagé entre le hook client useDatabaseData et la
// route d'export serveur (application du tri/filtre persisté d'une vue).

export function applySortAndFilter(
  rows: DbRow[],
  columns: DbColumn[],
  sorts: SortConfig[],
  filterTree: FilterGroup,
  ctx?: FilterContext,
): DbRow[] {
  // Filtrage récursif via l'arbre (conditions incomplètes ignorées en interne).
  // Copie défensive : le tri ci-dessous mute en place et filterRows peut
  // renvoyer le tableau source tel quel (cas sans filtre actif).
  const result = [...filterRows(rows, filterTree, columns, ctx)];

  // Apply multi-sort : the first entry has the highest priority,
  // ties are broken by the next entries in order.
  const activeSorts = sorts
    .map((s) => ({ sort: s, col: columns.find((c) => c.id === s.columnId) }))
    .filter((x): x is { sort: SortConfig; col: DbColumn } => !!x.col);

  if (activeSorts.length > 0) {
    result.sort((a, b) => {
      for (const { sort, col } of activeSorts) {
        const va = a.cells?.[sort.columnId] ?? "";
        const vb = b.cells?.[sort.columnId] ?? "";
        let cmp = 0;
        if (col.type === "number") {
          cmp = (Number(va) || 0) - (Number(vb) || 0);
        } else if (col.type === "checkbox") {
          cmp = (va ? 1 : 0) - (vb ? 1 : 0);
        } else {
          cmp = String(va).localeCompare(String(vb), "fr");
        }
        if (cmp !== 0) return sort.direction === "desc" ? -cmp : cmp;
      }
      return 0;
    });
  }

  return result;
}

// Nombre de conditions actives (feuilles non élaguées) — pour le badge du bouton.
export function countActiveConditions(node: FilterNode): number {
  const pruned = pruneFilterTree(node);
  if (!pruned) return 0;
  return countLeaves(pruned);
}

function countLeaves(node: FilterNode): number {
  if (isFilterGroup(node)) {
    return node.children.reduce((sum, c) => sum + countLeaves(c), 0);
  }
  return 1;
}

// ─── Mutations immuables par identifiant ────────────────────────────────────
// Chaque helper renvoie un nouvel arbre ; le nœud ciblé est repéré par son id.

// Applique `fn` au groupe d'id `groupId` (renvoie un nouveau groupe).
function mapGroup(
  node: FilterNode,
  groupId: string,
  fn: (g: FilterGroup) => FilterGroup,
): FilterNode {
  if (!isFilterGroup(node)) return node;
  if (node.id === groupId) return fn(node);
  return {
    ...node,
    children: node.children.map((c) => mapGroup(c, groupId, fn)),
  };
}

export function addCondition(tree: FilterGroup, groupId: string, columns: DbColumn[]): FilterGroup {
  return mapGroup(tree, groupId, (g) => ({
    ...g,
    children: [...g.children, createCondition(columns)],
  })) as FilterGroup;
}

export function addGroup(tree: FilterGroup, groupId: string, columns: DbColumn[]): FilterGroup {
  return mapGroup(tree, groupId, (g) => ({
    ...g,
    children: [...g.children, createGroup(columns)],
  })) as FilterGroup;
}

export function setConjunction(
  tree: FilterGroup,
  groupId: string,
  conjunction: FilterConjunction,
): FilterGroup {
  return mapGroup(tree, groupId, (g) => ({ ...g, conjunction })) as FilterGroup;
}

// Met à jour une condition (par id) où qu'elle soit dans l'arbre.
export function updateCondition(
  tree: FilterGroup,
  conditionId: string,
  patch: Partial<Omit<FilterCondition, "id">>,
): FilterGroup {
  const walk = (node: FilterNode): FilterNode => {
    if (isFilterGroup(node)) return { ...node, children: node.children.map(walk) };
    if (node.id !== conditionId) return node;
    return { ...node, ...patch };
  };
  return walk(tree) as FilterGroup;
}

// Supprime un nœud (condition ou groupe) par id, en nettoyant les groupes vidés
// — sauf la racine, toujours conservée.
export function removeNode(tree: FilterGroup, nodeId: string): FilterGroup {
  const walk = (group: FilterGroup): FilterGroup => ({
    ...group,
    children: group.children
      .filter((c) => c.id !== nodeId)
      .map((c) => (isFilterGroup(c) ? walk(c) : c)),
  });
  return walk(tree);
}
