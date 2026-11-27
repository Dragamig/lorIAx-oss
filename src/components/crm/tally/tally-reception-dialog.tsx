"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { AlertTriangle, Check, Link2, List, Loader2, Webhook } from "lucide-react";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import {
  buildFieldMap,
  extractTallyFormId,
  resolveMapping,
  type FieldMapKey,
  type MappingState,
  type StoredFieldMap,
  type TallyField,
} from "@/lib/crm/tally-reception";
import { CrmActionButton, fieldClass } from "../crm-states";
import { TallyGuide, type TallyGuideScope } from "./tally-guide";

export interface TallyReceptionAutomation {
  id: string;
  databaseId: string;
  triggerConfig: Record<string, unknown>;
}

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  automation: TallyReceptionAutomation;
  /** Appelé après un enregistrement ou une annulation réussis, pour rafraîchir la liste. */
  onSaved: () => void;
}

type LoadState = "loading" | "ok" | "error";

const SERVER_KEYS = ["token", "secret", "lastReceived", "tallyFormId", "tallyFieldMap"];

const storedMap = (config: Record<string, unknown>): StoredFieldMap => {
  const raw = config.tallyFieldMap;
  const out: StoredFieldMap = {};
  if (raw && typeof raw === "object") {
    for (const k of ["name", "email", "title"] as const) {
      const v = (raw as Record<string, unknown>)[k];
      if (typeof v === "string" && v) out[k] = v;
    }
  }
  return out;
};

const storedForm = (config: Record<string, unknown>): string =>
  typeof config.tallyFormId === "string" ? config.tallyFormId : "";

function Section({ icon, title, help, children }: { icon: ReactNode; title: string; help: ReactNode; children: ReactNode }) {
  return (
    <section className="rounded-xl border border-border">
      <h3 className="flex h-11 items-center gap-2 border-b border-border px-3 text-[11px] font-bold uppercase tracking-wide text-muted-foreground">
        <span className="shrink-0" aria-hidden="true">{icon}</span>
        <span className="min-w-0 flex-1 truncate">{title}</span>
        {help}
      </h3>
      <div className="space-y-3 p-3">{children}</div>
    </section>
  );
}

const inputClass = "h-8 min-w-0 flex-1 rounded-md border border-border bg-muted/50 px-2 font-mono text-xs outline-none focus-visible:ring-2 focus-visible:ring-ring aria-[invalid=true]:border-destructive";
const labelClass = "mb-1 block text-xs text-muted-foreground";
const BTN = "min-h-8 min-w-8";

/** Boîte Réception Tally : formulaire, URL et secret à coller dans Tally, correspondance des champs. */
export function TallyReceptionDialog({ open, onOpenChange, automation, onSaved }: Props) {
  const t = useTranslations("crm.tally");
  const config = automation.triggerConfig;
  const savedForm = storedForm(config);
  const [formInput, setFormInput] = useState(savedForm);
  const [fields, setFields] = useState<TallyField[]>([]);
  const [loadState, setLoadState] = useState<LoadState>("loading");
  const [mapping, setMapping] = useState<MappingState>(() => resolveMapping(storedMap(config), []));
  const [showSecret, setShowSecret] = useState(false);
  const [saving, setSaving] = useState(false);
  const [guide, setGuide] = useState<TallyGuideScope | null>(null);
  const formRef = useRef<HTMLInputElement>(null);
  const mappingRef = useRef(mapping);
  mappingRef.current = mapping;

  const parsed = extractTallyFormId(formInput);
  const hookUrl = typeof config.token === "string" && config.token
    ? `${typeof window !== "undefined" ? window.location.origin : ""}/api/automations/hook/${config.token}`
    : "";
  const secret = typeof config.secret === "string" ? config.secret : "";

  const fetchFields = useCallback(async (): Promise<TallyField[] | null> => {
    try {
      const res = await fetch(`/api/databases/${automation.databaseId}/automations/${automation.id}/tally-fields`);
      if (!res.ok) return null;
      const data = (await res.json()) as { fields?: TallyField[] };
      return Array.isArray(data.fields) ? data.fields : [];
    } catch {
      return null;
    }
  }, [automation.databaseId, automation.id]);

  // Réinitialisation et chargement des champs à chaque ouverture.
  useEffect(() => {
    if (!open) return;
    let alive = true;
    setFormInput(storedForm(config));
    setShowSecret(false);
    setLoadState("loading");
    setMapping(resolveMapping(storedMap(config), []));
    void fetchFields().then((f) => {
      if (!alive) return;
      if (f === null) return setLoadState("error");
      setFields(f);
      setMapping(resolveMapping(storedMap(config), f));
      setLoadState("ok");
    });
    return () => {
      alive = false;
    };
    // `config` est relu à l'ouverture seulement : les modifications locales ne doivent pas être écrasées.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, fetchFields]);

  const reload = async () => {
    setLoadState("loading");
    const f = await fetchFields();
    if (f === null) {
      setLoadState("error");
      return toast.error(t("map.error"));
    }
    const before = { fields, mapping: mappingRef.current };
    setFields(f);
    setMapping(resolveMapping(buildFieldMap(mappingRef.current), f));
    setLoadState("ok");
    if (f.length === 0) return toast(t("map.noResponse"));
    toast.success(t("map.loaded"), {
      id: "tally-reload",
      duration: 4000,
      action: {
        label: t("save.undo"),
        onClick: () => {
          setFields(before.fields);
          setMapping(before.mapping);
        },
      },
    });
  };

  const changeMapping = (k: FieldMapKey, label: string, key: string | null) => {
    const previous = mappingRef.current;
    setMapping({ ...previous, [k]: { key, detected: false } });
    toast.success(t("map.changed", { label }), {
      id: "tally-map",
      duration: 4000,
      action: { label: t("save.undo"), onClick: () => setMapping(previous) },
    });
  };

  const copy = async (value: string, message: string) => {
    try {
      await navigator.clipboard.writeText(value);
      toast.success(message);
    } catch {
      toast.error(t("hook.copyFailed"));
    }
  };

  const pasteFromClipboard = async () => {
    try {
      const text = await navigator.clipboard.readText();
      setFormInput(text.trim());
      toast.success(t("form.pasted"));
      formRef.current?.focus();
    } catch {
      toast.error(t("form.clipboardDenied"));
    }
  };

  const patchConfig = async (formId: string | null, map: StoredFieldMap): Promise<boolean> => {
    const rest = Object.fromEntries(Object.entries(config).filter(([k]) => !SERVER_KEYS.includes(k)));
    const next: Record<string, unknown> = { ...rest, tallyFormId: formId };
    if (Object.keys(map).length > 0) next.tallyFieldMap = map;
    try {
      const res = await fetch(`/api/databases/${automation.databaseId}/automations/${automation.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ triggerConfig: next }),
      });
      return res.ok;
    } catch {
      return false;
    }
  };

  const save = async () => {
    if (!parsed.id || saving) return;
    const previousForm = savedForm || null;
    const previousMap = storedMap(config);
    setSaving(true);
    const ok = await patchConfig(parsed.id, buildFieldMap(mapping));
    setSaving(false);
    if (!ok) return void toast.error(t("save.error"));
    onOpenChange(false);
    onSaved();
    toast.success(t("save.saved", { id: parsed.id }), {
      action: {
        label: t("save.undo"),
        onClick: async () => {
          if (await patchConfig(previousForm, previousMap)) {
            toast.success(t("save.undone"));
            onSaved();
          } else toast.error(t("save.undoError"));
        },
      },
    });
  };

  const help = (id: string, scope: TallyGuideScope, labelKey: string) => (
    <CrmActionButton actionId={id} tip={t(labelKey)} ariaLabel={t(labelKey)} className={BTN} onClick={() => setGuide(scope)} />
  );

  const rows = useMemo(
    () =>
      [
        { k: "name" as const, label: t("map.name"), sub: t("map.scopeContact") },
        { k: "email" as const, label: t("map.email"), sub: t("map.scopeContact") },
        { k: "title" as const, label: t("map.titleField"), sub: t("map.scopeDossier") },
      ],
    [t],
  );

  const fieldLabel = (f: TallyField) => `${f.label} (${f.type})`;

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent
          showCloseButton={false}
          initialFocus={formRef}
          className="gap-0 p-0 sm:max-w-[900px] max-sm:top-0 max-sm:left-0 max-sm:h-dvh max-sm:max-w-none max-sm:translate-x-0 max-sm:translate-y-0 max-sm:grid-rows-[auto_minmax(0,1fr)_auto] max-sm:rounded-none"
        >
          <div className="flex h-12 items-center gap-2 border-b border-border px-4">
            <Webhook className="size-4 shrink-0" aria-hidden="true" />
            <DialogTitle className="min-w-0 flex-1 truncate">{t("title")}</DialogTitle>
            {help("tallyHelpFull", "full", "helpFull")}
            <CrmActionButton actionId="tallyClose" tip={t("closeTip")} ariaLabel={t("close")} className={BTN} onClick={() => onOpenChange(false)} />
          </div>
          <DialogDescription className="sr-only">{t("form.hint")}</DialogDescription>
          <div className="grid min-h-0 content-start gap-3 overflow-y-auto p-3 md:grid-cols-2 md:overflow-visible md:items-start">
            <div className="space-y-3">
              <Section icon={<Link2 className="size-4" />} title={t("form.title")} help={help("tallyHelpForm", "form", "form.help")}>
                <div>
                  <label htmlFor="tally-form" className={labelClass}>{t("form.label")}</label>
                  <div className="flex items-center gap-1.5">
                    <input
                      id="tally-form"
                      ref={formRef}
                      value={formInput}
                      onChange={(e) => setFormInput(e.target.value)}
                      placeholder={t("form.placeholder")}
                      autoComplete="off"
                      spellCheck={false}
                      aria-invalid={parsed.error ? true : undefined}
                      aria-describedby="tally-form-hint"
                      className={inputClass}
                    />
                    <CrmActionButton actionId="tallyPasteForm" tip={t("form.pasteClipboard")} ariaLabel={t("form.pasteClipboard")} className={BTN} onClick={() => void pasteFromClipboard()} />
                  </div>
                  <p
                    id="tally-form-hint"
                    aria-live="polite"
                    className={cn("mt-1.5 flex items-center gap-1 text-xs", parsed.id ? "text-emerald-700 dark:text-emerald-400" : parsed.error ? "text-destructive" : "text-muted-foreground")}
                  >
                    {parsed.id ? <Check className="size-3.5 shrink-0" aria-hidden="true" /> : parsed.error ? <AlertTriangle className="size-3.5 shrink-0" aria-hidden="true" /> : null}
                    <span>
                      {parsed.id ? t("form.recognized", { id: parsed.id }) : parsed.error ? t("form.invalid") : t("form.hint")}
                    </span>
                  </p>
                </div>
              </Section>
              <Section icon={<Webhook className="size-4" />} title={t("hook.title")} help={help("tallyHelpHook", "hook", "hook.help")}>
                {hookUrl ? (
                  <>
                    <div>
                      <label htmlFor="tally-url" className={labelClass}>{t("hook.urlLabel")}</label>
                      <div className="flex items-center gap-1.5">
                        <input id="tally-url" readOnly value={hookUrl} className={inputClass} />
                        <CrmActionButton actionId="tallyCopyUrl" tip={t("hook.copyUrl")} ariaLabel={t("hook.copyUrl")} className={BTN} onClick={() => void copy(hookUrl, t("hook.urlCopied"))} />
                      </div>
                    </div>
                    <div>
                      <label htmlFor="tally-secret" className={labelClass}>{t("hook.secretLabel")}</label>
                      <div className="flex items-center gap-1.5">
                        <input id="tally-secret" readOnly type={showSecret ? "text" : "password"} value={secret} className={inputClass} />
                        <CrmActionButton
                          actionId="tallyShowSecret"
                          tip={showSecret ? t("hook.hideSecret") : t("hook.showSecret")}
                          ariaLabel={showSecret ? t("hook.hideSecret") : t("hook.showSecret")}
                          pressed={showSecret}
                          className={BTN}
                          onClick={() => setShowSecret((v) => !v)}
                        />
                        <CrmActionButton actionId="tallyCopySecret" tip={t("hook.copySecret")} ariaLabel={t("hook.copySecret")} disabledReason={secret ? undefined : t("hook.secretEmpty")} className={BTN} onClick={() => void copy(secret, t("hook.secretCopied"))} />
                      </div>
                    </div>
                  </>
                ) : (
                  <p className="text-xs text-muted-foreground">{t("hook.noUrl")}</p>
                )}
              </Section>
            </div>
            <Section icon={<List className="size-4" />} title={t("map.title")} help={help("tallyHelpMap", "map", "map.help")}>
              {loadState === "loading" ? (
                <div role="status" aria-label={t("map.loading")} className="flex items-center gap-2 text-xs text-muted-foreground">
                  <Loader2 className="size-4 animate-spin" aria-hidden="true" />
                  {t("map.loading")}
                </div>
              ) : fields.length === 0 ? (
                <div className="flex flex-col items-start gap-2 rounded-lg border border-dashed border-border bg-muted/40 p-3 text-xs">
                  <span className="flex items-start gap-1.5" role={loadState === "error" ? "alert" : undefined}>
                    <AlertTriangle className="mt-0.5 size-3.5 shrink-0 text-amber-700 dark:text-amber-400" aria-hidden="true" />
                    <span>{loadState === "error" ? t("map.error") : t("map.empty")}</span>
                  </span>
                  <CrmActionButton actionId="tallyReload" label={t("map.reload")} tip={t("map.reloadTip")} ariaLabel={t("map.reloadAria")} className="min-h-8" onClick={() => void reload()} />
                </div>
              ) : (
                <div className="divide-y divide-border">
                  {rows.map(({ k, label, sub }) => {
                    const c = mapping[k];
                    const known = c.key === null || fields.some((f) => f.key === c.key);
                    return (
                      <div key={k} className="grid grid-cols-[minmax(0,5.5rem)_minmax(0,1fr)] items-start gap-2 py-2 first:pt-0 last:pb-0">
                        <div className="text-[13px] font-medium">
                          {label}
                          <small className="block text-[11px] font-normal text-muted-foreground">{sub}</small>
                        </div>
                        <div className="min-w-0">
                          <select
                            aria-label={t("map.selectAria", { label })}
                            value={c.key ?? ""}
                            onChange={(e) => changeMapping(k, label, e.target.value || null)}
                            className={cn(fieldClass, "h-8 w-full max-w-full")}
                          >
                            <option value="">{k === "title" ? t("map.titleAuto") : t("map.none")}</option>
                            {!known && c.key && <option value={c.key}>{c.key}</option>}
                            {fields.map((f) => (
                              <option key={f.key} value={f.key}>{fieldLabel(f)}</option>
                            ))}
                          </select>
                          {c.detected && (
                            <p className="mt-1 flex items-center gap-1 text-xs text-emerald-700 dark:text-emerald-400">
                              <Check className="size-3.5" aria-hidden="true" />
                              {t("map.detected")}
                            </p>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </Section>
          </div>
          <div className="flex justify-end gap-2 border-t border-border bg-muted/40 p-3">
            <CrmActionButton actionId="tallyCancel" label={t("save.cancel")} tip={t("save.cancelTip")} ariaLabel={t("save.cancel")} className="min-h-8" onClick={() => onOpenChange(false)} />
            <CrmActionButton
              actionId="tallySave"
              label={saving ? t("save.saving") : t("save.save")}
              tip={t("save.tip")}
              ariaLabel={t("save.save")}
              className="min-h-8 bg-primary text-primary-foreground hover:bg-primary/90"
              disabledReason={saving ? t("save.saving") : !parsed.id ? t("save.disabledTip") : undefined}
              onClick={() => void save()}
            />
          </div>
          <TallyGuide key={guide ?? "none"} scope={guide} onClose={() => setGuide(null)} onDone={() => toast(t("guide.done"))} />
        </DialogContent>
      </Dialog>
    </>
  );
}
