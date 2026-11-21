import type { GanttEvent, ZoomConfig } from "./types";

export interface FlatEvent {
  event: GanttEvent;
  depth: number;
  hasChildren: boolean;
}

/**
 * Detect cycles in dependency graph (DFS-based).
 * Returns true if adding sourceId → targetId would create a cycle.
 */
export function detectCycle(
  events: GanttEvent[],
  sourceId: string,
  targetId: string,
): boolean {
  const adjacency = new Map<string, string[]>();
  for (const e of events) {
    adjacency.set(e.id, e.dependencies ?? []);
  }
  // Add the proposed edge
  const existing = adjacency.get(sourceId) ?? [];
  adjacency.set(sourceId, [...existing, targetId]);

  const visited = new Set<string>();
  const stack = new Set<string>();

  function dfs(node: string): boolean {
    if (stack.has(node)) return true;
    if (visited.has(node)) return false;
    visited.add(node);
    stack.add(node);
    for (const dep of adjacency.get(node) ?? []) {
      if (dfs(dep)) return true;
    }
    stack.delete(node);
    return false;
  }

  return dfs(sourceId);
}

/**
 * Detect cycles from raw edge pairs (for server-side use without full GanttEvent objects).
 * Returns true if adding sourceId → targetId would create a cycle.
 */
export function detectCycleFromEdges(
  edges: { sourceEventId: string; targetEventId: string }[],
  sourceId: string,
  targetId: string,
): boolean {
  const adjacency = new Map<string, string[]>();
  for (const e of edges) {
    const existing = adjacency.get(e.sourceEventId) ?? [];
    adjacency.set(e.sourceEventId, [...existing, e.targetEventId]);
  }
  const existing = adjacency.get(sourceId) ?? [];
  adjacency.set(sourceId, [...existing, targetId]);

  const visited = new Set<string>();
  const stack = new Set<string>();

  function dfs(node: string): boolean {
    if (stack.has(node)) return true;
    if (visited.has(node)) return false;
    visited.add(node);
    stack.add(node);
    for (const dep of adjacency.get(node) ?? []) {
      if (dfs(dep)) return true;
    }
    stack.delete(node);
    return false;
  }

  return dfs(sourceId);
}

/**
 * Build a tree from flat events using parentEventId.
 */
export function buildEventTree(events: GanttEvent[]): GanttEvent[] {
  const map = new Map<string, GanttEvent>();
  const roots: GanttEvent[] = [];

  for (const e of events) {
    map.set(e.id, { ...e, children: [] });
  }

  for (const e of events) {
    const node = map.get(e.id)!;
    if (e.parentEventId && map.has(e.parentEventId)) {
      map.get(e.parentEventId)!.children!.push(node);
    } else {
      roots.push(node);
    }
  }

  return roots;
}

/**
 * Convert a date to X coordinate in the Gantt SVG.
 */
export function dateToX(date: Date, rangeStart: Date, zoom: ZoomConfig): number {
  const elapsed = date.getTime() - rangeStart.getTime();
  return (elapsed / zoom.step) * zoom.columnWidth;
}

/**
 * Convert an X coordinate back to a date.
 */
export function xToDate(x: number, rangeStart: Date, zoom: ZoomConfig): Date {
  const elapsed = (x / zoom.columnWidth) * zoom.step;
  return new Date(rangeStart.getTime() + elapsed);
}

/**
 * Calculate duration in days between two dates.
 */
export function durationDays(start: Date | string, end: Date | string): number {
  const s = typeof start === "string" ? new Date(start) : start;
  const e = typeof end === "string" ? new Date(end) : end;
  return Math.max(1, Math.ceil((e.getTime() - s.getTime()) / 86400000));
}

/**
 * Calculate critical path using longest-path algorithm.
 * Returns array of event IDs on the critical path.
 */
export function calculateCriticalPath(events: GanttEvent[]): string[] {
  const byId = new Map<string, GanttEvent>();
  for (const e of events) byId.set(e.id, e);

  const endTimes = new Map<string, number>();
  const predecessors = new Map<string, string | null>();
  const visited = new Set<string>();

  function computeEnd(id: string): number {
    if (endTimes.has(id)) return endTimes.get(id)!;
    if (visited.has(id)) return 0; // cycle guard
    visited.add(id);

    const ev = byId.get(id);
    if (!ev) {
      console.warn(`Missing event ${id}`);
      return 0;
    }

    const myEnd = new Date(ev.endAt).getTime();
    const myStart = new Date(ev.startAt).getTime();
    const duration = myEnd - myStart;

    let latestPredEnd = 0;
    let latestPred: string | null = null;

    for (const depId of ev.dependencies ?? []) {
      const depEnd = computeEnd(depId);
      if (depEnd > latestPredEnd) {
        latestPredEnd = depEnd;
        latestPred = depId;
      }
    }

    const effectiveStart = Math.max(myStart, latestPredEnd);
    const effectiveEnd = effectiveStart + duration;
    endTimes.set(id, effectiveEnd);
    predecessors.set(id, latestPred);
    return effectiveEnd;
  }

  for (const e of events) computeEnd(e.id);

  // Find the event with the latest end time
  let maxEnd = 0;
  let maxId: string | null = null;
  for (const [id, end] of endTimes) {
    if (end > maxEnd) {
      maxEnd = end;
      maxId = id;
    }
  }

  // Trace back
  const path: string[] = [];
  let current = maxId;
  while (current) {
    path.unshift(current);
    current = predecessors.get(current) ?? null;
  }

  return path;
}

/**
 * Flatten the tree into a list, respecting collapsed state.
 */
export function flattenTree(
  tree: GanttEvent[],
  collapsed: Set<string>,
  depth = 0,
): FlatEvent[] {
  const result: FlatEvent[] = [];

  for (const node of tree) {
    const hasChildren = (node.children?.length ?? 0) > 0;
    result.push({ event: node, depth, hasChildren });

    if (hasChildren && !collapsed.has(node.id)) {
      result.push(...flattenTree(node.children!, collapsed, depth + 1));
    }
  }

  return result;
}
