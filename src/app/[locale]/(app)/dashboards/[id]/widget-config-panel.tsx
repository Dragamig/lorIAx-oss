"use client";

import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { FilterBuilder } from "@/components/editor/extensions/database-block/filter-builder";
import {
  emptyTree,
  normalizeFilterTree,
} from "@/components/editor/extensions/database-block/filter-tree";
import type { DbColumn, FilterGroup } from "@/components/editor/extensions/database-block/types";
import type {
  AggregateFn,
  WidgetType,
  WidgetConfig,
  WidgetSize,
} from "@/lib/dashboards/types";

export interface WidgetDraft {
  databaseId: string;
  type: WidgetType;
  title: string;
  size: WidgetSize;
  config: WidgetConfig;
}

/** Map API snake_case AggregateFn keys to camelCase translation keys */
function aggToTranslationKey(fn: AggregateFn): string {
  if (fn === "filled_pct") return "filledPct";
  return fn;
}

export function WidgetConfigPanel({
  bases,
  draft,
  onChange,
  onSave,
  onCancel,
}: {
  bases: { id: string; name: string }[];
  draft: WidgetDraft;
  onChange: (d: WidgetDraft) => void;
  onSave: () => void;
  onCancel: () => void;
}) {
  const t = useTranslations("dashboards");
  const [columns, setColumns] = useState<DbColumn[]>([]);
  // Local filter tree state — initialised from draft.config.filter
  const [filterTree, setFilterTree] = useState<FilterGroup>(() =>
    draft.config.filter
      ? normalizeFilterTree(draft.config.filter)
      : emptyTree()
  );

  const AGG_FNS: AggregateFn[] = ["count", "sum", "avg", "min", "max", "filled_pct", "unique"];

  useEffect(() => {
    if (!draft.databaseId) {
      setColumns([]);
      return;
    }
    fetch(`/api/databases/${draft.databaseId}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => setColumns(d?.columns ?? []));
  }, [draft.databaseId]);

  // Reset filter when the source database changes
  useEffect(() => {
    const tree = draft.config.filter
      ? normalizeFilterTree(draft.config.filter)
      : emptyTree();
    setFilterTree(tree);
    // We intentionally depend only on databaseId: a change of base invalidates
    // any filter built against the previous schema.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draft.databaseId]);

  const numericCols = columns.filter(
    (c) => c.type === "number" || c.type === "formula"
  );
  const needsColumn = draft.config.aggregate.fn !== "count";
  const isChart = draft.type === "bar" || draft.type === "pie";

  return (
    <div className="border rounded-lg p-4 space-y-3 bg-muted/30">
      <Input
        value={draft.title}
        onChange={(e) => onChange({ ...draft, title: e.target.value })}
        placeholder={t("widget.titlePlaceholder")}
      />
      <select
        className="w-full border rounded p-2 text-sm"
        value={draft.databaseId}
        onChange={(e) =>
          onChange({
            ...draft,
            databaseId: e.target.value,
            config: { ...draft.config, filter: null },
          })
        }
      >
        <option value="">{t("widget.sourceBase")}</option>
        {bases.map((b) => (
          <option key={b.id} value={b.id}>
            {b.name}
          </option>
        ))}
      </select>
      <select
        className="w-full border rounded p-2 text-sm"
        value={draft.type}
        onChange={(e) =>
          onChange({ ...draft, type: e.target.value as WidgetType })
        }
      >
        <option value="kpi">{t("widget.types.kpi")}</option>
        <option value="bar">{t("widget.types.bar")}</option>
        <option value="pie">{t("widget.types.pie")}</option>
      </select>
      <select
        className="w-full border rounded p-2 text-sm"
        value={draft.config.aggregate.fn}
        onChange={(e) =>
          onChange({
            ...draft,
            config: {
              ...draft.config,
              aggregate: {
                ...draft.config.aggregate,
                fn: e.target.value as AggregateFn,
              },
            },
          })
        }
      >
        {AGG_FNS.map((fn) => (
          <option key={fn} value={fn}>
            {t(`widget.aggregates.${aggToTranslationKey(fn)}` as Parameters<typeof t>[0])}
          </option>
        ))}
      </select>
      {needsColumn && (
        <select
          className="w-full border rounded p-2 text-sm"
          value={draft.config.aggregate.columnId ?? ""}
          onChange={(e) =>
            onChange({
              ...draft,
              config: {
                ...draft.config,
                aggregate: {
                  ...draft.config.aggregate,
                  columnId: e.target.value,
                },
              },
            })
          }
        >
          <option value="">{t("widget.column")}</option>
          {(["sum", "avg", "min", "max"].includes(draft.config.aggregate.fn)
            ? numericCols
            : columns
          ).map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </select>
      )}
      {isChart && (
        <select
          className="w-full border rounded p-2 text-sm"
          value={draft.config.groupBy?.columnId ?? ""}
          onChange={(e) =>
            onChange({
              ...draft,
              config: {
                ...draft.config,
                groupBy: { columnId: e.target.value },
              },
            })
          }
        >
          <option value="">{t("widget.groupBy")}</option>
          {columns.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </select>
      )}
      <select
        className="w-full border rounded p-2 text-sm"
        value={draft.size}
        onChange={(e) =>
          onChange({ ...draft, size: e.target.value as WidgetSize })
        }
      >
        <option value="half">{t("widget.sizes.half")}</option>
        <option value="full">{t("widget.sizes.full")}</option>
      </select>
      {columns.length > 0 && (
        <div>
          <div className="text-xs text-neutral-500 mb-1">
            {t("widget.filterLabel")}
          </div>
          <FilterBuilder
            tree={filterTree}
            setTree={(updater) => {
              const next =
                typeof updater === "function" ? updater(filterTree) : updater;
              setFilterTree(next);
              onChange({ ...draft, config: { ...draft.config, filter: next } });
            }}
            columns={columns}
            excludeOperators={["is_me"]}
            onClear={() => {
              setFilterTree(emptyTree());
              onChange({ ...draft, config: { ...draft.config, filter: null } });
            }}
          />
        </div>
      )}
      <div className="flex gap-2 justify-end">
        <Button variant="ghost" onClick={onCancel}>
          {t("widget.cancel")}
        </Button>
        <Button
          onClick={onSave}
          disabled={
            !draft.databaseId ||
            !draft.title.trim() ||
            (isChart && !draft.config.groupBy?.columnId)
          }
        >
          {t("widget.save")}
        </Button>
      </div>
    </div>
  );
}
