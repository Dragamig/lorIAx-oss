"use client";

import { useTranslations, useFormatter } from "next-intl";
import {
  BarChart,
  Bar,
  PieChart,
  Pie,
  Cell,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
} from "recharts";
import type { DashboardWidgetDef, WidgetResult } from "@/lib/dashboards/types";

const COLORS = [
  "#6366f1",
  "#22c55e",
  "#f59e0b",
  "#ef4444",
  "#06b6d4",
  "#a855f7",
  "#84cc16",
];

export function WidgetCard({
  widget,
  result,
  onEdit,
  onDelete,
}: {
  widget: DashboardWidgetDef;
  result: WidgetResult | undefined;
  onEdit: () => void;
  onDelete: () => void;
}) {
  const t = useTranslations("dashboards");
  const format = useFormatter();

  return (
    <div
      className={`border rounded-lg p-4 ${widget.size === "full" ? "col-span-2" : "col-span-1"}`}
    >
      <div className="flex items-center justify-between mb-3">
        <span className="font-medium text-sm">{widget.title}</span>
        <span className="flex gap-2 text-xs text-neutral-500">
          <button onClick={onEdit} className="hover:text-foreground">
            {t("widget.edit")}
          </button>
          <button onClick={onDelete} className="hover:text-red-500">
            {t("widget.delete")}
          </button>
        </span>
      </div>
      {!result ? (
        <div className="h-32 flex items-center justify-center text-sm text-neutral-400">
          {t("widget.loading")}
        </div>
      ) : "error" in result ? (
        <div className="h-32 flex items-center justify-center text-sm text-amber-600">
          {result.error}
        </div>
      ) : result.kind === "kpi" ? (
        <div className="py-6 text-center">
          <div className="text-4xl font-semibold tabular-nums">
            {Number.isInteger(result.value)
              ? format.number(result.value)
              : format.number(result.value, { maximumFractionDigits: 2 })}
          </div>
        </div>
      ) : result.buckets.length === 0 ? (
        <div className="h-32 flex items-center justify-center text-sm text-neutral-400">
          {t("widget.noData")}
        </div>
      ) : widget.type === "bar" ? (
        <ResponsiveContainer width="100%" height={200}>
          <BarChart data={result.buckets}>
            <XAxis dataKey="label" fontSize={11} />
            <YAxis fontSize={11} />
            <Tooltip />
            <Bar dataKey="value" fill={COLORS[0]} radius={[4, 4, 0, 0]} />
          </BarChart>
        </ResponsiveContainer>
      ) : (
        <ResponsiveContainer width="100%" height={200}>
          <PieChart>
            <Pie
              data={result.buckets}
              dataKey="value"
              nameKey="label"
              outerRadius={80}
              label
            >
              {result.buckets.map((_, i) => (
                <Cell key={i} fill={COLORS[i % COLORS.length]} />
              ))}
            </Pie>
            <Tooltip />
          </PieChart>
        </ResponsiveContainer>
      )}
    </div>
  );
}
