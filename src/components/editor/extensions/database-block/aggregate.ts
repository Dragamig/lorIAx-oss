import type { CellValue, DbColumn, DbRow, FilterNode } from "./types";
import { filterRows, normalizeFilterTree, type FilterContext } from "./filter-tree";
import { evaluateFormula } from "./formula-evaluator";
import type { AggregateSpec, GroupBySpec } from "@/lib/dashboards/types";

export interface GroupBucket { label: string; value: number; }
interface AggOpts { now?: Date; filterContext?: FilterContext; }

function cellValue(row: DbRow, column: DbColumn, columns: DbColumn[], now?: Date): CellValue {
  if (column.type === "formula") {
    // Les formules sont stockées au format prop("Nom"), évaluées tel quel
    // comme dans database-table-view.tsx (passage explicite de `now` en plus).
    return evaluateFormula(String(column.config?.formula ?? ""), row, columns, { now });
  }
  return row.cells?.[column.id] ?? null;
}

function isFilled(v: CellValue): boolean {
  return !(v == null || v === "" || (Array.isArray(v) && v.length === 0));
}

function toNumber(v: CellValue): number | null {
  if (!isFilled(v) || Array.isArray(v)) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function applyFilter(
  rows: DbRow[],
  columns: DbColumn[],
  filter: FilterNode | null,
  ctx?: FilterContext,
): DbRow[] {
  if (!filter) return rows;
  const tree = normalizeFilterTree(filter);
  return filterRows(rows, tree, columns, ctx);
}

function reduceAgg(rows: DbRow[], columns: DbColumn[], spec: AggregateSpec, now?: Date): number {
  if (spec.fn === "count") return rows.length;
  const col = columns.find((c) => c.id === spec.columnId);
  if (!col) return 0;
  const values = rows.map((r) => cellValue(r, col, columns, now));
  if (spec.fn === "filled_pct") {
    if (rows.length === 0) return 0;
    return (values.filter(isFilled).length / rows.length) * 100;
  }
  if (spec.fn === "unique") {
    const set = new Set(values.filter(isFilled).map((v) => (Array.isArray(v) ? v.join(",") : String(v))));
    return set.size;
  }
  const nums = values.map(toNumber).filter((n): n is number => n !== null);
  if (nums.length === 0) return 0;
  switch (spec.fn) {
    case "sum": return nums.reduce((a, b) => a + b, 0);
    case "avg": return nums.reduce((a, b) => a + b, 0) / nums.length;
    case "min": return Math.min(...nums);
    case "max": return Math.max(...nums);
    default: return 0;
  }
}

export function computeKpi(
  rows: DbRow[],
  columns: DbColumn[],
  filter: FilterNode | null,
  aggregate: AggregateSpec,
  opts?: AggOpts,
): number {
  const filtered = applyFilter(rows, columns, filter, { now: opts?.now, ...opts?.filterContext });
  return reduceAgg(filtered, columns, aggregate, opts?.now);
}

export function computeGrouped(
  rows: DbRow[],
  columns: DbColumn[],
  filter: FilterNode | null,
  groupBy: GroupBySpec,
  aggregate: AggregateSpec,
  opts?: AggOpts,
): GroupBucket[] {
  const filtered = applyFilter(rows, columns, filter, { now: opts?.now, ...opts?.filterContext });
  const col = columns.find((c) => c.id === groupBy.columnId);
  if (!col) return [];
  const buckets = new Map<string, DbRow[]>();
  for (const row of filtered) {
    const v = cellValue(row, col, columns, opts?.now);
    const keys = Array.isArray(v)
      ? (v.length ? v.map(String) : ["(vide)"])
      : [isFilled(v) ? String(v) : "(vide)"];
    for (const k of keys) {
      const arr = buckets.get(k);
      if (arr) arr.push(row); else buckets.set(k, [row]);
    }
  }
  return [...buckets.entries()].map(([label, bucketRows]) => ({
    label,
    value: reduceAgg(bucketRows, columns, aggregate, opts?.now),
  }));
}
