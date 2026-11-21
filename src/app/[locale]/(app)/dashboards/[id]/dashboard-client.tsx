"use client";

import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { WidgetCard } from "./widget-card";
import { WidgetConfigPanel, type WidgetDraft } from "./widget-config-panel";
import type {
  DashboardDef,
  DashboardWidgetDef,
  WidgetResult,
} from "@/lib/dashboards/types";

const EMPTY_DRAFT: WidgetDraft = {
  databaseId: "",
  type: "kpi",
  title: "",
  size: "half",
  config: { filter: null, aggregate: { fn: "count" } },
};

export function DashboardClient({
  dashboard,
  initialWidgets,
  bases,
}: {
  dashboard: DashboardDef;
  initialWidgets: DashboardWidgetDef[];
  bases: { id: string; name: string }[];
}) {
  const t = useTranslations("dashboards");
  const [widgets, setWidgets] = useState(initialWidgets);
  const [results, setResults] = useState<Record<string, WidgetResult>>({});
  const [draft, setDraft] = useState<WidgetDraft | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const res = await fetch(`/api/dashboards/${dashboard.id}/data`);
      if (!cancelled && res.ok) setResults(await res.json());
    })();
    return () => {
      cancelled = true;
    };
  }, [dashboard.id, widgets]);

  async function refreshWidgets() {
    const res = await fetch(`/api/dashboards/${dashboard.id}`);
    if (res.ok) {
      const d = await res.json();
      setWidgets(d.widgets);
    }
  }

  async function save() {
    if (!draft) return;
    const url = editingId
      ? `/api/dashboards/${dashboard.id}/widgets/${editingId}`
      : `/api/dashboards/${dashboard.id}/widgets`;
    const res = await fetch(url, {
      method: editingId ? "PATCH" : "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(draft),
    });
    if (res.ok) {
      setDraft(null);
      setEditingId(null);
      await refreshWidgets();
    }
  }

  async function remove(id: string) {
    const res = await fetch(
      `/api/dashboards/${dashboard.id}/widgets/${id}`,
      { method: "DELETE" }
    );
    if (res.ok) await refreshWidgets();
  }

  return (
    <div className="p-6 max-w-5xl mx-auto">
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-xl font-semibold">{dashboard.name}</h1>
        {!draft && (
          <Button
            onClick={() => {
              setEditingId(null);
              setDraft({ ...EMPTY_DRAFT });
            }}
          >
            {t("addWidget")}
          </Button>
        )}
      </div>
      {draft && (
        <div className="mb-6">
          <WidgetConfigPanel
            bases={bases}
            draft={draft}
            onChange={setDraft}
            onSave={save}
            onCancel={() => {
              setDraft(null);
              setEditingId(null);
            }}
          />
        </div>
      )}
      {widgets.length === 0 && !draft ? (
        <p className="text-sm text-neutral-500">{t("noWidget")}</p>
      ) : (
        <div className="grid grid-cols-2 gap-4">
          {widgets.map((w) => (
            <WidgetCard
              key={w.id}
              widget={w}
              result={results[w.id]}
              onEdit={() => {
                setEditingId(w.id);
                setDraft({
                  databaseId: w.databaseId,
                  type: w.type,
                  title: w.title,
                  size: w.size,
                  config: w.config,
                });
              }}
              onDelete={() => remove(w.id)}
            />
          ))}
        </div>
      )}
    </div>
  );
}
