"use client";

import { useEffect, useRef, useState } from "react";
import { CalendarDays, Plus } from "lucide-react";

export interface PlaceholderOption {
  /** Libellé lisible (ex. « Cellule : E-mail »). */
  label: string;
  /** Code réellement inséré (ex. « {{cells.<id>}} »). */
  value: string;
  /** Indice discret affiché après le libellé (ex. type de colonne). */
  hint?: string;
}

export interface PlaceholderGroup {
  group: string;
  options: PlaceholderOption[];
}

/**
 * Champ texte (input ou textarea) doté d'un menu déroulant pour insérer une
 * variable/placeholder par son libellé lisible — on ne tape plus les codes
 * {{ }} à la main. Le code correct est inséré à la position du curseur.
 */
export function PlaceholderField({
  value,
  onChange,
  groups,
  multiline = false,
  rows = 4,
  placeholder,
  className = "",
  dates = true,
  transform,
}: {
  value: string;
  onChange: (v: string) => void;
  groups: PlaceholderGroup[];
  multiline?: boolean;
  rows?: number;
  placeholder?: string;
  className?: string;
  /** Propose le groupe « Dates » ({{today}}, {{today+N}}). Défaut : oui. */
  dates?: boolean;
  /** Transforme le jeton avant insertion (ex. chemin nu pour une condition). */
  transform?: (token: string) => string;
}) {
  const [open, setOpen] = useState(false);
  const [days, setDays] = useState(7);
  const fieldRef = useRef<HTMLInputElement | HTMLTextAreaElement | null>(null);
  const wrapRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function onClick(e: MouseEvent) {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, [open]);

  function insert(rawToken: string) {
    const token = transform ? transform(rawToken) : rawToken;
    const el = fieldRef.current;
    setOpen(false);
    if (!el) {
      onChange(value + token);
      return;
    }
    const start = el.selectionStart ?? value.length;
    const end = el.selectionEnd ?? value.length;
    const next = value.slice(0, start) + token + value.slice(end);
    onChange(next);
    requestAnimationFrame(() => {
      el.focus();
      const pos = start + token.length;
      el.setSelectionRange(pos, pos);
    });
  }

  const hasOptions = dates || groups.some((g) => g.options.length > 0);
  const n = Math.max(1, Math.min(3650, Math.floor(Number.isFinite(days) ? days : 1)));

  return (
    <div ref={wrapRef} className="relative">
      {multiline ? (
        <textarea
          ref={(el) => { fieldRef.current = el; }}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          rows={rows}
          placeholder={placeholder}
          className={className}
        />
      ) : (
        <input
          ref={(el) => { fieldRef.current = el; }}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder}
          className={className}
        />
      )}

      {hasOptions && (
        <>
          <button
            type="button"
            onClick={() => setOpen((o) => !o)}
            onKeyDown={(e) => { if (e.key === "Escape") setOpen(false); }}
            aria-expanded={open}
            aria-haspopup="menu"
            aria-label="Insérer une variable"
            title="Insérer une variable dans ce champ"
            className="mt-1 inline-flex min-h-6 items-center gap-1 rounded border border-neutral-300 bg-white px-1.5 py-0.5 text-[11px] text-neutral-600 hover:bg-neutral-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-300 dark:hover:bg-neutral-800"
          >
            <Plus className="h-3 w-3" />
            Insérer une variable
          </button>
          {open && (
            <div
              role="menu"
              onKeyDown={(e) => { if (e.key === "Escape") setOpen(false); }}
              className="absolute z-50 mt-1 max-h-60 w-72 overflow-y-auto rounded-md border border-neutral-200 bg-white p-1 shadow-lg dark:border-neutral-700 dark:bg-neutral-900"
            >
              {dates && (
                <div>
                  <div className="px-2 py-1 text-[10px] font-semibold uppercase tracking-wider text-neutral-400">
                    Dates
                  </div>
                  <button
                    type="button"
                    role="menuitem"
                    onClick={() => insert("{{today}}")}
                    title="Insérer la date du jour"
                    className="flex min-h-6 w-full items-center justify-between gap-2 rounded px-2 py-1.5 text-left text-xs hover:bg-neutral-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 dark:hover:bg-neutral-800"
                  >
                    <span className="flex items-center gap-1.5 truncate"><CalendarDays className="h-3 w-3" /> Aujourd&apos;hui</span>
                    <code className="shrink-0 text-[10px] text-neutral-400">{"{{today}}"}</code>
                  </button>
                  <div className="flex items-center gap-1.5 px-2 py-1 text-xs">
                    <CalendarDays className="h-3 w-3 shrink-0" />
                    <span className="shrink-0">Aujourd&apos;hui +</span>
                    <input
                      type="number"
                      min={1}
                      max={3650}
                      value={days}
                      onChange={(e) => setDays(Number(e.target.value))}
                      aria-label="Nombre de jours à ajouter"
                      title="Nombre de jours à ajouter"
                      className="h-6 w-14 rounded border border-neutral-300 bg-white px-1 text-xs focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 dark:border-neutral-700 dark:bg-neutral-900"
                    />
                    <span className="shrink-0">jours</span>
                    <button
                      type="button"
                      role="menuitem"
                      onClick={() => insert(`{{today+${n}}}`)}
                      aria-label={`Insérer aujourd'hui plus ${n} jours`}
                      title={`Insérer {{today+${n}}}`}
                      className="ml-auto inline-flex h-6 w-6 items-center justify-center rounded border border-neutral-300 hover:bg-neutral-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 dark:border-neutral-700 dark:hover:bg-neutral-800"
                    >
                      <Plus className="h-3 w-3" />
                    </button>
                  </div>
                  <button
                    type="button"
                    role="menuitem"
                    onClick={() => insert("{{now}}")}
                    title="Insérer la date et l'heure courantes"
                    className="flex min-h-6 w-full items-center justify-between gap-2 rounded px-2 py-1.5 text-left text-xs hover:bg-neutral-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 dark:hover:bg-neutral-800"
                  >
                    <span className="flex items-center gap-1.5 truncate"><CalendarDays className="h-3 w-3" /> Maintenant</span>
                    <code className="shrink-0 text-[10px] text-neutral-400">{"{{now}}"}</code>
                  </button>
                </div>
              )}
              {groups
                .filter((g) => g.options.length > 0)
                .map((g) => (
                  <div key={g.group}>
                    <div className="px-2 py-1 text-[10px] font-semibold uppercase tracking-wider text-neutral-400">
                      {g.group}
                    </div>
                    {g.options.map((o) => (
                      <button
                        key={o.value}
                        type="button"
                        role="menuitem"
                        onClick={() => insert(o.value)}
                        title={`Insérer ${o.value}`}
                        className="flex min-h-6 w-full flex-col items-start gap-0.5 rounded px-2 py-1.5 text-left text-xs hover:bg-neutral-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 dark:hover:bg-neutral-800"
                      >
                        <span className="break-words">
                          {o.label}
                          {o.hint && <span className="ml-1.5 text-[10px] text-neutral-400">{o.hint}</span>}
                        </span>
                        <code className="max-w-full break-all text-[10px] leading-tight text-neutral-400">{o.value}</code>
                      </button>
                    ))}
                  </div>
                ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}
