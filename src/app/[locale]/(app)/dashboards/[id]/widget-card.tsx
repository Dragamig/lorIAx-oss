"use client";

import type { ReactNode } from "react";
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
import { ArrowLeft, ArrowRight, Pencil, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Hint } from "@/components/ui/hint";
import type { DashboardWidgetDef, WidgetResult } from "@/lib/dashboards/types";

/** Actions d'édition d'un widget ; `null` pour un lecteur (aucun bouton). */
export interface WidgetCardActions {
  onEdit: () => void;
  onDelete: () => void;
  /** Absent pour le premier widget. */
  onMoveBefore?: () => void;
  /** Absent pour le dernier widget. */
  onMoveAfter?: () => void;
}

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
  actions,
}: {
  widget: DashboardWidgetDef;
  result: WidgetResult | undefined;
  actions: WidgetCardActions | null;
}) {
  const t = useTranslations("dashboards");
  const format = useFormatter();

  return (
    <div
      className={`border rounded-lg p-4 ${widget.size === "full" ? "col-span-2" : "col-span-1"}`}
    >
      <div className="flex items-center justify-between mb-3">
        <span className="font-medium text-sm truncate">{widget.title}</span>
        {actions ? (
          <span className="flex items-center gap-0.5">
            <WidgetAction label={t("widget.moveBefore")} onClick={actions.onMoveBefore}>
              <ArrowLeft aria-hidden="true" />
            </WidgetAction>
            <WidgetAction label={t("widget.moveAfter")} onClick={actions.onMoveAfter}>
              <ArrowRight aria-hidden="true" />
            </WidgetAction>
            <WidgetAction label={t("widget.edit")} onClick={actions.onEdit}>
              <Pencil aria-hidden="true" />
            </WidgetAction>
            <WidgetAction label={t("widget.delete")} onClick={actions.onDelete} destructive>
              <Trash2 aria-hidden="true" />
            </WidgetAction>
          </span>
        ) : null}
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

function WidgetAction({
  label,
  onClick,
  destructive,
  children,
}: {
  label: string;
  onClick?: () => void;
  destructive?: boolean;
  children: ReactNode;
}) {
  return (
    <Hint label={label} disabled={!onClick}>
      <Button
        type="button"
        variant="ghost"
        size="icon-sm"
        aria-label={label}
        disabled={!onClick}
        onClick={onClick}
        className={destructive ? "hover:text-destructive" : undefined}
      >
        {children}
      </Button>
    </Hint>
  );
}
