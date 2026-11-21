"use client";

import { useState, type ReactNode } from "react";
import { ChevronDown, ChevronRight, RefreshCw, Inbox, AlertTriangle, Braces } from "lucide-react";

export type LastReceived = {
  at: string;
  size: number;
  body: unknown;
  truncated?: boolean;
};

/** Bouton icône avec info-bulle au survol ET au focus clavier, et nom accessible. */
export function IconButton({
  label,
  onClick,
  disabled,
  disabledReason,
  children,
  pressed,
}: {
  label: string;
  onClick: () => void;
  disabled?: boolean;
  disabledReason?: string;
  children: ReactNode;
  pressed?: boolean;
}) {
  const tip = disabled && disabledReason ? disabledReason : label;
  return (
    <span className="group/tip relative inline-flex">
      <button
        type="button"
        onClick={onClick}
        disabled={disabled}
        aria-label={label}
        aria-pressed={pressed}
        aria-describedby={undefined}
        className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded border border-neutral-300 text-neutral-500 hover:bg-neutral-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 disabled:cursor-not-allowed disabled:opacity-50 dark:border-neutral-700 dark:hover:bg-neutral-800"
      >
        {children}
      </button>
      <span
        role="tooltip"
        className="pointer-events-none absolute bottom-full right-0 z-30 mb-1 hidden whitespace-nowrap rounded bg-neutral-900 px-2 py-1 text-[11px] text-white shadow group-hover/tip:block group-focus-within/tip:block dark:bg-neutral-100 dark:text-neutral-900"
      >
        {tip}
      </span>
    </span>
  );
}

export function bodyToken(path: (string | number)[]): string {
  return `{{variables.body${path.map((p) => `.${p}`).join("")}}}`;
}

function formatLeaf(v: unknown): string {
  if (v === null) return "null";
  if (typeof v === "string") return v.length > 60 ? `"${v.slice(0, 60)}…"` : `"${v}"`;
  if (Array.isArray(v)) return "[]";
  if (typeof v === "object") return "{}";
  return String(v);
}

function isBranch(v: unknown): v is Record<string, unknown> | unknown[] {
  if (v === null || typeof v !== "object") return false;
  return Array.isArray(v) ? v.length > 0 : Object.keys(v as object).length > 0;
}

function TreeNode({
  name,
  value,
  path,
  depth,
  onPick,
}: {
  name: string;
  value: unknown;
  path: (string | number)[];
  depth: number;
  onPick: (token: string) => void;
}) {
  const [open, setOpen] = useState(depth < 1);
  if (isBranch(value)) {
    const entries: [string | number, unknown][] = Array.isArray(value)
      ? value.map((v, i) => [i, v])
      : Object.entries(value);
    return (
      <li>
        <button
          type="button"
          onClick={() => setOpen((o) => !o)}
          aria-expanded={open}
          className="flex w-full items-center gap-1 rounded px-1 py-0.5 text-left text-[11px] hover:bg-neutral-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 dark:hover:bg-neutral-800"
        >
          {open ? <ChevronDown className="h-3 w-3 shrink-0" /> : <ChevronRight className="h-3 w-3 shrink-0" />}
          <span className="font-mono">{name}</span>
          <span className="text-neutral-400">{Array.isArray(value) ? `[${entries.length}]` : `{${entries.length}}`}</span>
        </button>
        {open && (
          <ul className="ml-3 border-l border-neutral-200 pl-2 dark:border-neutral-800">
            {entries.map(([k, v]) => (
              <TreeNode key={String(k)} name={String(k)} value={v} path={[...path, k]} depth={depth + 1} onPick={onPick} />
            ))}
          </ul>
        )}
      </li>
    );
  }
  const token = bodyToken(path);
  return (
    <li>
      <button
        type="button"
        // Évite de retirer le focus du champ de saisie actif avant l'insertion.
        onMouseDown={(e) => e.preventDefault()}
        onClick={() => onPick(token)}
        title={`Insérer ${token}`}
        aria-label={`Insérer ${token}`}
        className="flex w-full items-baseline gap-1.5 rounded px-1 py-0.5 text-left text-[11px] hover:bg-blue-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 dark:hover:bg-blue-950"
      >
        <span className="w-3 shrink-0" />
        <span className="font-mono">{name}</span>
        <span className="truncate text-neutral-500">{formatLeaf(value)}</span>
      </button>
    </li>
  );
}

function formatSize(n: number): string {
  if (n < 1024) return `${n} o`;
  return `${(n / 1024).toFixed(1)} Ko`;
}

/** Panneau « Dernier corps reçu » : états vide, chargement, erreur, tronqué, arbre. */
export function WebhookBodyPanel({
  lastReceived,
  loading,
  error,
  onRefresh,
  onPick,
  canInsert,
}: {
  lastReceived: LastReceived | null;
  loading: boolean;
  error: string | null;
  onRefresh: () => void;
  onPick: (token: string) => void;
  canInsert: boolean;
}) {
  let content: ReactNode;
  if (loading && !lastReceived) {
    content = (
      <p role="status" className="flex items-center gap-1.5 text-[11px] text-neutral-500">
        <RefreshCw className="h-3 w-3 animate-spin" /> Chargement…
      </p>
    );
  } else if (error) {
    content = (
      <p role="alert" className="flex items-start gap-1.5 text-[11px] text-red-600 dark:text-red-400">
        <AlertTriangle className="mt-0.5 h-3 w-3 shrink-0" /> {error}
      </p>
    );
  } else if (!lastReceived) {
    content = (
      <p className="flex items-center gap-1.5 text-[11px] text-neutral-500">
        <Inbox className="h-3.5 w-3.5 shrink-0" /> En attente d&apos;un premier appel
      </p>
    );
  } else if (lastReceived.truncated || lastReceived.body === null || lastReceived.body === undefined) {
    content = (
      <p className="flex items-start gap-1.5 text-[11px] text-amber-700 dark:text-amber-400">
        <AlertTriangle className="mt-0.5 h-3 w-3 shrink-0" />
        {lastReceived.truncated
          ? `Corps trop volumineux (${formatSize(lastReceived.size)}) : il n'est pas conservé en entier, impossible d'en afficher les champs.`
          : `Corps reçu (${formatSize(lastReceived.size)}) mais illisible en JSON : aucun champ à proposer.`}
      </p>
    );
  } else {
    const body = lastReceived.body;
    content = (
      <div>
        <p className="mb-1 text-[10px] text-neutral-500">
          Reçu le {new Date(lastReceived.at).toLocaleString("fr-FR")} ({formatSize(lastReceived.size)})
        </p>
        <ul className="max-h-56 overflow-auto rounded border border-neutral-200 bg-white p-1 dark:border-neutral-800 dark:bg-neutral-900">
          {isBranch(body) ? (
            (Array.isArray(body) ? body.map((v, i) => [i, v] as [string | number, unknown]) : Object.entries(body)).map(
              ([k, v]) => <TreeNode key={String(k)} name={String(k)} value={v} path={[k]} depth={1} onPick={onPick} />
            )
          ) : (
            <TreeNode name="body" value={body} path={[]} depth={1} onPick={onPick} />
          )}
        </ul>
        <p className="mt-1 text-[10px] italic text-neutral-400">
          {canInsert
            ? "Cliquez sur un champ pour l'insérer dans le champ actif."
            : "Cliquez sur un champ pour copier sa variable."}
        </p>
      </div>
    );
  }

  return (
    <section className="space-y-1.5" aria-label="Dernier corps reçu">
      <div className="flex items-center justify-between">
        <span className="flex items-center gap-1 text-xs font-medium text-neutral-600 dark:text-neutral-300">
          <Braces className="h-3.5 w-3.5" /> Dernier corps reçu
        </span>
        <IconButton label="Actualiser" onClick={onRefresh} disabled={loading} disabledReason="Actualisation en cours">
          <RefreshCw className={`h-3.5 w-3.5 ${loading ? "animate-spin" : ""}`} />
        </IconButton>
      </div>
      {content}
    </section>
  );
}
