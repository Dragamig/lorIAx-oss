// Logique pure de la sélection de lignes et du réordonnancement des bases.

export interface ReorderOp {
  rowIds: string[];
  /** Les lignes sont insérées avant cette ligne ; null = en fin de liste. */
  beforeRowId: string | null;
}

/** Identifiants entre l'ancre et la cible (bornes incluses), dans l'ordre affiché. */
export function rangeBetween(orderedIds: string[], anchorId: string | null, targetId: string): string[] {
  const t = orderedIds.indexOf(targetId);
  if (t < 0) return [];
  let a = anchorId == null ? t : orderedIds.indexOf(anchorId);
  if (a < 0) a = t;
  const lo = Math.min(a, t);
  const hi = Math.max(a, t);
  return orderedIds.slice(lo, hi + 1);
}

/** Ne garde de la sélection que les lignes encore visibles. Renvoie le même Set s'il n'y a rien à retirer. */
export function pruneSelection(selected: Set<string>, visibleIds: string[]): Set<string> {
  if (selected.size === 0) return selected;
  const visible = new Set(visibleIds);
  let changed = false;
  const next = new Set<string>();
  for (const id of selected) {
    if (visible.has(id)) next.add(id);
    else changed = true;
  }
  return changed ? next : selected;
}

export type HeaderCheckState = "none" | "some" | "all";

export function headerCheckState(selectedCount: number, total: number): HeaderCheckState {
  if (total === 0 || selectedCount === 0) return "none";
  return selectedCount >= total ? "all" : "some";
}

/** Lignes déplacées lors d'un glisser : tout le lot si la ligne saisie est sélectionnée, sinon elle seule. */
export function movingIdsFor(grabbedId: string, selected: Set<string>, orderedIds: string[]): string[] {
  if (selected.has(grabbedId) && selected.size > 1) return orderedIds.filter((id) => selected.has(id));
  return [grabbedId];
}

/**
 * Applique localement un déplacement : les lignes déplacées gardent leur ordre
 * relatif et sont insérées avant `beforeRowId` (ou en fin de liste).
 */
export function applyReorder<T extends { id: string }>(rows: T[], rowIds: string[], beforeRowId: string | null): T[] {
  const moving = new Set(rowIds);
  const moved = rows.filter((r) => moving.has(r.id));
  if (moved.length === 0) return rows;
  const rest = rows.filter((r) => !moving.has(r.id));
  let idx = beforeRowId == null ? rest.length : rest.findIndex((r) => r.id === beforeRowId);
  if (idx < 0) idx = rest.length;
  return [...rest.slice(0, idx), ...moved, ...rest.slice(idx)];
}

export function sameOrder(a: { id: string }[], b: { id: string }[]): boolean {
  return a.length === b.length && a.every((r, i) => r.id === b[i].id);
}

/**
 * Cible d'un dépôt : insérer avant `targetId` (before) ou après lui.
 * Renvoie null si la cible fait partie des lignes déplacées.
 */
export function dropBeforeId(
  orderedIds: string[],
  movingIds: string[],
  targetId: string,
  before: boolean,
): string | null | undefined {
  const moving = new Set(movingIds);
  if (moving.has(targetId)) return undefined;
  if (before) return targetId;
  const i = orderedIds.indexOf(targetId);
  for (let j = i + 1; j < orderedIds.length; j++) {
    if (!moving.has(orderedIds[j])) return orderedIds[j];
  }
  return null;
}

/**
 * Déplacement d'un cran (Alt+flèche). Le lot devient contigu, placé avant la
 * ligne non déplacée qui précède (haut) ou après celle qui suit (bas).
 * Renvoie null si le lot est déjà à la limite.
 */
export function stepReorder(orderedIds: string[], movingIds: string[], dir: -1 | 1): ReorderOp | null {
  const moving = new Set(movingIds);
  const idxs = orderedIds.map((id, i) => (moving.has(id) ? i : -1)).filter((i) => i >= 0);
  if (idxs.length === 0) return null;
  const ids = idxs.map((i) => orderedIds[i]);
  if (dir < 0) {
    for (let i = idxs[0] - 1; i >= 0; i--) {
      if (!moving.has(orderedIds[i])) return { rowIds: ids, beforeRowId: orderedIds[i] };
    }
    return null;
  }
  for (let i = idxs[idxs.length - 1] + 1; i < orderedIds.length; i++) {
    if (!moving.has(orderedIds[i])) {
      for (let j = i + 1; j < orderedIds.length; j++) {
        if (!moving.has(orderedIds[j])) return { rowIds: ids, beforeRowId: orderedIds[j] };
      }
      return { rowIds: ids, beforeRowId: null };
    }
  }
  return null;
}

/**
 * Opérations qui restituent l'ordre `before` après un déplacement de `movingIds`.
 * Une opération par séquence contiguë de lignes déplacées, à appliquer dans l'ordre.
 */
export function invertReorder(before: string[], movingIds: string[]): ReorderOp[] {
  const moving = new Set(movingIds);
  const ops: ReorderOp[] = [];
  let i = 0;
  while (i < before.length) {
    if (!moving.has(before[i])) {
      i++;
      continue;
    }
    const run: string[] = [];
    while (i < before.length && moving.has(before[i])) run.push(before[i++]);
    ops.push({ rowIds: run, beforeRowId: i < before.length ? before[i] : null });
  }
  return ops;
}

/** Réinsère des lignes retirées dans `rows` à leur place d'origine (`originalIds`), sans toucher aux autres écritures. */
export function reinsertRows<T extends { id: string }>(rows: T[], removed: T[], originalIds: string[]): T[] {
  const present = new Set(rows.map((r) => r.id));
  const missing = removed.filter((r) => !present.has(r.id));
  if (missing.length === 0) return rows;
  const rank = new Map(originalIds.map((id, i) => [id, i]));
  const missingSet = new Set(missing.map((r) => r.id));
  const out: T[] = [];
  const pending = [...missing].sort((a, b) => (rank.get(a.id) ?? 0) - (rank.get(b.id) ?? 0));
  for (const r of rows) {
    const rk = rank.get(r.id) ?? Number.MAX_SAFE_INTEGER;
    while (pending.length && (rank.get(pending[0].id) ?? 0) < rk) out.push(pending.shift()!);
    out.push(r);
  }
  out.push(...pending.filter((p) => missingSet.has(p.id)));
  return out;
}

/** Rétablit l'ordre relatif `beforeIds` des seules lignes `movingIds` dans `rows` (delta, pas un snapshot global). */
export function revertMove<T extends { id: string }>(rows: T[], beforeIds: string[], movingIds: string[]): T[] {
  return invertReorder(beforeIds, movingIds).reduce((acc, op) => applyReorder(acc, op.rowIds, op.beforeRowId), rows);
}

/** Cibles minimales pour décider si un événement clavier concerne la grille (testable sans DOM). */
export interface KeyTargetLike {
  isContentEditable?: boolean;
  closest(selector: string): unknown;
}

const PORTAL_SELECTOR = '[role="dialog"], [role="listbox"], [role="menu"], [role="combobox"]';
const EDITABLE_SELECTOR = 'input:not([type="checkbox"]), textarea, select, [contenteditable="true"]';

/** Vrai si le raccourci doit être ignoré (portail, éditeur, cible hors du conteneur). */
export function shouldIgnoreGridKey(container: { contains(n: unknown): boolean }, target: KeyTargetLike): boolean {
  if (!container.contains(target)) return true;
  if (target.isContentEditable) return true;
  if (target.closest(EDITABLE_SELECTOR)) return true;
  if (target.closest(PORTAL_SELECTOR)) return true;
  return false;
}
