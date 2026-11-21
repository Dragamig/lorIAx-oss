"use client";

import { useMemo, useState } from "react";
import {
  BarChart,
  Bar,
  PieChart,
  Pie,
  Cell,
  LineChart,
  Line,
  XAxis,
  YAxis,
  Tooltip,
  Legend,
  ResponsiveContainer,
} from "recharts";
import { Plus, BarChart3, Hash, Clock } from "lucide-react";

// ─── Types ───────────────────────────────────────────────────────────────────

export type WidgetType = "metric" | "chart" | "recent_rows";
export type MetricAgg = "count" | "sum" | "avg" | "min" | "max";
export type ChartKind = "bar" | "line" | "pie";

export interface MetricWidget {
  type: "metric";
  id: string;
  title: string;
  columnId?: string;
  agg: MetricAgg;
}
export interface ChartWidget {
  type: "chart";
  id: string;
  title: string;
  kind: ChartKind;
  groupByColumnId: string;
  valueColumnId?: string;
  valueAgg: MetricAgg;
}
export interface RecentRowsWidget {
  type: "recent_rows";
  id: string;
  title: string;
  limit: number;
}

export type Widget = MetricWidget | ChartWidget | RecentRowsWidget;

interface ColumnLike {
  id: string;
  name: string;
  type: string;
}
interface RowLike {
  id: string;
  cells: Record<string, unknown>;
  updatedAt: string;
}

interface DashboardViewProps {
  widgets: Widget[];
  columns: ColumnLike[];
  rows: RowLike[];
  readOnly?: boolean;
  onChange?: (widgets: Widget[]) => void;
}

const COLORS = ["#3b82f6", "#10b981", "#f59e0b", "#ef4444", "#8b5cf6", "#ec4899", "#14b8a6", "#f97316"];

// ─── Agrégateurs ─────────────────────────────────────────────────────────────

export function computeMetric(
  rows: RowLike[],
  columnId: string | undefined,
  agg: MetricAgg
): number {
  if (agg === "count") return rows.length;
  if (!columnId) return 0;
  const values = rows
    .map((r) => r.cells[columnId])
    .filter((v): v is number | string =>
      v !== null && v !== undefined && (typeof v === "number" || (typeof v === "string" && v !== ""))
    )
    .map((v) => (typeof v === "number" ? v : parseFloat(v)))
    .filter((n) => Number.isFinite(n));
  if (values.length === 0) return 0;
  switch (agg) {
    case "sum":
      return values.reduce((a, b) => a + b, 0);
    case "avg":
      return values.reduce((a, b) => a + b, 0) / values.length;
    case "min":
      return Math.min(...values);
    case "max":
      return Math.max(...values);
  }
}

export function computeChartData(
  rows: RowLike[],
  groupByColumnId: string,
  valueColumnId: string | undefined,
  valueAgg: MetricAgg
): { label: string; value: number }[] {
  const groups = new Map<string, RowLike[]>();
  for (const r of rows) {
    const key = r.cells[groupByColumnId];
    const label =
      key == null
        ? "—"
        : Array.isArray(key)
          ? key.map(String).join(", ")
          : String(key);
    if (!groups.has(label)) groups.set(label, []);
    groups.get(label)!.push(r);
  }
  return Array.from(groups.entries()).map(([label, gs]) => ({
    label,
    value: computeMetric(gs, valueColumnId, valueAgg),
  }));
}

// ─── Composant principal ─────────────────────────────────────────────────────

export function DashboardView({
  widgets,
  columns,
  rows,
  readOnly = false,
  onChange,
}: DashboardViewProps) {
  const [draft, setDraft] = useState<Widget[]>(widgets);
  const numericColumns = useMemo(
    () => columns.filter((c) => ["number", "formula"].includes(c.type)),
    [columns]
  );
  const groupableColumns = useMemo(
    () => columns.filter((c) => ["select", "checkbox", "text"].includes(c.type)),
    [columns]
  );

  function addWidget(type: WidgetType) {
    let w: Widget;
    if (type === "metric") {
      w = {
        type: "metric",
        id: crypto.randomUUID(),
        title: "Nombre de lignes",
        agg: "count",
      };
    } else if (type === "chart") {
      w = {
        type: "chart",
        id: crypto.randomUUID(),
        title: "Répartition",
        kind: "bar",
        groupByColumnId: groupableColumns[0]?.id ?? "",
        valueColumnId: undefined,
        valueAgg: "count",
      };
    } else {
      w = { type: "recent_rows", id: crypto.randomUUID(), title: "Lignes récentes", limit: 5 };
    }
    const next = [...draft, w];
    setDraft(next);
    onChange?.(next);
  }

  function removeWidget(id: string) {
    const next = draft.filter((w) => w.id !== id);
    setDraft(next);
    onChange?.(next);
  }

  return (
    <div className="space-y-4">
      {!readOnly && (
        <div className="flex items-center gap-2 text-xs">
          <span className="text-neutral-500">Ajouter un widget :</span>
          <button onClick={() => addWidget("metric")} className="rounded border px-2 py-1 hover:bg-neutral-100 dark:hover:bg-neutral-800">
            <Hash className="mr-1 inline h-3 w-3" /> Indicateur
          </button>
          <button onClick={() => addWidget("chart")} className="rounded border px-2 py-1 hover:bg-neutral-100 dark:hover:bg-neutral-800">
            <BarChart3 className="mr-1 inline h-3 w-3" /> Graphique
          </button>
          <button onClick={() => addWidget("recent_rows")} className="rounded border px-2 py-1 hover:bg-neutral-100 dark:hover:bg-neutral-800">
            <Clock className="mr-1 inline h-3 w-3" /> Lignes récentes
          </button>
        </div>
      )}

      {draft.length === 0 ? (
        <div className="rounded border border-dashed border-neutral-300 p-8 text-center text-sm text-neutral-500 dark:border-neutral-700">
          Aucun widget — ajoutez-en depuis le menu ci-dessus.
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
          {draft.map((w) => (
            <div
              key={w.id}
              className="relative rounded border border-neutral-200 bg-white p-4 dark:border-neutral-800 dark:bg-neutral-950"
            >
              {!readOnly && (
                <button
                  onClick={() => removeWidget(w.id)}
                  className="absolute right-2 top-2 rounded p-1 text-neutral-400 hover:bg-red-50 hover:text-red-600"
                  title="Supprimer"
                >
                  <Plus className="h-3 w-3 rotate-45" />
                </button>
              )}
              <h3 className="mb-2 text-sm font-medium text-neutral-700 dark:text-neutral-300">
                {w.title}
              </h3>
              {w.type === "metric" && (
                <MetricRenderer widget={w} rows={rows} numericColumns={numericColumns} readOnly={readOnly} onPatch={(next) => {
                  const arr = draft.map((x) => (x.id === w.id ? next : x));
                  setDraft(arr);
                  onChange?.(arr);
                }} />
              )}
              {w.type === "chart" && (
                <ChartRenderer widget={w} rows={rows} columns={columns} groupableColumns={groupableColumns} numericColumns={numericColumns} readOnly={readOnly} onPatch={(next) => {
                  const arr = draft.map((x) => (x.id === w.id ? next : x));
                  setDraft(arr);
                  onChange?.(arr);
                }} />
              )}
              {w.type === "recent_rows" && (
                <RecentRowsRenderer widget={w} rows={rows} columns={columns} />
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ─── Renderers ───────────────────────────────────────────────────────────────

function MetricRenderer({
  widget,
  rows,
  numericColumns,
  readOnly,
  onPatch,
}: {
  widget: MetricWidget;
  rows: RowLike[];
  numericColumns: ColumnLike[];
  readOnly: boolean;
  onPatch: (w: MetricWidget) => void;
}) {
  const value = computeMetric(rows, widget.columnId, widget.agg);
  return (
    <div>
      <div className="text-3xl font-bold tabular-nums">
        {Number.isInteger(value) ? value : value.toFixed(2)}
      </div>
      {!readOnly && (
        <div className="mt-2 flex gap-1 text-[10px]">
          <select
            value={widget.agg}
            onChange={(e) => onPatch({ ...widget, agg: e.target.value as MetricAgg })}
            className="rounded border bg-transparent px-1 py-0.5"
          >
            <option value="count">count</option>
            <option value="sum">sum</option>
            <option value="avg">avg</option>
            <option value="min">min</option>
            <option value="max">max</option>
          </select>
          {widget.agg !== "count" && (
            <select
              value={widget.columnId ?? ""}
              onChange={(e) => onPatch({ ...widget, columnId: e.target.value || undefined })}
              className="rounded border bg-transparent px-1 py-0.5"
            >
              <option value="">— colonne —</option>
              {numericColumns.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          )}
        </div>
      )}
    </div>
  );
}

function ChartRenderer({
  widget,
  rows,
  columns,
  groupableColumns,
  numericColumns,
  readOnly,
  onPatch,
}: {
  widget: ChartWidget;
  rows: RowLike[];
  columns: ColumnLike[];
  groupableColumns: ColumnLike[];
  numericColumns: ColumnLike[];
  readOnly: boolean;
  onPatch: (w: ChartWidget) => void;
}) {
  const data = useMemo(
    () => computeChartData(rows, widget.groupByColumnId, widget.valueColumnId, widget.valueAgg),
    [rows, widget.groupByColumnId, widget.valueColumnId, widget.valueAgg]
  );

  const hasGroup = !!columns.find((c) => c.id === widget.groupByColumnId);

  return (
    <div>
      <div className="h-48">
        {!hasGroup || data.length === 0 ? (
          <div className="flex h-full items-center justify-center text-xs text-neutral-400">
            Pas de données à afficher
          </div>
        ) : widget.kind === "pie" ? (
          <ResponsiveContainer width="100%" height="100%">
            <PieChart>
              <Pie data={data} dataKey="value" nameKey="label" outerRadius={70}>
                {data.map((_, i) => (
                  <Cell key={i} fill={COLORS[i % COLORS.length]} />
                ))}
              </Pie>
              <Tooltip />
              <Legend wrapperStyle={{ fontSize: 10 }} />
            </PieChart>
          </ResponsiveContainer>
        ) : widget.kind === "line" ? (
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={data}>
              <XAxis dataKey="label" tick={{ fontSize: 10 }} />
              <YAxis tick={{ fontSize: 10 }} />
              <Tooltip />
              <Line type="monotone" dataKey="value" stroke="#3b82f6" />
            </LineChart>
          </ResponsiveContainer>
        ) : (
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={data}>
              <XAxis dataKey="label" tick={{ fontSize: 10 }} />
              <YAxis tick={{ fontSize: 10 }} />
              <Tooltip />
              <Bar dataKey="value" fill="#3b82f6" />
            </BarChart>
          </ResponsiveContainer>
        )}
      </div>
      {!readOnly && (
        <div className="mt-2 flex flex-wrap gap-1 text-[10px]">
          <select
            value={widget.kind}
            onChange={(e) => onPatch({ ...widget, kind: e.target.value as ChartKind })}
            className="rounded border bg-transparent px-1 py-0.5"
          >
            <option value="bar">bar</option>
            <option value="line">line</option>
            <option value="pie">pie</option>
          </select>
          <select
            value={widget.groupByColumnId}
            onChange={(e) => onPatch({ ...widget, groupByColumnId: e.target.value })}
            className="rounded border bg-transparent px-1 py-0.5"
          >
            <option value="">— groupé par —</option>
            {groupableColumns.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
          <select
            value={widget.valueAgg}
            onChange={(e) => onPatch({ ...widget, valueAgg: e.target.value as MetricAgg })}
            className="rounded border bg-transparent px-1 py-0.5"
          >
            <option value="count">count</option>
            <option value="sum">sum</option>
            <option value="avg">avg</option>
          </select>
          {widget.valueAgg !== "count" && (
            <select
              value={widget.valueColumnId ?? ""}
              onChange={(e) => onPatch({ ...widget, valueColumnId: e.target.value || undefined })}
              className="rounded border bg-transparent px-1 py-0.5"
            >
              <option value="">— colonne valeur —</option>
              {numericColumns.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          )}
        </div>
      )}
    </div>
  );
}

function RecentRowsRenderer({
  widget,
  rows,
  columns,
}: {
  widget: RecentRowsWidget;
  rows: RowLike[];
  columns: ColumnLike[];
}) {
  const recent = useMemo(
    () =>
      [...rows]
        .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
        .slice(0, widget.limit),
    [rows, widget.limit]
  );
  const firstTextCol = columns.find((c) => c.type === "text") ?? columns[0];

  if (recent.length === 0) {
    return <p className="text-xs text-neutral-500">Aucune ligne.</p>;
  }
  return (
    <ul className="space-y-1 text-xs">
      {recent.map((r) => {
        const label = firstTextCol ? String(r.cells[firstTextCol.id] ?? "(sans titre)") : "(ligne)";
        return (
          <li key={r.id} className="flex items-center justify-between gap-2">
            <span className="truncate">{label}</span>
            <span className="text-neutral-400">{new Date(r.updatedAt).toLocaleDateString("fr-FR")}</span>
          </li>
        );
      })}
    </ul>
  );
}
