"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { Tooltip } from "@base-ui/react/tooltip";
import { Columns3, GripVertical, Lock, Search, Eye, EyeOff } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  type DisplayConfig,
  type RowHeight,
  resolveRowHeight,
  resolveVisibleColumns,
  orderedColumnIds,
  toggleColumnVisibility,
  setAllColumnsVisible,
  moveColumn,
  shiftColumn,
} from "@/lib/bases/view-config";
import type { DbColumn } from "./types";
import { COLUMN_TYPE_ICONS } from "./constants";

// ─── Info-bulle (survol et focus clavier) ────────────────────────────────────

function Tip({ label, kbd, children }: { label: string; kbd?: string; children: React.ReactElement }) {
  return (
    <Tooltip.Root>
      <Tooltip.Trigger render={children} />
      <Tooltip.Portal>
        <Tooltip.Positioner sideOffset={6} className="z-[70]">
          <Tooltip.Popup className="flex items-center gap-2 rounded-md bg-foreground px-2 py-1 text-xs text-background shadow-md">
            <span>{label}</span>
            {kbd && <kbd className="rounded bg-background/20 px-1 font-mono text-[10px]">{kbd}</kbd>}
          </Tooltip.Popup>
        </Tooltip.Positioner>
      </Tooltip.Portal>
    </Tooltip.Root>
  );
}

const HEIGHTS: { id: RowHeight; label: string; kbd: string; lines: number }[] = [
  { id: "compact", label: "Compacte", kbd: "Alt+1", lines: 4 },
  { id: "normal", label: "Normale", kbd: "Alt+2", lines: 3 },
  { id: "tall", label: "Haute", kbd: "Alt+3", lines: 2 },
];

function HeightIcon({ lines }: { lines: number }) {
  const gap = 12 / (lines - 1 || 1);
  return (
    <svg viewBox="0 0 16 16" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" aria-hidden="true">
      {Array.from({ length: lines }, (_, i) => (
        <line key={i} x1="2" x2="14" y1={2 + i * gap} y2={2 + i * gap} />
      ))}
    </svg>
  );
}

// ─── Contrôles d'affichage : menu Colonnes + hauteur de ligne ────────────────

export function DatabaseDisplayControls({
  columns,
  config,
  onChange,
  globalShortcuts = false,
}: {
  columns: DbColumn[];
  config: DisplayConfig;
  onChange: (next: DisplayConfig) => void;
  // Page /bases : raccourcis écoutés sur tout le document. Bloc inline : seulement
  // quand le focus est dans le composant (évite les collisions entre blocs).
  globalShortcuts?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [dragId, setDragId] = useState<string | null>(null);
  const [overId, setOverId] = useState<string | null>(null);
  const handleRefs = useRef<Record<string, HTMLButtonElement | null>>({});
  const rootRef = useRef<HTMLDivElement>(null);

  const configRef = useRef(config);
  useEffect(() => {
    configRef.current = config;
  });

  const byId = useMemo(() => new Map(columns.map((c) => [c.id, c])), [columns]);
  const titleId = columns[0]?.id;
  const order = orderedColumnIds(columns, config);
  const visible = new Set(resolveVisibleColumns(columns, config).map((c) => c.id));
  const hiddenCount = columns.length - visible.size;
  const rowHeight = resolveRowHeight(config);

  // Applique un changement et annonce par toast avec Annuler (restaure l'état précédent).
  const apply = (next: DisplayConfig, message: string) => {
    const previous = configRef.current;
    onChange(next);
    toast(message, { action: { label: "Annuler", onClick: () => onChange(previous) } });
  };

  const setHeight = (id: RowHeight) => {
    if (id === rowHeight) return;
    const h = HEIGHTS.find((x) => x.id === id)!;
    apply({ ...configRef.current, rowHeight: id }, `Hauteur de ligne ${h.label.toLowerCase()}`);
  };

  const toggle = (id: string) => {
    const col = byId.get(id);
    if (!col) return;
    if (id === titleId) {
      toast("La colonne titre ne peut pas être masquée");
      return;
    }
    const nowHidden = visible.has(id);
    apply(
      toggleColumnVisibility(columns, configRef.current, id),
      `Colonne ${col.name} ${nowHidden ? "masquée" : "affichée"}`,
    );
  };

  const setAll = (show: boolean) => {
    const already = show ? hiddenCount === 0 : visible.size === 1;
    if (already) {
      toast(show ? "Toutes les colonnes sont déjà affichées" : "Toutes les colonnes sont déjà masquées");
      return;
    }
    apply(
      setAllColumnsVisible(columns, configRef.current, show),
      show ? "Toutes les colonnes affichées" : "Toutes les colonnes masquées sauf le titre",
    );
  };

  const shift = (id: string, delta: -1 | 1) => {
    const next = shiftColumn(columns, configRef.current, id, delta);
    if (!next) {
      toast(delta < 0 ? "Déjà en première position" : "Déjà en dernière position");
      return;
    }
    apply(next, `Colonne ${byId.get(id)?.name ?? ""} déplacée`);
    requestAnimationFrame(() => handleRefs.current[id]?.focus());
  };

  const drop = (fromId: string, beforeId: string) => {
    const next = moveColumn(columns, configRef.current, fromId, beforeId);
    if (next === configRef.current) return;
    apply(next, `Colonne ${byId.get(fromId)?.name ?? ""} déplacée`);
  };

  // Raccourcis Alt+C (menu) et Alt+1/2/3 (hauteur de ligne).
  const onKey = (e: KeyboardEvent | React.KeyboardEvent) => {
    if (!e.altKey || e.ctrlKey || e.metaKey || e.shiftKey) return;
    if (e.code === "KeyC") {
      e.preventDefault();
      setOpen((o) => !o);
    } else if (e.code === "Digit1") {
      e.preventDefault();
      setHeight("compact");
    } else if (e.code === "Digit2") {
      e.preventDefault();
      setHeight("normal");
    } else if (e.code === "Digit3") {
      e.preventDefault();
      setHeight("tall");
    }
  };
  const onKeyRef = useRef(onKey);
  useEffect(() => {
    onKeyRef.current = onKey;
  });
  useEffect(() => {
    if (!globalShortcuts) return;
    const handler = (e: KeyboardEvent) => onKeyRef.current(e);
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [globalShortcuts]);

  const term = query.trim().toLowerCase();
  const items = order.filter((id) => !term || (byId.get(id)?.name ?? "").toLowerCase().includes(term));

  return (
    <Tooltip.Provider delay={300}>
      <div
        ref={rootRef}
        className="flex items-center gap-1"
        onKeyDown={globalShortcuts ? undefined : (e) => onKey(e)}
      >
        <Popover
          open={open}
          onOpenChange={(o) => {
            setOpen(o);
            if (o) setQuery("");
          }}
        >
          <Tip label="Colonnes" kbd="Alt+C">
            <PopoverTrigger
              render={
                <Button
                  variant={open || hiddenCount > 0 ? "secondary" : "ghost"}
                  size="xs"
                  className="min-h-6 min-w-6"
                  aria-label={hiddenCount > 0 ? `Colonnes, ${hiddenCount} ${hiddenCount > 1 ? "masquées" : "masquée"}` : "Colonnes"}
                />
              }
            >
              <Columns3 className="h-3.5 w-3.5" />
              {hiddenCount > 0 && (
                <span className="text-[10px] font-semibold">
                  {hiddenCount} {hiddenCount > 1 ? "masquées" : "masquée"}
                </span>
              )}
            </PopoverTrigger>
          </Tip>
          <PopoverContent align="end" sideOffset={6} className="w-72 p-0" aria-label="Colonnes affichées">
            <div className="flex items-center gap-1.5 border-b border-border px-2 py-1.5">
              <Search className="h-3.5 w-3.5 text-muted-foreground" aria-hidden="true" />
              <input
                autoFocus
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Rechercher une colonne"
                aria-label="Rechercher une colonne"
                className="h-6 flex-1 bg-transparent text-xs outline-none placeholder:text-muted-foreground focus-visible:ring-0"
              />
            </div>
            <ul className="max-h-72 overflow-auto py-1" aria-label="Liste des colonnes">
              {items.length === 0 && (
                <li className="px-3 py-2 text-xs text-muted-foreground">Aucune colonne ne correspond à « {query} »</li>
              )}
              {items.map((id) => {
                const col = byId.get(id)!;
                const locked = id === titleId;
                const checked = visible.has(id);
                return (
                  <li
                    key={id}
                    draggable={!locked}
                    onDragStart={(e) => {
                      setDragId(id);
                      e.dataTransfer.setData("text/plain", id);
                      e.dataTransfer.effectAllowed = "move";
                    }}
                    onDragEnd={() => {
                      setDragId(null);
                      setOverId(null);
                    }}
                    onDragOver={(e) => {
                      if (locked || !dragId) return;
                      e.preventDefault();
                      setOverId(id);
                    }}
                    onDragLeave={() => setOverId((o) => (o === id ? null : o))}
                    onDrop={(e) => {
                      e.preventDefault();
                      const from = e.dataTransfer.getData("text/plain");
                      setDragId(null);
                      setOverId(null);
                      if (from && !locked) drop(from, id);
                    }}
                    className={`flex items-center gap-1 px-1 ${dragId === id ? "opacity-40" : ""} ${overId === id ? "border-t-2 border-primary" : ""}`}
                  >
                    {locked ? (
                      <span className="flex h-6 w-6 items-center justify-center text-muted-foreground/40" aria-hidden="true">
                        <GripVertical className="h-3.5 w-3.5" />
                      </span>
                    ) : (
                      <Tip label="Glisser, ou flèches Haut et Bas" >
                        <button
                          type="button"
                          ref={(el) => {
                            handleRefs.current[id] = el;
                          }}
                          aria-label={`Déplacer la colonne ${col.name}`}
                          className="flex h-6 w-6 cursor-grab items-center justify-center rounded text-muted-foreground hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring"
                          onKeyDown={(e) => {
                            if (e.key === "ArrowUp" || e.key === "ArrowDown") {
                              e.preventDefault();
                              shift(id, e.key === "ArrowUp" ? -1 : 1);
                            }
                          }}
                        >
                          <GripVertical className="h-3.5 w-3.5" />
                        </button>
                      </Tip>
                    )}
                    <Tip label={locked ? "La colonne titre reste toujours visible : elle identifie chaque ligne." : `${checked ? "Masquer" : "Afficher"} ${col.name}`}>
                      <label className="flex min-h-6 flex-1 cursor-pointer items-center gap-2 rounded px-1 text-xs hover:bg-muted">
                        <input
                          type="checkbox"
                          checked={checked}
                          aria-disabled={locked || undefined}
                          aria-label={locked ? `${col.name}, colonne titre, toujours visible` : col.name}
                          onChange={() => toggle(id)}
                          onClick={(e) => {
                            if (locked) e.preventDefault();
                          }}
                          className="h-3.5 w-3.5 accent-[var(--primary)] focus-visible:ring-2 focus-visible:ring-ring"
                        />
                        <span className="text-muted-foreground" aria-hidden="true">{COLUMN_TYPE_ICONS[col.type]}</span>
                        <span className="flex-1 truncate">{col.name}</span>
                        {locked && <Lock className="h-3 w-3 text-muted-foreground" aria-hidden="true" />}
                      </label>
                    </Tip>
                  </li>
                );
              })}
            </ul>
            <div className="flex items-center gap-1 border-t border-border p-1.5">
              <Button variant="ghost" size="xs" className="min-h-6" onClick={() => setAll(true)} aria-label="Tout afficher">
                <Eye className="h-3.5 w-3.5" />
                Tout afficher
              </Button>
              <Button variant="ghost" size="xs" className="min-h-6" onClick={() => setAll(false)} aria-label="Tout masquer sauf le titre">
                <EyeOff className="h-3.5 w-3.5" />
                Tout masquer
              </Button>
            </div>
          </PopoverContent>
        </Popover>

        <div role="radiogroup" aria-label="Hauteur de ligne" className="flex items-center gap-0.5 rounded-md border border-border bg-background p-0.5">
          {HEIGHTS.map((h, i) => (
            <Tip key={h.id} label={`Hauteur ${h.label.toLowerCase()}`} kbd={h.kbd}>
              <button
                type="button"
                role="radio"
                aria-checked={rowHeight === h.id}
                aria-label={`Hauteur de ligne ${h.label.toLowerCase()}`}
                tabIndex={rowHeight === h.id ? 0 : -1}
                onClick={() => setHeight(h.id)}
                onKeyDown={(e) => {
                  const d = e.key === "ArrowRight" || e.key === "ArrowDown" ? 1 : e.key === "ArrowLeft" || e.key === "ArrowUp" ? -1 : 0;
                  if (!d) return;
                  e.preventDefault();
                  const n = HEIGHTS[(i + d + HEIGHTS.length) % HEIGHTS.length];
                  setHeight(n.id);
                  const group = e.currentTarget.parentElement;
                  requestAnimationFrame(() => group?.querySelector<HTMLElement>(`[aria-label="Hauteur de ligne ${n.label.toLowerCase()}"]`)?.focus());
                }}
                className={`flex h-6 min-w-6 items-center justify-center rounded px-1 outline-none focus-visible:ring-2 focus-visible:ring-ring ${
                  rowHeight === h.id ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-muted"
                }`}
              >
                <HeightIcon lines={h.lines} />
              </button>
            </Tip>
          ))}
        </div>
      </div>
    </Tooltip.Provider>
  );
}
