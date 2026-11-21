"use client";

import { useState } from "react";
import { Check, Coins, Flag, Percent, PowerOff, Sigma, Scale, X, type LucideIcon } from "lucide-react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Popover, PopoverClose, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Tip } from "@/components/editor/extensions/database-block/row-tip";
import type { DbColumn } from "@/components/editor/extensions/database-block/types";
import { isMultiValueGrouping, type KanbanLane } from "@/lib/bases/kanban";
import type { KanbanTotalsConfig } from "@/lib/bases/view-config";

export interface KanbanTotalsAction {
  id: string;
  label: string;
  icon: LucideIcon;
  shortcut?: string;
}

/** Registre des actions du menu (libellés de référence en français, l'interface passe par next-intl) : chaque entrée correspond à un contrôle rendu (data-action). */
export const KANBAN_TOTALS_ACTIONS: KanbanTotalsAction[] = [
  { id: "chooseAmount", label: "Colonne montant", icon: Sigma },
  { id: "currency", label: "Devise", icon: Coins },
  { id: "toggleWeighted", label: "Total pondéré", icon: Scale },
  { id: "toggleClosed", label: "Voie close", icon: Flag },
  { id: "setWeight", label: "Poids", icon: Percent },
  { id: "disable", label: "Désactiver les totaux", icon: PowerOff },
];

const CURRENCIES = ["EUR", "USD", "GBP", "CHF", "CAD", "JPY"];

const field =
  "h-7 rounded-md border border-input bg-transparent px-2 text-xs focus-visible:outline focus-visible:outline-2 focus-visible:outline-blue-500";

interface Props {
  columns: DbColumn[];
  lanes: KanbanLane[];
  groupColumn: DbColumn;
  config: KanbanTotalsConfig | null;
  reason: "none" | "missing_column" | "bad_type" | null;
  readOnly: boolean;
  onChange(next: KanbanTotalsConfig | null): void;
}

function WeightField({
  laneKey, name, value, enabled, disabledReason, onCommit,
}: { laneKey: string; name: string; value: number; enabled: boolean; disabledReason: string; onCommit(v: number): void }) {
  const t = useTranslations("basesTotals");
  const [draft, setDraft] = useState<string | null>(null);
  const [invalid, setInvalid] = useState(false);
  const shown = draft ?? String(value);
  const commit = () => {
    if (!enabled || draft === null) return;
    const ok = /^\d{1,3}$/.test(draft.trim()) && Number(draft) <= 100;
    if (!ok) {
      setInvalid(true);
      return;
    }
    setInvalid(false);
    setDraft(null);
    if (Number(draft) !== value) onCommit(Number(draft));
  };
  const input = (
    <input
      data-action="setWeight"
      data-lane={laneKey}
      inputMode="numeric"
      aria-label={t("weightAria", { lane: name })}
      aria-invalid={invalid || undefined}
      aria-disabled={!enabled || undefined}
      readOnly={!enabled}
      value={shown}
      onChange={(e) => { if (enabled) { setDraft(e.target.value); setInvalid(false); } }}
      onBlur={commit}
      onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); commit(); } }}
      className={`${field} w-14 text-right tabular-nums ${invalid ? "border-red-500" : ""} ${enabled ? "" : "cursor-not-allowed opacity-50"}`}
    />
  );
  return (
    <div className="flex flex-col items-end">
      <div className="flex items-center gap-1">
        {enabled ? input : <Tip label={disabledReason}>{input}</Tip>}
        <span className="text-xs text-muted-foreground" aria-hidden>{t("weightSuffix")}</span>
      </div>
      {invalid && <span role="alert" className="text-[10px] text-red-600 dark:text-red-400">{t("weightInvalid")}</span>}
    </div>
  );
}

export function KanbanTotalsMenu({ columns, lanes, groupColumn, config, reason, readOnly, onChange }: Props) {
  const t = useTranslations("basesTotals");
  const candidates = columns.filter((c) => c.type === "number" || c.type === "formula");
  const columnOk = !!config && candidates.some((c) => c.id === config.amountColumnId);
  const usable = !!config && columnOk;
  const label = readOnly ? t("readOnlyDisabled") : t("menuLabel");
  const currency = config?.currency || "EUR";
  const currencies = CURRENCIES.includes(currency) ? CURRENCIES : [currency, ...CURRENCIES];

  const patch = (p: Partial<KanbanTotalsConfig>) => config && onChange({ ...config, ...p });
  const toggleClosed = (key: string) => {
    if (!config) return;
    const closed = config.closedLanes.includes(key)
      ? config.closedLanes.filter((k) => k !== key)
      : [...config.closedLanes, key];
    onChange({ ...config, closedLanes: closed });
  };
  const choose = (id: string) => {
    if (id === "") return onChange(null);
    onChange(config ? { ...config, amountColumnId: id } : { amountColumnId: id, closedLanes: [], weights: {}, showWeighted: false });
  };

  return (
    <Popover>
      <Tip label={label}>
        <PopoverTrigger
          render={
            <Button
              variant={config && reason === null ? "secondary" : "ghost"}
              size="xs"
              disabled={readOnly}
              focusableWhenDisabled
              className="disabled:pointer-events-auto"
              aria-label={t("menuLabel")}
              data-testid="kanban-totals-button"
            />
          }
        >
          <Sigma className="h-3.5 w-3.5" aria-hidden />
          <span>{t("menuLabel")}</span>
        </PopoverTrigger>
      </Tip>
      <PopoverContent align="end" sideOffset={6} className="w-[22rem] max-w-[calc(100vw-2rem)] p-3">
        <div className="flex flex-col gap-3" data-testid="kanban-totals-menu">
          <div className="flex items-center justify-between">
            <span className="text-sm font-semibold">{t("menuLabel")}</span>
            <Tip label={t("closePanel")}>
              <PopoverClose render={<Button variant="ghost" size="icon-xs" aria-label={t("closePanel")} />}>
                <X className="h-3.5 w-3.5" aria-hidden />
              </PopoverClose>
            </Tip>
          </div>

          {candidates.length === 0 ? (
            <p className="text-xs text-muted-foreground">{t("noNumberColumn")}</p>
          ) : (
            <>
              <div className="grid grid-cols-[1fr_5.5rem] gap-2">
                <label className="flex flex-col gap-1 text-xs font-medium">
                  {t("amountColumn")}
                  <select
                    data-action="chooseAmount"
                    value={columnOk ? config!.amountColumnId : ""}
                    onChange={(e) => choose(e.target.value)}
                    className={`${field} font-normal`}
                  >
                    <option value="">{t("amountColumnNone")}</option>
                    {candidates.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                  </select>
                </label>
                <label className="flex flex-col gap-1 text-xs font-medium">
                  {t("currency")}
                  <select
                    data-action="currency"
                    value={currency}
                    disabled={!usable}
                    onChange={(e) => patch({ currency: e.target.value })}
                    className={`${field} font-normal disabled:opacity-50`}
                  >
                    {currencies.map((c) => <option key={c} value={c}>{c}</option>)}
                  </select>
                </label>
              </div>
              {reason === "missing_column" && <p role="status" className="text-xs text-amber-700 dark:text-amber-400">{t("inactiveMissingColumn")}</p>}
              {reason === "bad_type" && <p role="status" className="text-xs text-amber-700 dark:text-amber-400">{t("inactiveBadType")}</p>}
              {!config && <p className="text-xs text-muted-foreground">{t("emptyPrompt")}</p>}
            </>
          )}

          {usable && config && (
            <>
              {isMultiValueGrouping(groupColumn) && (
                <p className="text-xs text-muted-foreground">{t("multiValueNotice")}</p>
              )}
              <div role="group" aria-label={t("lanesTable")} className="flex flex-col gap-1">
                <div className="grid grid-cols-[1fr_3rem_5.5rem] items-center gap-2 text-[11px] font-medium text-muted-foreground">
                  <span>{t("laneColumn")}</span>
                  <span className="text-center">{t("closeColumn")}</span>
                  <span className="text-right">{t("weight")}</span>
                </div>
                <div className="flex max-h-60 flex-col gap-1 overflow-y-auto">
                  {lanes.map((lane) => {
                    const name = lane.key || t("noValue");
                    const closed = lane.key !== "" && config.closedLanes.includes(lane.key);
                    const weight = Object.prototype.hasOwnProperty.call(config.weights, lane.key) ? config.weights[lane.key] : 0;
                    return (
                      <div key={lane.key || "__none"} className="grid min-h-7 grid-cols-[1fr_3rem_5.5rem] items-center gap-2">
                        <span className="truncate text-xs">{name}</span>
                        <span className="flex justify-center">
                          {lane.key !== "" && (
                            <Tip label={t("closedLane")}>
                              <input
                                type="checkbox"
                                data-action="toggleClosed"
                                aria-label={t("closedAria", { lane: name })}
                                checked={closed}
                                onChange={() => toggleClosed(lane.key)}
                                className="h-4 w-4 accent-primary"
                              />
                            </Tip>
                          )}
                        </span>
                        <WeightField
                          laneKey={lane.key}
                          name={name}
                          value={weight}
                          enabled={config.showWeighted && !closed}
                          disabledReason={config.showWeighted ? t("weightClosedReason") : t("weightDisabledReason")}
                          onCommit={(v) => patch({ weights: { ...config.weights, [lane.key]: v } })}
                        />
                      </div>
                    );
                  })}
                </div>
              </div>
              <div className="flex items-center justify-between gap-3 border-t pt-2">
                <div className="flex flex-col">
                  <span className="text-xs font-semibold" id="kanban-totals-weighted-label">{t("showWeighted")}</span>
                  <span className="text-[11px] text-muted-foreground">{t("showWeightedHint")}</span>
                </div>
                <Switch
                  data-action="toggleWeighted"
                  aria-labelledby="kanban-totals-weighted-label"
                  checked={config.showWeighted}
                  onCheckedChange={(v) => patch({ showWeighted: v })}
                />
              </div>
            </>
          )}

          <div className="flex items-center justify-between border-t pt-2">
            {config ? (
              <Tip label={t("disableTotals")}>
                <Button
                  variant="outline"
                  size="xs"
                  data-action="disable"
                  aria-label={t("disableTotals")}
                  onClick={() => onChange(null)}
                >
                  <PowerOff className="h-3.5 w-3.5" aria-hidden />
                  {t("disableTotals")}
                </Button>
              </Tip>
            ) : <span />}
            <Tip label={t("done")}>
              <PopoverClose render={<Button size="xs" aria-label={t("done")} />}>
                <Check className="h-3.5 w-3.5" aria-hidden />
                {t("done")}
              </PopoverClose>
            </Tip>
          </div>
        </div>
      </PopoverContent>
    </Popover>
  );
}
