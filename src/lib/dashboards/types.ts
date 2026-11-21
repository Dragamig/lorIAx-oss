import type { FilterNode } from "@/components/editor/extensions/database-block/types";

export type WidgetType = "kpi" | "bar" | "pie";
export type WidgetSize = "full" | "half";

export type AggregateFn =
  | "count" | "sum" | "avg" | "min" | "max" | "filled_pct" | "unique";

export interface AggregateSpec {
  fn: AggregateFn;
  /** requis pour tout sauf `count` */
  columnId?: string;
}

export interface GroupBySpec {
  columnId: string;
}

export interface WidgetConfig {
  filter: FilterNode | null;
  aggregate: AggregateSpec;
  /** requis pour bar/pie, absent pour kpi */
  groupBy?: GroupBySpec;
}

export interface DashboardWidgetDef {
  id: string;
  dashboardId: string;
  databaseId: string;
  type: WidgetType;
  title: string;
  position: number;
  size: WidgetSize;
  config: WidgetConfig;
}

export interface DashboardDef {
  id: string;
  spaceId: string;
  name: string;
  description: string | null;
}

export type WidgetResult =
  | { kind: "kpi"; value: number }
  | { kind: "grouped"; buckets: { label: string; value: number }[] }
  | { error: string };
