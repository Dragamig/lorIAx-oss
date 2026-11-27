"use client";

import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { ArrowLeft, Pencil, Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Link, useRouter } from "@/i18n/routing";
import { Button } from "@/components/ui/button";
import { Hint } from "@/components/ui/hint";
import { ConfirmTemplateDialog } from "@/components/presentations/templates/confirm-template-dialog";
import { moveItem } from "@/lib/dashboards/widget-order";
import { DashboardRenameField } from "../dashboard-rename-field";
import { dashboardRequest, jsonInit } from "../dashboard-request";
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
  canEdit,
}: {
  dashboard: DashboardDef;
  initialWidgets: DashboardWidgetDef[];
  bases: { id: string; name: string }[];
  /** Droit d'éditeur sur l'espace, calculé côté serveur par le même juge que l'API. */
  canEdit: boolean;
}) {
  const t = useTranslations("dashboards");
  const tt = useTranslations("presentations.templates");
  const router = useRouter();
  const [name, setName] = useState(dashboard.name);
  const [renaming, setRenaming] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [widgets, setWidgets] = useState(initialWidgets);
  const [widgetToDelete, setWidgetToDelete] = useState<DashboardWidgetDef | null>(null);
  const [results, setResults] = useState<Record<string, WidgetResult>>({});
  // Les données ne sont relues qu'après un changement de contenu (ajout,
  // modification, suppression), pas après un simple réordonnancement.
  const [dataVersion, setDataVersion] = useState(0);
  const [draft, setDraft] = useState<WidgetDraft | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const listHref = `/dashboards?spaceId=${encodeURIComponent(dashboard.spaceId)}`;

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const res = await dashboardRequest(`/api/dashboards/${dashboard.id}/data`, undefined, t, "loadData");
      if (!cancelled && res) setResults(await res.json());
    })();
    return () => {
      cancelled = true;
    };
  }, [dashboard.id, dataVersion, t]);

  async function refreshWidgets() {
    const res = await dashboardRequest(`/api/dashboards/${dashboard.id}`, undefined, t, "loadWidgets");
    if (res) {
      const d = await res.json();
      setWidgets(d.widgets);
      setDataVersion((v) => v + 1);
    }
  }

  async function rename(next: string): Promise<boolean> {
    const res = await dashboardRequest(`/api/dashboards/${dashboard.id}`, jsonInit("PATCH", { name: next }), t, "rename");
    if (!res) return false;
    setName(next);
    toast.success(t("renamed"));
    router.refresh();
    return true;
  }

  async function removeDashboard(): Promise<boolean> {
    const res = await dashboardRequest(`/api/dashboards/${dashboard.id}`, { method: "DELETE" }, t, "delete");
    if (!res) return false;
    toast.success(t("deleted", { name }));
    router.push(listHref);
    return true;
  }

  async function save() {
    if (!draft) return;
    const url = editingId
      ? `/api/dashboards/${dashboard.id}/widgets/${editingId}`
      : `/api/dashboards/${dashboard.id}/widgets`;
    const res = await dashboardRequest(url, jsonInit(editingId ? "PATCH" : "POST", draft), t, "saveWidget");
    if (res) {
      setDraft(null);
      setEditingId(null);
      await refreshWidgets();
    }
  }

  async function removeWidget(widget: DashboardWidgetDef): Promise<boolean> {
    const res = await dashboardRequest(
      `/api/dashboards/${dashboard.id}/widgets/${widget.id}`,
      { method: "DELETE" },
      t,
      "deleteWidget"
    );
    if (!res) return false;
    toast.success(t("widget.deleted", { title: widget.title }));
    await refreshWidgets();
    return true;
  }

  async function move(index: number, delta: number) {
    const next = moveItem(widgets, index, delta);
    if (!next) return;
    const previous = widgets;
    setWidgets(next); // optimiste, rétabli si l'API refuse
    const res = await dashboardRequest(
      `/api/dashboards/${dashboard.id}`,
      jsonInit("PATCH", { widgetOrder: next.map((w) => w.id) }),
      t,
      "reorder"
    );
    if (!res) setWidgets(previous);
  }

  return (
    <div className="p-6 max-w-5xl mx-auto">
      <Link
        href={listHref}
        className="mb-3 inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="w-4 h-4" aria-hidden="true" />
        {t("back")}
      </Link>
      <div className="flex flex-wrap items-center justify-between gap-3 mb-6">
        {renaming ? (
          <DashboardRenameField initialName={name} onSave={rename} onCancel={() => setRenaming(false)} />
        ) : (
          <h1 className="text-xl font-semibold">{name}</h1>
        )}
        {canEdit ? (
          <div className="flex items-center gap-1">
            {!renaming && (
              <Hint label={t("rename")}>
                <Button type="button" variant="ghost" size="icon-sm" aria-label={t("rename")} onClick={() => setRenaming(true)}>
                  <Pencil aria-hidden="true" />
                </Button>
              </Hint>
            )}
            <Hint label={t("delete")}>
              <Button
                type="button"
                variant="ghost"
                size="icon-sm"
                aria-label={t("delete")}
                onClick={() => setConfirmDelete(true)}
                className="hover:text-destructive"
              >
                <Trash2 aria-hidden="true" />
              </Button>
            </Hint>
            {!draft && (
              <Hint label={t("addWidget")}>
                <Button
                  aria-label={t("addWidget")}
                  onClick={() => {
                    setEditingId(null);
                    setDraft({ ...EMPTY_DRAFT });
                  }}
                >
                  <Plus aria-hidden="true" />
                  {t("addWidget")}
                </Button>
              </Hint>
            )}
          </div>
        ) : (
          <span className="text-sm text-muted-foreground">{t("readOnlyBadge")}</span>
        )}
      </div>
      {canEdit && draft && (
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
        <p className="text-sm text-muted-foreground">{canEdit ? t("noWidget") : t("noWidgetReadOnly")}</p>
      ) : (
        <div className="grid grid-cols-2 gap-4">
          {widgets.map((w, index) => (
            <WidgetCard
              key={w.id}
              widget={w}
              result={results[w.id]}
              actions={
                canEdit
                  ? {
                      onEdit: () => {
                        setEditingId(w.id);
                        setDraft({
                          databaseId: w.databaseId,
                          type: w.type,
                          title: w.title,
                          size: w.size,
                          config: w.config,
                        });
                      },
                      onDelete: () => setWidgetToDelete(w),
                      onMoveBefore: index > 0 ? () => void move(index, -1) : undefined,
                      onMoveAfter: index < widgets.length - 1 ? () => void move(index, 1) : undefined,
                    }
                  : null
              }
            />
          ))}
        </div>
      )}
      {confirmDelete ? (
        <ConfirmTemplateDialog
          title={t("delete")}
          body={t("deleteConfirm", { name })}
          confirmLabel={t("delete")}
          confirmTip={t("delete")}
          confirmIcon={Trash2}
          destructive
          keepTip={tt("cancel")}
          onConfirm={removeDashboard}
          onClose={() => setConfirmDelete(false)}
        />
      ) : null}
      {widgetToDelete ? (
        <ConfirmTemplateDialog
          title={t("widget.deleteTitle")}
          body={t("widget.deleteConfirm", { title: widgetToDelete.title })}
          confirmLabel={t("widget.delete")}
          confirmTip={t("widget.deleteTitle")}
          confirmIcon={Trash2}
          destructive
          keepTip={tt("cancel")}
          onConfirm={() => removeWidget(widgetToDelete)}
          onClose={() => setWidgetToDelete(null)}
        />
      ) : null}
    </div>
  );
}
