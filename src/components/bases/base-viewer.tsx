"use client";

import { useRouter } from "next/navigation";
import { resolveViewModeNavigation } from "./view-mode-navigation";
import Link from "next/link";
import { useMemo, useState, useTransition } from "react";
import { useTranslations } from "next-intl";
import { LayoutGrid, Kanban, Image as GalleryIcon, Calendar, FormInput, BarChart3, Plus, Lock, Users, X, Check } from "lucide-react";
import { toast } from "sonner";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Input } from "@/components/ui/input";
import { DashboardView, type Widget } from "./dashboard-view";
import { CalendarView } from "./calendar-view";
import { KanbanBoard } from "./kanban-board";
import { GalleryView } from "./gallery-view";
import { RecordDialog } from "./record-dialog";
import { useRecordSheet } from "./use-record-sheet";
import { useRowWrites } from "./use-row-writes";
import { useRelationData } from "@/components/editor/extensions/database-block/use-relation-data";
import { DatabaseTable } from "@/components/editor/extensions/database-block/database-table-view";
import { applySortAndFilter, normalizeFilterTree } from "@/components/editor/extensions/database-block/filter-tree";
import { Tip } from "@/components/editor/extensions/database-block/row-tip";
import { ViewScopeMenu } from "./view-scope-menu";
import { viewsApi } from "./views-api";
import { groupViews, type ViewDef, type ViewScope } from "./view-scope";
import { pickDisplayConfig } from "@/lib/bases/view-config";
import type { DbData, SortConfig } from "@/components/editor/extensions/database-block/types";

interface ColumnDef {
  id: string;
  databaseId: string;
  name: string;
  type: string;
  position: number;
  config: Record<string, unknown>;
  createdAt: string;
}

interface RowDef {
  id: string;
  databaseId: string;
  cells: Record<string, unknown>;
  position: number;
  createdAt: string;
  updatedAt: string;
}

interface SiblingTable {
  id: string;
  name: string;
  icon: string | null;
}

interface BaseViewerProps {
  database: { id: string; name: string; description: string | null; spaceId: string };
  columns: ColumnDef[];
  rows: RowDef[];
  views: ViewDef[];
  activeViewId: string;
  spaceIdParam: string;
  siblingTables: SiblingTable[];
  viewerId: string;
  readOnly?: boolean;
}

const VIEW_ICONS: Record<string, typeof LayoutGrid> = {
  grid: LayoutGrid,
  kanban: Kanban,
  gallery: GalleryIcon,
  calendar: Calendar,
  form: FormInput,
  dashboard: BarChart3,
};

type ViewType = "grid" | "kanban" | "gallery" | "calendar" | "form" | "dashboard";

const VIEW_TYPES: { type: ViewType; label: string; description: string }[] = [
  { type: "grid", label: "Grille", description: "Tableau de lignes et colonnes" },
  { type: "kanban", label: "Kanban", description: "Cartes regroupées par statut" },
  { type: "gallery", label: "Galerie", description: "Cartes visuelles avec image" },
  { type: "calendar", label: "Calendrier", description: "Lignes positionnées sur une date" },
  { type: "form", label: "Formulaire", description: "Saisie publique de nouvelles lignes" },
  { type: "dashboard", label: "Tableau de bord", description: "Widgets et agrégats" },
];

export function BaseViewer({
  database,
  columns,
  rows,
  views,
  activeViewId,
  spaceIdParam,
  siblingTables,
  viewerId,
  readOnly = false,
}: BaseViewerProps) {
  const router = useRouter();
  const tViews = useTranslations("basesViews");
  const [isPending, startTransition] = useTransition();
  const activeView = views.find((v) => v.id === activeViewId) ?? views[0];

  async function createView(name: string, type: ViewType, scope: ViewScope) {
    const res = await viewsApi.create(database.id, { name, type, scope });
    if (res.ok) {
      toast.success(tViews("createdToast", { name }));
      startTransition(() => {
        router.push(`/bases/${database.id}/views/${res.data.id}?spaceId=${spaceIdParam}`);
        router.refresh();
      });
    } else {
      toast.error(res.error ?? tViews("createFailed"));
    }
  }

  function afterDelete(viewId: string, recreatedId?: string) {
    startTransition(() => {
      if (recreatedId) {
        router.push(`/bases/${database.id}/views/${recreatedId}?spaceId=${spaceIdParam}`);
      } else if (viewId === activeViewId) {
        const { shared, personal } = groupViews(views.filter((v) => v.id !== viewId));
        const next = [...shared, ...personal][0];
        if (next) router.push(`/bases/${database.id}/views/${next.id}?spaceId=${spaceIdParam}`);
      }
      router.refresh();
    });
  }

  return (
    <div className="flex h-full flex-col">
      {/* Onglets de tables (modèle Airtable : tables sœurs du même groupe) */}
      {siblingTables.length > 0 && (
        <div className="flex items-center gap-0.5 border-b border-neutral-200 bg-neutral-50/60 px-3 pt-2 dark:border-neutral-800 dark:bg-neutral-900/40">
          {siblingTables.map((t) => {
            const active = t.id === database.id;
            return (
              <Link
                key={t.id}
                href={`/bases/${t.id}?spaceId=${spaceIdParam}`}
                className={`-mb-px flex items-center gap-1.5 rounded-t border-b-2 px-3 py-1.5 text-sm transition ${
                  active
                    ? "border-neutral-900 bg-white font-medium text-neutral-900 dark:border-neutral-100 dark:bg-neutral-950 dark:text-neutral-100"
                    : "border-transparent text-neutral-600 hover:bg-neutral-100 dark:text-neutral-400 dark:hover:bg-neutral-800"
                }`}
              >
                {t.icon && <span className="text-xs">{t.icon}</span>}
                <span className="truncate max-w-[160px]">{t.name}</span>
              </Link>
            );
          })}
        </div>
      )}

      {/* En-tête : nom + description de la table active */}
      <header className="border-b border-neutral-200 px-6 py-3 dark:border-neutral-800">
        <h1 className="text-lg font-semibold">{database.name}</h1>
        {database.description && (
          <p className="mt-0.5 text-sm text-neutral-500">{database.description}</p>
        )}
      </header>

      {/* Corps : sidebar des vues (gauche) + contenu (droite) */}
      <div className="flex min-h-0 flex-1">
        <ViewsSidebar
          views={views}
          activeViewId={activeViewId}
          databaseId={database.id}
          spaceIdParam={spaceIdParam}
          viewerId={viewerId}
          readOnly={readOnly}
          onCreateView={createView}
          onChanged={() => startTransition(() => router.refresh())}
          onDeleted={afterDelete}
          isPending={isPending}
        />

        <div className="flex min-w-0 flex-1 flex-col">
          <div className="flex min-h-0 flex-1 flex-col">
            <ViewContent
              view={activeView}
              columns={columns}
              rows={rows}
              databaseId={database.id}
              database={database}
              spaceId={spaceIdParam}
              views={views}
              viewerId={viewerId}
              readOnly={readOnly}
              onRefresh={() => startTransition(() => router.refresh())}
            />
          </div>
        </div>
      </div>
    </div>
  );
}

export function ViewsSidebar({
  views,
  activeViewId,
  databaseId,
  spaceIdParam,
  viewerId,
  readOnly,
  onCreateView,
  onChanged,
  onDeleted,
  isPending,
}: {
  views: ViewDef[];
  activeViewId: string;
  databaseId: string;
  spaceIdParam: string;
  viewerId: string;
  readOnly: boolean;
  onCreateView: (name: string, type: ViewType, scope: ViewScope) => Promise<void>;
  onChanged: () => void;
  onDeleted: (viewId: string, recreatedId?: string) => void;
  isPending: boolean;
}) {
  const t = useTranslations("basesViews");
  const { shared, personal } = groupViews(views);

  function group(title: string, list: ViewDef[], Icon: typeof Users, personalGroup: boolean) {
    return (
      <section aria-label={title}>
        <h3 className="flex h-6 items-center gap-1.5 px-2 text-[10px] font-semibold uppercase tracking-wide text-neutral-500">
          <Icon className="h-3 w-3 shrink-0" aria-hidden />
          <span className="flex-1 truncate">{title}</span>
          <span className="tabular-nums">{list.length}</span>
        </h3>
        <ul className="space-y-0.5">
          {list.map((v) => {
            const TypeIcon = VIEW_ICONS[v.type] ?? LayoutGrid;
            const active = v.id === activeViewId;
            return (
              <li
                key={v.id}
                data-view-row
                className={`group/view flex h-8 items-center gap-1 rounded pr-1 text-sm transition ${
                  active
                    ? "bg-neutral-200 font-medium text-neutral-900 dark:bg-neutral-800 dark:text-neutral-100"
                    : "text-neutral-700 hover:bg-neutral-100 dark:text-neutral-300 dark:hover:bg-neutral-800/70"
                }`}
              >
                {personalGroup ? (
                  <Tip label={t("scopePersonalHint")}>
                    <span className="flex h-6 w-6 shrink-0 items-center justify-center pl-1" tabIndex={0} aria-label={t("scopePersonalHint")}>
                      <Lock className="h-3 w-3 text-neutral-500" aria-hidden />
                    </span>
                  </Tip>
                ) : null}
                <Link
                  href={`/bases/${databaseId}/views/${v.id}?spaceId=${spaceIdParam}`}
                  className={`flex h-8 min-w-0 flex-1 items-center gap-2 rounded focus-visible:outline focus-visible:outline-2 focus-visible:outline-blue-500 ${personalGroup ? "" : "pl-2"}`}
                >
                  <span className="truncate">{v.name}</span>
                </Link>
                <TypeIcon className="h-3.5 w-3.5 shrink-0 text-neutral-500" aria-hidden />
                <ViewScopeMenu
                  view={v}
                  viewerId={viewerId}
                  sharedCount={shared.length}
                  databaseId={databaseId}
                  readOnly={readOnly}
                  onChanged={onChanged}
                  onDeleted={onDeleted}
                />
              </li>
            );
          })}
        </ul>
      </section>
    );
  }

  return (
    <aside className="flex w-56 shrink-0 flex-col border-r border-neutral-200 bg-neutral-50/40 dark:border-neutral-800 dark:bg-neutral-900/30">
      <div className="border-b border-neutral-200 px-3 py-2 dark:border-neutral-800">
        <span className="text-[11px] font-medium uppercase tracking-wide text-neutral-500">{t("title")}</span>
      </div>
      <div className="flex-1 space-y-3 overflow-y-auto px-2 py-2">
        {group(t("groupShared"), shared, Users, false)}
        {personal.length > 0 && group(t("groupPersonal"), personal, Lock, true)}
      </div>
      <div className="border-t border-neutral-200 px-2 py-2 dark:border-neutral-800">
        <NewViewPopover
          disabled={isPending}
          readOnly={readOnly}
          onCreate={onCreateView}
          existingNames={views.map((v) => v.name)}
        />
      </div>
    </aside>
  );
}

function ViewContent({
  view,
  columns,
  rows,
  databaseId,
  database,
  spaceId,
  views,
  viewerId,
  readOnly,
  onRefresh,
}: {
  view: ViewDef;
  columns: ColumnDef[];
  rows: RowDef[];
  viewerId: string;
  readOnly: boolean;
  databaseId: string;
  database: { id: string; name: string; description: string | null; spaceId: string };
  spaceId: string;
  views: ViewDef[];
  onRefresh: () => void;
}) {
  if (view.type === "grid") {
    return <GridView view={view} columns={columns} rows={rows} database={database} spaceId={spaceId} views={views} viewerId={viewerId} onRefresh={onRefresh} />;
  }
  if (view.type === "kanban") {
    return (
      <KanbanBoard
        key={view.id}
        databaseId={databaseId}
        spaceId={spaceId}
        viewId={view.id}
        viewConfig={(view.config ?? {}) as Record<string, unknown>}
        columns={columns as unknown as DbData["columns"]}
        rows={rows as unknown as DbData["rows"]}
        onRefresh={onRefresh}
        viewerId={viewerId}
        readOnly={readOnly}
      />
    );
  }
  if (view.type === "gallery") {
    return (
      <GalleryView
        databaseId={databaseId}
        spaceId={spaceId}
        viewId={view.id}
        viewConfig={(view.config ?? {}) as Record<string, unknown>}
        columns={columns as unknown as DbData["columns"]}
        rows={rows as unknown as DbData["rows"]}
        onRefresh={onRefresh}
      />
    );
  }
  if (view.type === "dashboard") {
    return <DashboardViewWrapper view={view} columns={columns} rows={rows} databaseId={databaseId} />;
  }
  if (view.type === "calendar") {
    return <CalendarViewWrapper view={view} columns={columns} rows={rows} databaseId={databaseId} spaceId={spaceId} />;
  }
  if (view.type === "form") {
    return (
      <p className="text-sm text-neutral-500">Vue Form publique — voir Phase 6.</p>
    );
  }
  return null;
}

function GridView({
  view,
  columns,
  rows,
  database,
  spaceId,
  views,
  viewerId,
  onRefresh,
}: {
  view: ViewDef;
  columns: ColumnDef[];
  rows: RowDef[];
  viewerId: string;
  database: { id: string; name: string; description: string | null; spaceId: string };
  spaceId: string;
  views: ViewDef[];
  onRefresh: () => void;
}) {
  const router = useRouter();
  const viewModeNav = useMemo(
    () => resolveViewModeNavigation(views, database.id, spaceId),
    [views, database.id, spaceId],
  );
  const t = useTranslations("recordSheet");
  const typedColumns = columns as unknown as DbData["columns"];
  const typedRows = rows as unknown as DbData["rows"];
  // Writes made from the side panel are merged here, then flow into the grid through data.rows.
  const { mergedRows, writeCell } = useRowWrites(database.id, typedRows);
  const relationData = useRelationData(typedColumns);
  // Ids in grid render order (sort and filters applied), reported by the table.
  // Initial value already follows the view's sort and filters, so a ?row= deep link has right neighbours.
  const cfg = (view.config ?? {}) as Record<string, unknown>;
  // Contexte des filtres relatifs (est moi, ce trimestre) : même valeur pour l'ordre initial et la grille.
  const [now] = useState(() => new Date());
  const evalContext = useMemo(
    () => ({ now, userId: viewerId, tz: Intl.DateTimeFormat().resolvedOptions().timeZone }),
    [now, viewerId],
  );
  const [orderedIds, setOrderedIds] = useState<string[]>(() =>
    applySortAndFilter(
      typedRows,
      typedColumns,
      Array.isArray(cfg.sorts) ? (cfg.sorts as SortConfig[]) : [],
      normalizeFilterTree(cfg.filters),
      evalContext,
    ).map((r) => r.id),
  );
  const { openRow, status, nav, openRecord, closeRecord, navigate } = useRecordSheet({ rows: mergedRows, orderedIds });
  const titleColumn =
    typedColumns.find((c) => c.type === "text" || c.type === "autonumber") ?? typedColumns[0];

  const dbData: DbData = useMemo(
    () => ({
      id: database.id,
      spaceId: database.spaceId,
      name: database.name,
      description: database.description,
      columns: typedColumns,
      rows: mergedRows,
    }),
    [database.id, database.spaceId, database.name, database.description, typedColumns, mergedRows],
  );
  return (
    <>
      <DatabaseTable
        data={dbData}
        spaceId={spaceId}
        onRefresh={onRefresh}
        viewMode="table"
        onViewModeChange={(mode) => {
          const href = viewModeNav.hrefs[mode];
          if (href) router.push(href);
        }}
        viewModeDisabledReasons={viewModeNav.disabledReasons}
        fillHeight
        viewPersistence={{
          viewId: view.id,
          initialSorts: Array.isArray(cfg.sorts) ? (cfg.sorts as SortConfig[]) : [],
          // Format brut : tableau plat hérité ou arbre récursif ; le hook normalise.
          initialFilters: cfg.filters,
          initialDisplay: pickDisplayConfig(cfg),
        }}
        onOpenRecord={openRecord}
        openRecordLabel={t("openRecord")}
        openRecordKbd={t("kbdFullscreen")}
        onDisplayedIdsChange={setOrderedIds}
        writeCell={writeCell}
        rowsResetKey={rows}
        evalContext={evalContext}
      />
      <RecordDialog
        row={openRow}
        databaseId={database.id}
        columns={typedColumns}
        spaceId={spaceId}
        relationData={relationData}
        titleColumnId={titleColumn?.id}
        onWriteCell={writeCell}
        status={status === "closed" ? "ready" : status}
        nav={nav}
        onNavigate={navigate}
        onClose={closeRecord}
      />
    </>
  );
}

function CalendarViewWrapper({
  view,
  columns,
  rows,
  databaseId,
  spaceId,
}: {
  view: ViewDef;
  columns: ColumnDef[];
  rows: RowDef[];
  databaseId: string;
  spaceId: string;
}) {
  const dateColumnId = view.config.dateColumnId as string | undefined;
  const titleColumnId = view.config.titleColumnId as string | undefined;

  async function persistConfig(next: { dateColumnId?: string; titleColumnId?: string }) {
    await fetch(`/api/databases/${databaseId}/views/${view.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        config: { ...view.config, ...next, version: "v1" },
      }),
    });
  }

  return (
    <CalendarView
      columns={columns as unknown as DbData["columns"]}
      rows={rows as unknown as DbData["rows"]}
      databaseId={databaseId}
      spaceId={spaceId}
      dateColumnId={dateColumnId}
      titleColumnId={titleColumnId}
      onConfigChange={persistConfig}
    />
  );
}

function DashboardViewWrapper({
  view,
  columns,
  rows,
  databaseId,
}: {
  view: ViewDef;
  columns: ColumnDef[];
  rows: RowDef[];
  databaseId: string;
}) {
  const widgets = (view.config.widgets ?? []) as Widget[];

  async function persistWidgets(next: Widget[]) {
    // Debounce léger côté serveur : pas de spammer le PATCH ; ici on PATCH
    // direct pour rester simple. À optimiser si latence pose problème.
    await fetch(`/api/databases/${databaseId}/views/${view.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        config: { ...view.config, widgets: next, version: "v1" },
      }),
    });
  }

  return (
    <DashboardView
      widgets={widgets}
      columns={columns.map((c) => ({ id: c.id, name: c.name, type: c.type }))}
      rows={rows.map((r) => ({ id: r.id, cells: r.cells, updatedAt: r.updatedAt }))}
      onChange={persistWidgets}
    />
  );
}

function NewViewPopover({
  disabled,
  readOnly,
  onCreate,
  existingNames,
}: {
  disabled: boolean;
  readOnly: boolean;
  onCreate: (name: string, type: ViewType, scope: ViewScope) => Promise<void>;
  existingNames: string[];
}) {
  const t = useTranslations("basesViews");
  const [scope, setScope] = useState<ViewScope>("personal");
  const [open, setOpen] = useState(false);
  const [selectedType, setSelectedType] = useState<ViewType | null>(null);
  const [name, setName] = useState("");
  const [submitting, setSubmitting] = useState(false);

  function suggestName(type: ViewType): string {
    const base = VIEW_TYPES.find((v) => v.type === type)?.label ?? "Vue";
    let candidate = base;
    let n = 2;
    const taken = new Set(existingNames.map((s) => s.toLowerCase()));
    while (taken.has(candidate.toLowerCase())) {
      candidate = `${base} ${n++}`;
    }
    return candidate;
  }

  function reset() {
    setSelectedType(null);
    setName("");
    setScope("personal");
    setSubmitting(false);
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!selectedType || !name.trim()) return;
    setSubmitting(true);
    try {
      await onCreate(name.trim(), selectedType, scope);
      setOpen(false);
      reset();
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Popover
      open={open}
      onOpenChange={(o) => {
        if (o && readOnly) return;
        setOpen(o);
        if (!o) reset();
      }}
    >
      <Tip label={readOnly ? t("readOnlyDisabled") : t("newView")}>
        <PopoverTrigger
          render={
            <button
              type="button"
              disabled={disabled}
              aria-disabled={readOnly ? true : undefined}
              aria-label={t("newView")}
              className="ml-1 flex h-7 items-center gap-1 rounded px-2 text-xs text-neutral-500 hover:bg-neutral-100 focus-visible:outline focus-visible:outline-2 focus-visible:outline-blue-500 dark:hover:bg-neutral-800 disabled:opacity-50 aria-disabled:cursor-not-allowed aria-disabled:opacity-50"
            >
              <Plus className="h-3 w-3" />
              <span>{t("newView")}</span>
            </button>
          }
        />
      </Tip>
      <PopoverContent className="w-72 p-0" sideOffset={6}>
        {!selectedType ? (
          <div className="p-2">
            <div className="px-2 pb-2 pt-1 text-[11px] font-medium uppercase tracking-wide text-neutral-500">
              Type de vue
            </div>
            <div className="flex flex-col">
              {VIEW_TYPES.map((vt) => {
                const Icon = VIEW_ICONS[vt.type];
                return (
                  <button
                    key={vt.type}
                    type="button"
                    onClick={() => {
                      setSelectedType(vt.type);
                      setName(suggestName(vt.type));
                    }}
                    className="flex items-start gap-2 rounded px-2 py-2 text-left hover:bg-neutral-100 dark:hover:bg-neutral-800"
                  >
                    <Icon className="mt-0.5 h-4 w-4 text-neutral-500" />
                    <div className="min-w-0 flex-1">
                      <div className="text-sm font-medium">{vt.label}</div>
                      <div className="text-xs text-neutral-500">{vt.description}</div>
                    </div>
                  </button>
                );
              })}
            </div>
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="p-3">
            <button
              type="button"
              onClick={() => setSelectedType(null)}
              className="mb-2 text-[11px] text-neutral-500 hover:text-neutral-900 dark:hover:text-neutral-100"
            >
              ← Changer de type
            </button>
            <div className="mb-2 flex items-center gap-2 rounded bg-neutral-50 px-2 py-1.5 text-xs dark:bg-neutral-800/50">
              {(() => {
                const Icon = VIEW_ICONS[selectedType];
                const label = VIEW_TYPES.find((v) => v.type === selectedType)?.label;
                return (
                  <>
                    <Icon className="h-3.5 w-3.5 text-neutral-500" />
                    <span className="font-medium">{label}</span>
                  </>
                );
              })()}
            </div>
            <label className="mb-1 block text-xs text-neutral-600 dark:text-neutral-400">
              Nom de la vue
            </label>
            <Input
              autoFocus
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Ex. Backlog équipe"
              className="h-8 text-sm"
            />
            <fieldset className="mt-3 space-y-1">
              <legend className="mb-1 text-xs text-neutral-600 dark:text-neutral-400">{t("scopeLabel")}</legend>
              {(["personal", "shared"] as const).map((value) => {
                const ScopeIcon = value === "personal" ? Lock : Users;
                const text = value === "personal" ? t("scopePersonal") : t("scopeShared");
                const hint = value === "personal" ? t("scopePersonalHint") : t("scopeSharedHint");
                return (
                  <Tip key={value} label={hint}>
                    <label className="flex h-7 cursor-pointer items-center gap-2 rounded px-1 text-sm hover:bg-neutral-100 dark:hover:bg-neutral-800">
                      <input
                        type="radio"
                        name="view-scope"
                        value={value}
                        checked={scope === value}
                        onChange={() => setScope(value)}
                        className="h-3.5 w-3.5 accent-blue-600 focus-visible:outline focus-visible:outline-2 focus-visible:outline-blue-500"
                      />
                      <ScopeIcon className="h-3.5 w-3.5 text-neutral-500" aria-hidden />
                      <span>{text}</span>
                    </label>
                  </Tip>
                );
              })}
            </fieldset>
            <div className="mt-3 flex justify-end gap-2">
              <Tip label={t("cancel")}>
                <button
                  type="button"
                  aria-label={t("cancel")}
                  onClick={() => setOpen(false)}
                  className="flex h-7 items-center gap-1 rounded border border-neutral-200 px-2 text-xs text-neutral-600 hover:bg-neutral-100 focus-visible:outline focus-visible:outline-2 focus-visible:outline-blue-500 dark:border-neutral-700 dark:text-neutral-300 dark:hover:bg-neutral-800"
                >
                  <X className="h-3 w-3" aria-hidden />
                  {t("cancel")}
                </button>
              </Tip>
              <Tip label={!name.trim() ? t("createDisabledNoName") : t("create")}>
                <button
                  type="submit"
                  aria-label={t("create")}
                  disabled={submitting || !name.trim()}
                  className="flex h-7 items-center gap-1 rounded bg-neutral-900 px-3 text-xs font-medium text-white hover:bg-neutral-800 focus-visible:outline focus-visible:outline-2 focus-visible:outline-blue-500 disabled:opacity-50 dark:bg-neutral-100 dark:text-neutral-900 dark:hover:bg-neutral-200"
                >
                  <Check className="h-3 w-3" aria-hidden />
                  {t("create")}
                </button>
              </Tip>
            </div>
          </form>
        )}
      </PopoverContent>
    </Popover>
  );
}

