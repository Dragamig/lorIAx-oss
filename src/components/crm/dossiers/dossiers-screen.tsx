"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Filter } from "lucide-react";
import { useTranslations } from "next-intl";
import { useSearchParams } from "next/navigation";
import { toast } from "sonner";
import { viewsApi } from "@/components/bases/views-api";
import type { ViewScope } from "@/components/bases/view-scope";
import { useRecordSheet } from "@/components/bases/use-record-sheet";
import type { DbRow } from "@/components/editor/extensions/database-block/types";
import { todayIn } from "@/lib/crm/dates";
import type { DossiersDto } from "@/lib/crm/dossiers";
import { crmTimezone, useCrmDossiers } from "@/lib/crm/use-crm-data";
import { CrmActionButton, fieldClass } from "../crm-states";
import { DealSheet } from "../fiche/deal-sheet";
import { CrmScreen, type CrmScreenState } from "../shell/crm-screen";
import { ToggleFilter } from "../shell/toggle-filter";
import { DossiersTable } from "./dossiers-table";
import {
  EMPTY_STATE,
  applyDossiersFilters,
  isEmptyState,
  matchViewTab,
  stateToViewConfig,
  viewConfigToState,
  type DossiersFilterState,
  type FilterColumnIds,
} from "./dossiers-filters";
import { SaveViewForm } from "./save-view-form";
import { ViewTabs } from "./view-tabs";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type DossierView = DossiersDto["views"][number];

export function DossiersScreen() {
  const t = useTranslations("crm.dossiers");
  const params = useSearchParams();
  const contactParam = params.get("contact");
  const initialContact = contactParam && UUID_RE.test(contactParam) ? contactParam : null;

  // Défaut « Mes dossiers », sauf quand on arrive depuis un contact.
  const [filters, setFilters] = useState<DossiersFilterState>(() => ({
    ...EMPTY_STATE,
    owner: initialContact ? null : "mine",
    contactId: initialContact,
  }));
  const [formOpen, setFormOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [hidden, setHidden] = useState<string[]>([]);
  const [ignored, setIgnored] = useState(0);

  const { data: dto, error, isLoading, mutate } = useCrmDossiers();

  let state: CrmScreenState = "ready";
  if (!dto && error) state = String((error as Error).message).endsWith("404") ? "notConnected" : "error";
  else if (!dto) state = isLoading ? "loading" : "ready";

  const cols: FilterColumnIds = useMemo(
    () => ({
      titre: dto?.fieldColumns.titre ?? null,
      statut: dto?.fieldColumns.statut ?? null,
      responsable: dto?.fieldColumns.responsable ?? null,
      relance: dto?.fieldColumns.relance ?? null,
      contact: dto?.fieldColumns.contact ?? null,
    }),
    [dto],
  );
  const mineAvailable = dto?.mineAvailable ?? true;
  const lateAvailable = cols.relance !== null;
  // Un filtre sur un champ non raccordé est sans effet : on le retire de l'état effectif.
  const eff = useMemo<DossiersFilterState>(
    () => ({
      ...filters,
      owner: filters.owner === "mine" && !mineAvailable ? null : filters.owner,
      late: filters.late && lateAvailable,
    }),
    [filters, mineAvailable, lateAvailable],
  );

  const tz = crmTimezone();
  // Le jour est recalculé au retour sur l'onglet et à chaque rechargement des données.
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const refresh = () => setNow(new Date());
    window.addEventListener("focus", refresh);
    document.addEventListener("visibilitychange", refresh);
    return () => {
      window.removeEventListener("focus", refresh);
      document.removeEventListener("visibilitychange", refresh);
    };
  }, []);
  const [seenDto, setSeenDto] = useState(dto);
  if (dto !== seenDto) {
    setSeenDto(dto);
    setNow(new Date());
  }
  const today = todayIn(now, tz);
  const closed = dto?.closedLanes ?? [];

  const visibleViews = useMemo(() => (dto?.views ?? []).filter((v) => !hidden.includes(v.id)), [dto, hidden]);
  const activeId = useMemo(() => matchViewTab(visibleViews, eff, cols), [visibleViews, eff, cols]);

  const visible = useMemo(
    () =>
      dto
        ? applyDossiersFilters({ deals: dto.deals, rows: dto.rows, columns: dto.columns, cols, state: eff, closed, userId: dto.userId, now, tz })
        : [],
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [dto, cols, eff, now, tz],
  );

  const orderedIds = useMemo(() => visible.map((d) => d.id), [visible]);
  const records = useMemo<DbRow[]>(
    () => orderedIds.map((id, position) => ({ id, databaseId: "", cells: {}, position, createdAt: "", updatedAt: "" })),
    [orderedIds],
  );
  const { openRecord, openRowId, nav, navigate, closeRecord } = useRecordSheet({ rows: records, orderedIds });

  const set = (patch: Partial<DossiersFilterState>) => setFilters((f) => ({ ...f, ...patch }));
  const applyView = (id: string) => {
    const v = visibleViews.find((x) => x.id === id);
    if (!v) return;
    const parsed = viewConfigToState(v.config, cols);
    setFilters(parsed.state);
    setIgnored(parsed.ignored);
  };

  const canEdit = dto?.canEdit ?? false;
  const writeReason = !canEdit ? t("readOnly") : undefined;
  const saveReason = writeReason ?? (activeId !== null ? t("alreadySaved") : undefined);

  // Les actions des toasts rappellent la dernière version des fonctions.
  const saveRef = useRef<(name: string, scope: ViewScope) => Promise<void>>(async () => {});
  const restoreRef = useRef<(v: DossierView) => Promise<void>>(async () => {});
  const deleteRef = useRef<(id: string) => Promise<void>>(async () => {});

  saveRef.current = async (name, scope) => {
    if (!dto || saving) return;
    setSaving(true);
    const config = stateToViewConfig(eff, cols, today, closed);
    const res = await viewsApi.create(dto.databaseId, { name, type: "grid", scope, config });
    setSaving(false);
    if (!res.ok) {
      toast.error(t("toast.saveError", { name }), { action: { label: t("toast.retry"), onClick: () => void saveRef.current(name, scope) } });
      return;
    }
    setFormOpen(false);
    const createdId = res.data.id;
    toast.success(t("toast.saved", { name }), {
      action: {
        label: t("toast.undo"),
        onClick: () =>
          void (async () => {
            const undo = await viewsApi.remove(dto.databaseId, createdId);
            if (undo.ok) toast.success(t("toast.saveUndone"));
            else toast.error(t("toast.undoError"));
            await mutate();
          })(),
      },
    });
    await mutate();
  };

  restoreRef.current = async (v) => {
    if (!dto) return;
    const res = await viewsApi.restore(dto.databaseId, {
      id: v.id,
      name: v.name,
      type: v.type,
      isDefault: false,
      position: 0,
      config: v.config,
      scope: v.scope,
      createdBy: null,
    });
    if (res.ok) toast.success(t("toast.restored", { name: v.name }));
    else toast.error(t("toast.restoreError", { name: v.name }), { action: { label: t("toast.retry"), onClick: () => void restoreRef.current(v) } });
    await mutate();
  };

  deleteRef.current = async (id) => {
    if (!dto) return;
    const v = dto.views.find((x) => x.id === id);
    if (!v) return;
    setHidden((h) => [...h, id]);
    if (id === activeId) setIgnored(0);
    const res = await viewsApi.remove(dto.databaseId, id);
    if (!res.ok) {
      setHidden((h) => h.filter((x) => x !== id));
      toast.error(t("toast.deleteError", { name: v.name }), { action: { label: t("toast.retry"), onClick: () => void deleteRef.current(id) } });
      return;
    }
    toast.success(t("toast.deleted", { name: v.name }), {
      action: { label: t("toast.undo"), onClick: () => void restoreRef.current(v) },
    });
    await mutate();
    setHidden((h) => h.filter((x) => x !== id));
  };

  const onSave = useCallback((name: string, scope: ViewScope) => void saveRef.current(name, scope), []);

  const contactName = useMemo(() => {
    if (!filters.contactId || !dto) return null;
    return dto.deals.find((d) => d.contactId === filters.contactId)?.contactName ?? null;
  }, [filters.contactId, dto]);

  const FilterIcon = Filter;
  const resetReason = isEmptyState(eff) ? t("resetDisabled") : undefined;
  const emptyBase = !!dto && dto.deals.length === 0;

  return (
    <CrmScreen
      title={t("title")}
      role="dossiers"
      state={state}
      onRetry={() => void mutate()}
      missing={dto?.missing}
      tools={
        <CrmActionButton
          actionId="dossiersSaveView"
          label={t("save")}
          tip={t("saveTip")}
          ariaLabel={t("save")}
          pressed={formOpen}
          onClick={() => setFormOpen((v) => !v)}
          disabledReason={saveReason}
        />
      }
    >
      {dto && (
        <div className="min-h-0 flex-1 overflow-y-auto pb-4">
          <ViewTabs
            views={visibleViews}
            activeId={activeId}
            onApply={applyView}
            onDelete={(id) => void deleteRef.current(id)}
            deleteReason={writeReason}
          />
          {ignored > 0 && activeId !== null && (
            <p role="status" className="mx-6 mt-2 text-xs text-muted-foreground">
              {t("ignoredFilters", { count: ignored })}
            </p>
          )}
          {formOpen && <SaveViewForm busy={saving} searchActive={eff.q.trim() !== ""} onSave={onSave} onCancel={() => setFormOpen(false)} />}
          <div className="flex flex-wrap items-center gap-2 px-6 py-3">
            <label htmlFor="dossiers-q" className="sr-only">
              {t("searchAria")}
            </label>
            <input
              id="dossiers-q"
              type="search"
              value={filters.q}
              placeholder={t("search")}
              className={`${fieldClass} w-64`}
              onChange={(e) => set({ q: e.target.value })}
            />
            <select
              aria-label={t("statusAria")}
              value={filters.status ?? ""}
              disabled={!cols.statut}
              className={fieldClass}
              onChange={(e) => set({ status: e.target.value || null })}
            >
              <option value="">{t("allStatuses")}</option>
              {dto.statuses.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </select>
            <select
              aria-label={t("ownerAria")}
              value={eff.owner ?? ""}
              disabled={!cols.responsable}
              className={fieldClass}
              onChange={(e) => set({ owner: e.target.value || null })}
            >
              <option value="">{t("allOwners")}</option>
              <option value="mine" disabled={!mineAvailable}>
                {mineAvailable ? t("mine") : t("mineUnavailable")}
              </option>
              {dto.owners.map((o) => (
                <option key={o.id} value={o.id}>
                  {o.name}
                </option>
              ))}
            </select>
            <ToggleFilter
              actionId="dossiersLate"
              tip={t("lateTip")}
              pressed={eff.late}
              onToggle={() => set({ late: !filters.late })}
              disabledReason={lateAvailable ? undefined : t("lateUnavailable")}
            />
            {filters.contactId && (
              <span className="inline-flex h-7 items-center gap-1 rounded-full border border-border bg-muted/40 pl-2.5 pr-1 text-xs">
                <span className="max-w-48 truncate">{t("contactChip", { name: contactName ?? t("contactUnknown") })}</span>
                <CrmActionButton
                  actionId="dossiersContactClear"
                  tip={t("contactClearTip")}
                  ariaLabel={t("contactClearAria")}
                  className="border-transparent px-1"
                  onClick={() => set({ contactId: null })}
                />
              </span>
            )}
            <CrmActionButton
              actionId="dossiersReset"
              label={t("reset")}
              tip={t("resetTip")}
              ariaLabel={t("reset")}
              onClick={() => {
                setFilters(EMPTY_STATE);
                setIgnored(0);
              }}
              disabledReason={resetReason}
            />
          </div>
          <div className="px-6">
            {visible.length === 0 ? (
              <div className="flex flex-col items-center gap-3 rounded-lg border border-dashed border-border p-8 text-center">
                <FilterIcon className="size-5 text-muted-foreground" aria-hidden="true" />
                <p className="text-sm font-medium">{emptyBase ? t("emptyBaseTitle") : t("emptyTitle")}</p>
                {!emptyBase && (
                  <>
                    <p className="text-xs text-muted-foreground">{t("emptyBody")}</p>
                    <CrmActionButton
                      actionId="dossiersReset"
                      label={t("reset")}
                      tip={t("resetTip")}
                      ariaLabel={t("reset")}
                      onClick={() => {
                        setFilters(EMPTY_STATE);
                        setIgnored(0);
                      }}
                      disabledReason={resetReason}
                    />
                  </>
                )}
              </div>
            ) : (
              <DossiersTable
                deals={visible}
                owners={dto.owners}
                closed={closed}
                today={today}
                currency={dto.currency}
                openId={openRowId}
                onOpen={openRecord}
              />
            )}
          </div>
        </div>
      )}
      {openRowId && <DealSheet rowId={openRowId} nav={nav} onNavigate={navigate} onClose={closeRecord} />}
    </CrmScreen>
  );
}
