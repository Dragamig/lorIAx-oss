"use client";

import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { toast } from "sonner";
import { AlertCircle, Check, ChevronRight, Circle, Copy, SkipForward } from "lucide-react";

export type StepStatus = "success" | "error" | "skipped" | "simulated" | "partial";
export type TestMode = "simulate" | "real";

export interface TraceStepView {
  nodeId: string;
  kind: "action" | "condition" | "trigger";
  actionType?: string;
  status: StepStatus;
  durationMs: number;
  inputs?: unknown;
  output?: unknown;
  error?: { message: string; detail?: string };
  truncated?: boolean;
}

export interface RunSummary {
  id: string;
  triggeredAt: string;
  status: string;
  durationMs: number | null;
  errorMessage?: string | null;
  source?: string | null;
  traceTruncated?: boolean;
}

export interface RunDetail extends RunSummary {
  steps?: TraceStepView[] | null;
}

export const STATUS_LABEL: Record<StepStatus, string> = {
  success: "Succès",
  error: "Erreur",
  skipped: "Ignoré",
  simulated: "Simulé",
  partial: "Partiel",
};

export const SOURCE_LABEL: Record<string, string> = {
  trigger: "Déclenchement",
  test: "Test réel",
  replay: "Rejeu",
};

export function formatDuration(ms: number | null | undefined): string {
  if (ms == null) return "";
  if (ms < 1000) return `${Math.round(ms)} ms`;
  return `${(ms / 1000).toFixed(1).replace(".", ",")} s`;
}

export function formatDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString("fr-FR", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" });
}

const STATUS_STYLE: Record<StepStatus, string> = {
  success: "bg-green-100 text-green-700 dark:bg-green-950 dark:text-green-300",
  simulated: "bg-sky-100 text-sky-700 dark:bg-sky-950 dark:text-sky-300",
  error: "bg-red-100 text-red-700 dark:bg-red-950 dark:text-red-300",
  skipped: "bg-neutral-100 text-neutral-600 dark:bg-neutral-800 dark:text-neutral-400",
  partial: "bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300",
};

function StatusIcon({ status }: { status: StepStatus }) {
  const cls = "h-3 w-3";
  if (status === "success") return <Check className={cls} aria-hidden />;
  if (status === "error" || status === "partial") return <AlertCircle className={cls} aria-hidden />;
  if (status === "skipped") return <SkipForward className={cls} aria-hidden />;
  return <Circle className={cls} aria-hidden />;
}

/** Statut général d'un run (success / error / skipped) vers un statut d'étape. */
export function runStatusToStep(status: string): StepStatus {
  return status === "success" ? "success" : status === "skipped" ? "skipped" : status === "partial" ? "partial" : "error";
}

export function StatusPill({
  status,
  durationMs,
  onClick,
  tip,
}: {
  status: StepStatus;
  durationMs?: number | null;
  onClick?: () => void;
  tip?: string;
}) {
  const label = `${STATUS_LABEL[status]}${durationMs != null && status !== "skipped" ? ` · ${formatDuration(durationMs)}` : ""}`;
  const cls = `inline-flex min-h-6 items-center gap-1 whitespace-nowrap rounded-full px-2 text-[11px] font-medium ${STATUS_STYLE[status]}`;
  if (!onClick) {
    return (
      <span className={cls}>
        <StatusIcon status={status} />
        {label}
      </span>
    );
  }
  return (
    <span className="group/tip relative inline-flex">
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          onClick();
        }}
        aria-label={`${label}. ${tip ?? "Voir entrées et sortie"}`}
        className={`${cls} border border-transparent hover:border-current focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500`}
      >
        <StatusIcon status={status} />
        {label}
      </button>
      <Tooltip side="top">{tip ?? "Voir entrées et sortie"}</Tooltip>
    </span>
  );
}

export function Tooltip({
  children,
  align = "right",
  side = "bottom",
}: {
  children: ReactNode;
  align?: "left" | "right";
  /** `top` place l'info-bulle au-dessus pour ne pas masquer un bouton voisin. */
  side?: "top" | "bottom";
}) {
  return (
    <span
      role="tooltip"
      className={`pointer-events-none absolute z-40 hidden ${side === "top" ? "bottom-full mb-1" : "top-full mt-1"} w-max max-w-64 whitespace-normal rounded bg-neutral-900 px-2 py-1 text-[11px] font-normal leading-snug text-white shadow group-hover/tip:block group-focus-within/tip:block dark:bg-neutral-100 dark:text-neutral-900 ${
        align === "right" ? "right-0" : "left-0"
      }`}
    >
      {children}
    </span>
  );
}

/**
 * Bouton avec icône, info-bulle au survol et au focus clavier, nom accessible.
 * Désactivé : reste focalisable (aria-disabled) pour que l'info-bulle dise pourquoi.
 */
export function TipButton({
  label,
  tip,
  icon,
  onClick,
  disabled,
  disabledReason,
  variant = "outline",
  showLabel = true,
  align = "left",
  pressed,
  className = "",
}: {
  label: string;
  tip?: string;
  icon: ReactNode;
  onClick: () => void;
  disabled?: boolean;
  disabledReason?: string;
  variant?: "primary" | "outline" | "danger" | "ghost";
  showLabel?: boolean;
  align?: "left" | "right";
  pressed?: boolean;
  className?: string;
}) {
  const styles = {
    primary: "bg-blue-600 text-white hover:bg-blue-700 border-transparent",
    outline: "border-neutral-300 bg-white text-neutral-800 hover:bg-neutral-100 dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-100 dark:hover:bg-neutral-800",
    danger: "border-red-300 bg-red-50 text-red-700 hover:bg-red-100 dark:border-red-800 dark:bg-red-950 dark:text-red-300",
    ghost: "border-transparent text-neutral-600 hover:bg-neutral-100 dark:text-neutral-300 dark:hover:bg-neutral-800",
  }[variant];
  const text = disabled && disabledReason ? disabledReason : tip ?? label;
  return (
    <span className="group/tip relative inline-flex">
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          if (!disabled) onClick();
        }}
        aria-disabled={disabled || undefined}
        aria-label={label}
        aria-pressed={pressed}
        className={`inline-flex min-h-7 items-center gap-1.5 rounded border px-2 text-xs font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 aria-disabled:cursor-not-allowed aria-disabled:opacity-50 ${styles} ${showLabel ? "" : "min-w-7 justify-center px-0"} ${className}`}
      >
        {icon}
        {showLabel && <span>{label}</span>}
      </button>
      <Tooltip align={align}>{text}</Tooltip>
    </span>
  );
}

/** Mise en avant de sélection commune (liste et étapes) : contour bleu + fond bleuté, AA clair et sombre. */
export const SELECTED_CLS =
  "border-blue-600 bg-blue-50 ring-1 ring-blue-600 dark:border-blue-400 dark:bg-blue-950 dark:ring-blue-400";
/** Focus clavier : anneau décalé, distinct du contour de sélection. */
export const FOCUS_CLS =
  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-600 focus-visible:ring-offset-2 focus-visible:ring-offset-white dark:focus-visible:ring-blue-300 dark:focus-visible:ring-offset-neutral-950";

export function isSimId(v: unknown): boolean {
  return typeof v === "string" && v.startsWith("sim_");
}

function Leaf({ value }: { value: unknown }) {
  if (value === null) return <span className="text-neutral-400">null</span>;
  if (typeof value === "string") {
    return (
      <span className="min-w-0 break-words text-neutral-600 dark:text-neutral-300">
        {value}
        {isSimId(value) && (
          <span className="ml-1 rounded bg-sky-100 px-1 text-[10px] font-semibold text-sky-700 dark:bg-sky-950 dark:text-sky-300">
            simulé
          </span>
        )}
      </span>
    );
  }
  return <span className="text-neutral-600 dark:text-neutral-300">{String(value)}</span>;
}

/** Nom lisible d'un identifiant de colonne (renseigné par l'inspecteur). */
const ColumnNamesContext = createContext<Map<string, string>>(new Map());

function KeyName({ name }: { name: string }) {
  const names = useContext(ColumnNamesContext);
  const label = names.get(name);
  return (
    <span className="font-medium text-blue-700 dark:text-blue-300" title={label ? name : undefined}>
      {label ?? name}
    </span>
  );
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Identifiants de base cités par une trace (`databaseId` des entrées), pour résoudre les colonnes. */
function collectDatabaseIds(value: unknown, out: Set<string>, depth = 0) {
  if (!value || typeof value !== "object" || depth > 6) return;
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    if (k === "databaseId") {
      const raw = isResolvedValue(v) ? v.resolved : v;
      if (typeof raw === "string" && UUID_RE.test(raw)) out.add(raw);
    } else if (v && typeof v === "object") collectDatabaseIds(v, out, depth + 1);
  }
}

const columnCache = new Map<string, Promise<Array<{ id: string; name: string }>>>();

function fetchColumns(databaseId: string) {
  let p = columnCache.get(databaseId);
  if (!p) {
    p = fetch(`/api/databases/${databaseId}/columns`)
      .then((r) => (r.ok ? r.json() : { columns: [] }))
      .then((j) => (Array.isArray(j.columns) ? (j.columns as Array<{ id: string; name: string }>) : []))
      .catch(() => []);
    columnCache.set(databaseId, p);
  }
  return p;
}

/** Noms des colonnes de la base de l'automatisme et des bases citées par l'étape. */
function useColumnNames(databaseIds: string[]): Map<string, string> {
  const key = databaseIds.join(",");
  const [loaded, setLoaded] = useState<{ key: string; names: Map<string, string> }>({ key: "", names: new Map() });
  useEffect(() => {
    if (!key) return;
    let active = true;
    Promise.all(key.split(",").map(fetchColumns)).then((lists) => {
      if (!active) return;
      const names = new Map<string, string>();
      for (const l of lists) for (const c of l) names.set(c.id, c.name);
      setLoaded({ key, names });
    });
    return () => {
      active = false;
    };
  }, [key]);
  return loaded.key === key ? loaded.names : EMPTY_NAMES;
}

const EMPTY_NAMES = new Map<string, string>();

function TreeNode({ name, value, depth }: { name: string; value: unknown; depth: number }) {
  const isObj = value !== null && typeof value === "object";
  const [open, setOpen] = useState(depth < 2);
  if (!isObj) {
    return (
      <li className="flex min-h-6 items-start gap-1 px-1 py-0.5 text-xs">
        <KeyName name={name} />
        <span className="text-neutral-400">:</span>
        <Leaf value={value} />
      </li>
    );
  }
  const entries = Array.isArray(value)
    ? (value as unknown[]).map((v, i) => [String(i), v] as const)
    : Object.entries(value as Record<string, unknown>);
  return (
    <li>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        className="flex min-h-6 w-full items-center gap-1 rounded px-1 text-left text-xs hover:bg-neutral-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 dark:hover:bg-neutral-800"
      >
        <ChevronRight className={`h-3 w-3 shrink-0 transition-transform ${open ? "rotate-90" : ""}`} aria-hidden />
        <KeyName name={name} />
        <span className="text-neutral-400">{Array.isArray(value) ? `[${entries.length}]` : "{…}"}</span>
      </button>
      {open && (
        <ul className="ml-3 border-l border-neutral-200 pl-2 dark:border-neutral-800">
          {entries.map(([k, v]) => (
            <TreeNode key={k} name={k} value={v} depth={depth + 1} />
          ))}
        </ul>
      )}
    </li>
  );
}

export function JsonTree({ value }: { value: unknown }) {
  if (value === null || typeof value !== "object") {
    return (
      <div className="rounded-md border border-neutral-200 bg-neutral-50 p-2 text-xs dark:border-neutral-800 dark:bg-neutral-950">
        <Leaf value={value ?? null} />
      </div>
    );
  }
  const entries = Array.isArray(value)
    ? (value as unknown[]).map((v, i) => [String(i), v] as const)
    : Object.entries(value as Record<string, unknown>);
  return (
    <ul className="rounded-md border border-neutral-200 bg-neutral-50 p-1.5 dark:border-neutral-800 dark:bg-neutral-950">
      {entries.map(([k, v]) => (
        <TreeNode key={k} name={k} value={v} depth={0} />
      ))}
    </ul>
  );
}

type InputRow = { label: string; source?: string; value: string; title?: string };

function isResolvedValue(v: unknown): v is { source: string; resolved: string } {
  return isResolved(v);
}

function isResolved(v: unknown): v is { source: string; resolved: string } {
  if (!v || typeof v !== "object") return false;
  const k = Object.keys(v as object);
  return k.length === 2 && "source" in (v as object) && "resolved" in (v as object);
}

export function flattenInputs(
  inputs: unknown,
  prefix = "",
  out: InputRow[] = [],
  names: Map<string, string> = EMPTY_NAMES,
  rawPrefix = ""
): InputRow[] {
  if (inputs == null) return out;
  if (isResolved(inputs)) {
    out.push({ label: prefix || "Valeur", source: String(inputs.source), value: String(inputs.resolved) });
    return out;
  }
  if (typeof inputs !== "object") {
    out.push({ label: prefix || "Valeur", value: String(inputs) });
    return out;
  }
  const entries = Array.isArray(inputs)
    ? (inputs as unknown[]).map((v, i) => [String(i + 1), v] as const)
    : Object.entries(inputs as Record<string, unknown>);
  for (const [k, v] of entries) {
    const shown = names.get(k) ?? k;
    const label = prefix ? `${prefix} · ${shown}` : shown;
    const raw = rawPrefix ? `${rawPrefix} · ${k}` : k;
    const title = raw !== label ? raw : undefined;
    if (v !== null && typeof v === "object" && !isResolved(v)) flattenInputs(v, label, out, names, raw);
    else if (isResolved(v)) out.push({ label, title, source: String(v.source), value: String(v.resolved) });
    else if (v !== "" && v !== null && v !== undefined) {
      const text = String(v);
      const colName = k === "columnId" ? names.get(text) : undefined;
      out.push({
        label,
        value: colName ?? text,
        title: colName ? [title, text].filter(Boolean).join(" ") : title,
      });
    }
  }
  return out;
}

function SectionTitle({ children, action }: { children: ReactNode; action?: ReactNode }) {
  return (
    <div className="mb-1.5 flex items-center justify-between">
      <h4 className="text-[10px] font-semibold uppercase tracking-wider text-neutral-500">{children}</h4>
      {action}
    </div>
  );
}

function copyJson(value: unknown) {
  const text = typeof value === "string" ? value : JSON.stringify(value, null, 2);
  navigator.clipboard?.writeText(text).then(
    () => toast.success("Sortie copiée"),
    () => toast.error("Copie impossible")
  );
}

/** Inspecteur d'une étape : erreur, entrées résolues, sortie. Même rendu pour test et historique. */
export function StepInspector({
  title,
  step,
  index,
  mode,
  databaseId,
}: {
  title: string;
  step: TraceStepView;
  index?: number;
  mode?: TestMode;
  /** Base de l'automatisme : ses colonnes nomment les identifiants de la trace. */
  databaseId?: string;
}) {
  const dbKey = useMemo(() => {
    const ids = new Set<string>();
    if (databaseId) ids.add(databaseId);
    collectDatabaseIds(step.inputs, ids);
    return [...ids].sort();
  }, [databaseId, step.inputs]);
  const names = useColumnNames(dbKey);
  const rows = flattenInputs(step.inputs, "", [], names);
  const hasOutput = step.output !== undefined && step.output !== null;
  const [showDetail, setShowDetail] = useState(false);
  return (
    <div className="text-sm" aria-live="polite">
      <div className="flex flex-wrap items-center gap-2 border-b border-neutral-200 pb-2 dark:border-neutral-800">
        {index != null && <span className="text-[10px] font-semibold text-neutral-400">{index}</span>}
        <span className="min-w-0 flex-1 font-semibold">{title}</span>
        <StatusPill status={step.status} durationMs={step.durationMs} />
        {mode && (
          <span
            className={`rounded px-1.5 py-0.5 text-[10px] font-semibold ${
              mode === "real"
                ? "bg-red-100 text-red-700 dark:bg-red-950 dark:text-red-300"
                : "bg-sky-100 text-sky-700 dark:bg-sky-950 dark:text-sky-300"
            }`}
          >
            {mode === "real" ? "Réel" : "Simulé"}
          </span>
        )}
      </div>

      {step.error && (
        <section className="mt-3">
          <SectionTitle>Erreur</SectionTitle>
          <div className="rounded-md border border-red-300 bg-red-50 p-2.5 text-xs dark:border-red-900 dark:bg-red-950/50">
            <p className="font-semibold text-red-800 dark:text-red-200">{step.error.message}</p>
            {step.error.detail && (
              <>
                <button
                  type="button"
                  onClick={() => setShowDetail((s) => !s)}
                  aria-expanded={showDetail}
                  className="mt-1.5 inline-flex min-h-6 items-center gap-1 rounded text-[11px] text-red-700 underline-offset-2 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 dark:text-red-300"
                >
                  <ChevronRight className={`h-3 w-3 transition-transform ${showDetail ? "rotate-90" : ""}`} aria-hidden />
                  Détail technique
                </button>
                {showDetail && (
                  <pre className="mt-1 whitespace-pre-wrap break-words font-mono text-[11px] text-red-700 dark:text-red-300">
                    {step.error.detail}
                  </pre>
                )}
              </>
            )}
          </div>
        </section>
      )}

      {step.truncated && (
        <p className="mt-3 rounded-md bg-amber-50 p-2 text-xs text-amber-800 dark:bg-amber-950/50 dark:text-amber-200">
          Entrées et sortie retirées : la trace de cette exécution dépasse la taille conservée.
        </p>
      )}

      {!step.truncated && (
        <section className="mt-3">
          <SectionTitle>Entrées résolues</SectionTitle>
          {rows.length === 0 ? (
            <p className="text-xs italic text-neutral-400">Aucune entrée.</p>
          ) : (
            <ul className="divide-y divide-neutral-200 dark:divide-neutral-800">
              {rows.map((r, i) => (
                <li key={`${r.label}-${i}`} className="py-1.5 text-xs">
                  <div className="text-neutral-500" title={r.title}>{r.label}</div>
                  {r.source ? (
                    <div className="mt-0.5 flex flex-wrap items-baseline gap-1.5">
                      <code className="rounded bg-amber-100 px-1.5 py-0.5 font-mono text-[11px] text-amber-800 dark:bg-amber-950 dark:text-amber-200">
                        {r.source}
                      </code>
                      <span className="text-neutral-400" aria-hidden>
                        →
                      </span>
                      <span className="min-w-0 break-words">{r.value === "" ? <em className="text-neutral-400">vide</em> : r.value}</span>
                    </div>
                  ) : (
                    <div className="mt-0.5 break-words" title={r.title}>{r.value}</div>
                  )}
                </li>
              ))}
            </ul>
          )}
        </section>
      )}

      {!step.truncated && (
        <section className="mt-3">
          <SectionTitle
            action={
              hasOutput ? (
                <TipButton
                  label="Copier la sortie"
                  icon={<Copy className="h-3.5 w-3.5" aria-hidden />}
                  showLabel={false}
                  variant="ghost"
                  align="right"
                  onClick={() => copyJson(step.output)}
                />
              ) : undefined
            }
          >
            Sortie
          </SectionTitle>
          {hasOutput ? (
            <>
              <ColumnNamesContext.Provider value={names}>
                <JsonTree value={step.output} />
              </ColumnNamesContext.Provider>
              {JSON.stringify(step.output).includes('"sim_') ? (
                <p className="mt-1.5 text-[11px] text-neutral-500">
                  Les identifiants fictifs permettent aux étapes suivantes de se résoudre.
                </p>
              ) : null}
            </>
          ) : (
            <p className="text-xs italic text-neutral-400">
              {step.status === "skipped" ? "Étape ignorée : aucune sortie." : "Aucune sortie."}
            </p>
          )}
        </section>
      )}
    </div>
  );
}
