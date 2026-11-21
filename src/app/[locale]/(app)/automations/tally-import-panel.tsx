"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { ArrowLeftRight, Check, Download, FileText, FlaskConical, Link2, Link2Off, Plug, X } from "lucide-react";
import { FOCUS_CLS, SELECTED_CLS, TipButton } from "./debug-shared";
import {
  TallyAlert,
  TallyCounter,
  TallyDedupeRule,
  TallyProgress,
  TallyRealImportDialog,
  TallyRecap,
  isActiveImport,
  type TallyImportView,
} from "./tally-import-parts";
import { TallyItemsList } from "./tally-import-items";

const API = "/api/integrations/tally";
const IMPORT_CAP = 2000;

/** Entrée unique du panneau : l'automatisme webhook entrant concerné. */
export interface TallyImportPanelProps {
  automation: {
    id: string;
    databaseId?: string | null;
    enabled: boolean;
    /** URL publique du webhook entrant, affichée dans le panneau du déclencheur. */
    webhookUrl: string;
  };
  /** Ouvre l'historique filtré sur la source Import. */
  onOpenHistory?: () => void;
}

interface TallyForm {
  id: string;
  name: string;
}
interface Counts {
  total: number;
  imported: number;
  toImport: number;
}
type PanelError = { kind: "invalid" | "quota" | "format" | "other"; message: string } | null;

interface ApiResult<T> {
  ok: boolean;
  status: number;
  data: (T & { error?: string; code?: string }) | null;
}

async function api<T>(path: string, init?: RequestInit): Promise<ApiResult<T>> {
  try {
    const res = await fetch(`${API}${path}`, {
      ...init,
      headers: init?.body ? { "Content-Type": "application/json" } : undefined,
    });
    const data = await res.json().catch(() => null);
    return { ok: res.ok, status: res.status, data };
  } catch {
    return { ok: false, status: 0, data: { error: "Réseau indisponible" } as ApiResult<T>["data"] };
  }
}

function toPanelError(r: ApiResult<unknown>): PanelError {
  if (r.status === 422 && r.data?.code === "invalid_key") {
    return {
      kind: "invalid",
      message:
        "Vérifiez la clé copiée depuis Settings, API keys dans Tally. Elle commence par tly- et n'est affichée qu'une fois à la création.",
    };
  }
  if (r.status === 429 || r.data?.code === "rate_limited") {
    return { kind: "quota", message: "L'API Tally accepte 100 requêtes par minute. Réessayez dans un instant." };
  }
  if (r.data?.code === "invalid_format") return { kind: "format", message: r.data.error ?? "Clé invalide" };
  return { kind: "other", message: r.data?.error ?? "Tally est indisponible pour le moment." };
}

const sinceIso = (d: string) => (d ? new Date(`${d}T00:00:00`).toISOString() : undefined);

export function TallyImportPanel({ automation, onOpenHistory }: TallyImportPanelProps) {
  const [loading, setLoading] = useState(true);
  const [connected, setConnected] = useState(false);
  const [maskedKey, setMaskedKey] = useState<string | null>(null);
  const [error, setError] = useState<PanelError>(null);
  const [key, setKey] = useState("");
  const [connecting, setConnecting] = useState(false);
  const [replacing, setReplacing] = useState(false);
  const [newKey, setNewKey] = useState("");
  const [forms, setForms] = useState<TallyForm[] | null>(null);
  const [formId, setFormId] = useState<string | null>(null);
  const [since, setSince] = useState("");
  const [counts, setCounts] = useState<Counts | null>(null);
  const [counting, setCounting] = useState(false);
  const [imp, setImp] = useState<TallyImportView | null>(null);
  const [simulated, setSimulated] = useState(false);
  const [cancelling, setCancelling] = useState(false);
  const [confirmReal, setConfirmReal] = useState(false);
  const [starting, setStarting] = useState(false);
  const [branching, setBranching] = useState(false);
  const [branched, setBranched] = useState(false);
  const historyRef = useRef<TallyImportView[]>([]);
  const lastStatus = useRef<string | null>(null);

  const busy = !!imp && isActiveImport(imp);

  const loadForms = useCallback(async () => {
    setForms(null);
    const r = await api<{ forms: TallyForm[] }>("/forms");
    if (r.ok) {
      setForms(r.data?.forms ?? []);
      setError(null);
    } else {
      setForms([]);
      setError(toPanelError(r));
    }
  }, []);

  // Connexion et dernier import au montage.
  useEffect(() => {
    let alive = true;
    (async () => {
      const [c, h] = await Promise.all([
        api<{ connected: boolean; maskedKey: string | null }>("/connection"),
        api<{ imports: TallyImportView[] }>(`/imports?automationId=${automation.id}`),
      ]);
      if (!alive) return;
      if (c.ok && c.data) {
        setConnected(c.data.connected);
        setMaskedKey(c.data.maskedKey);
      } else {
        setError({ kind: "other", message: c.data?.error ?? "Connexion Tally illisible" });
      }
      const list = h.data?.imports ?? [];
      const active = list.find(isActiveImport);
      historyRef.current = list;
      if (active) {
        setImp(active);
        setFormId(active.formId);
        lastStatus.current = active.status;
      }
      setSimulated(list.some((i) => i.mode === "simulate" && i.status === "completed"));
      setLoading(false);
      if (c.data?.connected) void loadForms();
    })();
    return () => {
      alive = false;
    };
  }, [automation.id, loadForms]);

  // Comptage des réponses du formulaire choisi.
  const refreshCount = useCallback(async () => {
    if (!formId) return;
    setCounting(true);
    const qs = new URLSearchParams({ formId, automationId: automation.id });
    const iso = sinceIso(since);
    if (iso) qs.set("since", iso);
    const r = await api<Counts>(`/submissions/count?${qs}`);
    setCounting(false);
    if (r.ok && r.data) {
      setCounts(r.data);
      setError(null);
    } else {
      setCounts(null);
      setError(toPanelError(r));
    }
  }, [formId, since, automation.id]);

  useEffect(() => {
    if (connected && formId && !busy) void refreshCount();
    else if (!formId) setCounts(null);
    // busy exclu : le comptage repart à la fin de l'import (voir sondage).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [connected, formId, since]);

  // Garde l'historique à jour avec l'import courant.
  useEffect(() => {
    if (!imp) return;
    historyRef.current = [imp, ...historyRef.current.filter((i) => i.id !== imp.id)];
  }, [imp]);

  // Sondage de la progression.
  useEffect(() => {
    if (!imp || !isActiveImport(imp)) return;
    const id = imp.id;
    const t = setInterval(async () => {
      const r = await api<TallyImportView>(`/imports/${id}`);
      if (!r.ok || !r.data) return;
      const next = r.data as TallyImportView;
      setImp(next);
      if (!isActiveImport(next)) {
        setCancelling(false);
        if (next.status === "completed" && next.mode === "simulate") setSimulated(true);
        const msg =
          next.status === "completed"
            ? next.mode === "real"
              ? `Import terminé : ${next.created} créés, ${next.completed} complétés, ${next.ignored} ignorés, ${next.errors} en erreur`
              : "Simulation terminée, rien n'a été écrit"
            : next.status === "cancelled"
              ? `Import annulé après ${next.processed} réponses`
              : "Import interrompu";
        if (next.status === "failed") toast.error(msg);
        else toast.success(msg);
        void refreshCount();
      }
    }, 1000);
    return () => clearInterval(t);
  }, [imp, refreshCount]);

  async function connect(raw: string, replace: boolean) {
    setConnecting(true);
    setError(null);
    const r = await api<{ connected: boolean; maskedKey: string | null }>("/connection", {
      method: "PUT",
      body: JSON.stringify({ apiKey: raw.trim() }),
    });
    setConnecting(false);
    if (!r.ok || !r.data) {
      setError(toPanelError(r));
      toast.error(r.status === 422 ? "Clé refusée par Tally" : "Connexion à Tally impossible");
      return;
    }
    setConnected(true);
    setMaskedKey(r.data.maskedKey);
    setKey("");
    setNewKey("");
    setReplacing(false);
    toast.success(replace ? "Clé API remplacée" : "Tally connecté");
    void loadForms();
  }

  async function disconnect() {
    const r = await api("/connection", { method: "DELETE" });
    if (!r.ok) {
      toast.error("Déconnexion impossible");
      return;
    }
    setConnected(false);
    setMaskedKey(null);
    setForms(null);
    setFormId(null);
    setCounts(null);
    setError(null);
    toast.success("Tally déconnecté, la clé a été oubliée");
  }

  async function start(mode: "simulate" | "real") {
    if (!formId) return;
    setStarting(true);
    const r = await api<{ importId: string }>("/imports", {
      method: "POST",
      body: JSON.stringify({ automationId: automation.id, formId, mode, since: sinceIso(since) }),
    });
    setStarting(false);
    if (!r.ok || !r.data) {
      setError(toPanelError(r));
      toast.error(r.data?.error ?? "Import impossible");
      return;
    }
    setError(null);
    lastStatus.current = "pending";
    setImp({
      id: r.data.importId,
      automationId: automation.id,
      formId,
      mode,
      status: "pending",
      cap: IMPORT_CAP,
      total: 0,
      processed: 0,
      created: 0,
      completed: 0,
      ignored: 0,
      errors: 0,
      skipped: 0,
      errorMessage: null,
    });
    toast(mode === "real" ? "Import lancé" : "Simulation lancée");
  }

  async function cancel() {
    if (!imp) return;
    setCancelling(true);
    const r = await api<TallyImportView>(`/imports/${imp.id}/cancel`, { method: "POST" });
    if (r.ok) toast("Arrêt demandé, pris en compte avant la prochaine réponse");
    else {
      setCancelling(false);
      toast.error("Arrêt impossible");
    }
  }

  async function branch() {
    if (!formId) return;
    setBranching(true);
    const r = await api<{ connected: boolean; alreadyConnected: boolean }>("/webhook", {
      method: "POST",
      body: JSON.stringify({ automationId: automation.id, formId }),
    });
    setBranching(false);
    if (r.ok) {
      setBranched(true);
      setError(null);
      toast.success(r.data?.alreadyConnected ? "Ce formulaire est déjà branché" : "Webhook créé dans Tally");
    } else if (r.status === 409 && r.data?.code === "not_public") {
      setError({ kind: "other", message: r.data.error ?? "Adresse non publique" });
      toast.error("Tally ne peut pas joindre cette adresse");
    } else {
      setError(toPanelError(r));
      toast.error("Branchement impossible");
    }
  }

  const keyOk = /^tly-.{4,}/.test(key.trim());
  const newKeyOk = /^tly-.{4,}/.test(newKey.trim());
  const localUrl = !/^https:\/\//i.test(automation.webhookUrl);
  const toImport = counts?.toImport ?? 0;
  const noResults = !!imp && !busy && imp.formId === formId;
  const fieldCls =
    "h-7 min-w-0 flex-1 rounded border border-neutral-300 bg-white px-2 font-mono text-xs dark:border-neutral-700 dark:bg-neutral-900 " +
    FOCUS_CLS;

  const alert = error && (
    <TallyAlert
      tone={error.kind === "quota" ? "warn" : "error"}
      title={
        error.kind === "invalid"
          ? "Clé API refusée par Tally (401)"
          : error.kind === "quota"
            ? "Limite Tally atteinte (429)"
            : error.kind === "format"
              ? "Format de clé invalide"
              : "Action impossible"
      }
      action={
        error.kind === "quota" ? (
          <TipButton
            label="Réessayer"
            tip="Relancer la requête"
            icon={<ArrowLeftRight className="size-3.5" />}
            onClick={() => {
              setError(null);
              if (connected && !forms?.length) void loadForms();
              else void refreshCount();
            }}
          />
        ) : undefined
      }
    >
      {error.message}
    </TallyAlert>
  );

  return (
    <section aria-label="Réponses déjà reçues dans Tally" className="space-y-3" aria-live="polite">
      <h3 className="text-[11px] font-semibold uppercase tracking-wide text-neutral-500 dark:text-neutral-400">
        Réponses déjà reçues dans Tally
      </h3>

      {loading ? (
        <div role="status" aria-busy="true" aria-label="Chargement de la connexion Tally" className="space-y-2">
          <div className="h-7 animate-pulse rounded bg-neutral-200 dark:bg-neutral-800" />
          <div className="h-7 w-2/3 animate-pulse rounded bg-neutral-200 dark:bg-neutral-800" />
        </div>
      ) : !connected ? (
        <>
          <p className="text-xs text-neutral-600 dark:text-neutral-400">
            Rapatrie les réponses envoyées avant le branchement du webhook, une par une dans ce scénario.
          </p>
          {alert}
          <label className="block space-y-1 text-xs">
            <span className="font-medium">Clé API Tally</span>
            <div className="flex items-center gap-2">
              <input
                type="password"
                autoComplete="off"
                placeholder="tly-"
                value={key}
                onChange={(e) => {
                  setKey(e.target.value);
                  setError(null);
                }}
                onKeyDown={(e) => e.key === "Enter" && keyOk && !connecting && void connect(key, false)}
                aria-label="Clé API Tally"
                className={fieldCls}
              />
              <TipButton
                label={connecting ? "Connexion…" : "Connecter"}
                tip="Vérifier la clé et se connecter à Tally"
                icon={<Plug className="size-3.5" />}
                variant="primary"
                onClick={() => void connect(key, false)}
                disabled={!keyOk || connecting}
                disabledReason={connecting ? "Connexion en cours" : "Saisissez une clé commençant par tly-"}
              />
            </div>
            <a
              href="https://tally.so/settings/api-keys"
              target="_blank"
              rel="noopener noreferrer"
              className={`inline-block rounded text-[11px] text-blue-700 underline dark:text-blue-300 ${FOCUS_CLS}`}
            >
              Créer une clé dans Tally : Settings, API keys
            </a>
          </label>
        </>
      ) : (
        <>
          <div className="flex flex-wrap items-center gap-2 rounded-md border border-neutral-200 px-2 py-1.5 dark:border-neutral-800">
            <span className="size-2 rounded-full bg-emerald-500" aria-hidden />
            {replacing ? (
              <input
                type="password"
                autoComplete="off"
                placeholder="Nouvelle clé tly-"
                value={newKey}
                onChange={(e) => setNewKey(e.target.value)}
                aria-label="Nouvelle clé API Tally"
                className={fieldCls}
              />
            ) : (
              <span className="flex-1 font-mono text-xs" aria-label="Clé enregistrée, suffixe seulement">
                tly-{maskedKey}
              </span>
            )}
            {replacing ? (
              <>
                <TipButton
                  label="Valider"
                  tip="Remplacer la clé"
                  icon={<Check className="size-3.5" />}
                  onClick={() => void connect(newKey, true)}
                  disabled={!newKeyOk || connecting}
                  disabledReason={connecting ? "Vérification en cours" : "Saisissez une clé commençant par tly-"}
                />
                <TipButton
                  label="Annuler le remplacement"
                  icon={<X className="size-3.5" />}
                  showLabel={false}
                  variant="ghost"
                  onClick={() => {
                    setReplacing(false);
                    setNewKey("");
                  }}
                />
              </>
            ) : (
              <>
                <TipButton
                  label="Remplacer"
                  tip="Saisir une autre clé"
                  icon={<ArrowLeftRight className="size-3.5" />}
                  onClick={() => setReplacing(true)}
                  disabled={busy}
                  disabledReason="Attendez la fin de l'import en cours"
                />
                <TipButton
                  label="Déconnecter"
                  tip="Oublier la clé de cette organisation"
                  icon={<Link2Off className="size-3.5" />}
                  variant="danger"
                  onClick={() => void disconnect()}
                  disabled={busy}
                  disabledReason="Attendez la fin de l'import en cours"
                />
              </>
            )}
          </div>
          {alert}

          <div className="space-y-1">
            <span id="tally-form-label" className="text-xs font-medium">
              Formulaire Tally
            </span>
            {forms === null ? (
              <div role="status" aria-busy="true" aria-label="Chargement des formulaires" className="space-y-1">
                {[0, 1, 2].map((i) => (
                  <div key={i} className="h-8 animate-pulse rounded bg-neutral-200 dark:bg-neutral-800" />
                ))}
              </div>
            ) : forms.length === 0 ? (
              !error && (
                <p className="rounded-md border border-dashed border-neutral-300 p-3 text-xs text-neutral-600 dark:border-neutral-700 dark:text-neutral-400">
                  Aucun formulaire dans ce compte Tally.
                </p>
              )
            ) : (
              <div role="listbox" aria-labelledby="tally-form-label" className="space-y-1">
                {forms.map((f) => (
                  <button
                    key={f.id}
                    type="button"
                    role="option"
                    aria-selected={formId === f.id}
                    disabled={busy}
                    onClick={() => {
                      setFormId(f.id);
                      setBranched(false);
                      if (imp?.formId !== f.id) {
                        setImp(historyRef.current.find((i) => i.formId === f.id) ?? null);
                      }
                    }}
                    className={`flex min-h-8 w-full items-center gap-2 rounded border px-2 text-left text-xs disabled:opacity-50 ${FOCUS_CLS} ${
                      formId === f.id
                        ? SELECTED_CLS
                        : "border-neutral-200 hover:bg-neutral-100 dark:border-neutral-800 dark:hover:bg-neutral-800"
                    }`}
                  >
                    <FileText className="size-3.5 shrink-0" aria-hidden />
                    <span className="min-w-0 flex-1 truncate" title={f.name}>
                      {f.name}
                    </span>
                  </button>
                ))}
              </div>
            )}
          </div>

          {formId && (
            <>
              <label className="flex items-center gap-2 text-xs">
                <span className="font-medium">Depuis le (facultatif)</span>
                <input
                  type="date"
                  value={since}
                  disabled={busy}
                  onChange={(e) => setSince(e.target.value)}
                  aria-label="Importer depuis le"
                  className={`h-7 rounded border border-neutral-300 bg-white px-2 text-xs dark:border-neutral-700 dark:bg-neutral-900 ${FOCUS_CLS}`}
                />
              </label>

              <div className="flex flex-wrap items-center gap-2">
                <TipButton
                  label={branching ? "Branchement…" : branched ? "Webhook branché" : "Brancher Tally"}
                  tip="Créer automatiquement le webhook dans Tally pour ce formulaire"
                  icon={<Link2 className="size-3.5" />}
                  onClick={() => void branch()}
                  disabled={branching || branched || localUrl}
                  disabledReason={
                    localUrl
                      ? "En local, Tally ne peut pas joindre cette adresse : il faut une URL publique en HTTPS"
                      : branching
                        ? "Branchement en cours"
                        : "Le webhook existe déjà pour ce formulaire"
                  }
                />
              </div>

              {counting ? (
                <div role="status" className="text-xs text-neutral-600 dark:text-neutral-400">
                  Comptage des réponses dans Tally…
                </div>
              ) : counts ? (
                counts.total === 0 ? (
                  <p className="rounded-md border border-dashed border-neutral-300 p-3 text-xs text-neutral-600 dark:border-neutral-700 dark:text-neutral-400">
                    Aucune réponse dans ce formulaire{since ? " depuis cette date" : ""}. Les prochaines arriveront par
                    le webhook.
                  </p>
                ) : (
                  <>
                    <TallyCounter total={counts.total} imported={counts.imported} toImport={counts.toImport} />
                    <TallyDedupeRule />
                  </>
                )
              ) : null}

              {busy && imp && <TallyProgress imp={imp} cancelling={cancelling} onCancel={() => void cancel()} />}
              {noResults && imp && (
                <>
                  <TallyRecap imp={imp} onOpenHistory={onOpenHistory} />
                  {imp.processed > 0 && <TallyItemsList key={imp.id} imp={imp} automation={automation} />}
                </>
              )}

              {!busy && counts && counts.total > 0 &&
                (toImport === 0 ? (
                  <p className="rounded-md border border-dashed border-neutral-300 p-3 text-xs text-neutral-600 dark:border-neutral-700 dark:text-neutral-400">
                    Toutes les réponses sont déjà importées.
                  </p>
                ) : (
                  <div className="flex flex-wrap items-center gap-2">
                    <TipButton
                      label={imp?.mode === "simulate" && noResults ? "Simuler à nouveau" : "Simuler l'import"}
                      tip={`Passer les ${Math.min(toImport, IMPORT_CAP)} réponses en mode simulé, rien n'est écrit`}
                      icon={<FlaskConical className="size-3.5" />}
                      onClick={() => void start("simulate")}
                      disabled={starting}
                      disabledReason="Lancement en cours"
                    />
                    <TipButton
                      label="Importer réellement"
                      tip="Créer les contacts, demandes, interactions et tâches"
                      icon={<Download className="size-3.5" />}
                      variant="primary"
                      onClick={() => setConfirmReal(true)}
                      disabled={starting || !automation.enabled || !simulated}
                      disabledReason={
                        !automation.enabled
                          ? "Activez l'automatisme avant un import réel"
                          : !simulated
                            ? "Lancez d'abord une simulation"
                            : "Lancement en cours"
                      }
                    />
                  </div>
                ))}
            </>
          )}
        </>
      )}

      <TallyRealImportDialog
        open={confirmReal}
        count={toImport}
        cap={IMPORT_CAP}
        onClose={() => setConfirmReal(false)}
        onConfirm={() => {
          setConfirmReal(false);
          void start("real");
        }}
      />
    </section>
  );
}
