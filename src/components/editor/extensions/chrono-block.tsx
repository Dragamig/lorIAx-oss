"use client";

import { useState, useEffect, useCallback } from "react";
import { NodeViewWrapper } from "@tiptap/react";
import type { NodeViewProps } from "@tiptap/core";
import { Play, Pause, RotateCcw, Pencil, Check, X, Trash2, Timer, Lock, LockOpen } from "lucide-react";
import { stopMouse } from "../utils/stop-mouse";

// ── Formatage durée ─────────────────────────────────────────────────────────

function pad(n: number): string {
  return String(n).padStart(2, "0");
}

/** ms → "HH:MM:SS". */
function formatDuration(ms: number): string {
  const totalSec = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(totalSec / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  const s = totalSec % 60;
  return `${pad(h)}:${pad(m)}:${pad(s)}`;
}

/** "HH:MM:SS" | "MM:SS" | "SS" → ms, ou null si invalide. */
function parseDuration(input: string): number | null {
  const trimmed = input.trim();
  if (!trimmed) return null;
  const parts = trimmed.split(":").map((p) => p.trim());
  if (parts.length > 3) return null;
  const nums = parts.map((p) => Number(p));
  if (nums.some((n) => !Number.isFinite(n) || n < 0)) return null;
  let h = 0,
    m = 0,
    s = 0;
  if (nums.length === 3) [h, m, s] = nums;
  else if (nums.length === 2) [m, s] = nums;
  else [s] = nums;
  return ((h * 60 + m) * 60 + s) * 1000;
}

// ── Composant ────────────────────────────────────────────────────────────────

export function ChronoBlockView({ node, updateAttributes, deleteNode, editor }: NodeViewProps) {
  const running: boolean = !!node.attrs.running;
  const accumulatedMs: number = Number(node.attrs.accumulatedMs) || 0;
  const startedAt: number | null = node.attrs.startedAt ?? null;
  const label: string = node.attrs.label ?? "";
  const frozen: boolean = !!node.attrs.frozen;
  const editable = editor.isEditable;

  // Tick local : ms écoulées depuis le dernier démarrage, rafraîchies chaque
  // seconde par le seul callback d'intervalle (jamais au rendu, jamais
  // synchroniquement dans l'effet → pas d'appel impur, pas de thrash Yjs).
  const [liveMs, setLiveMs] = useState(0);
  useEffect(() => {
    if (!running || startedAt == null) return;
    const id = setInterval(() => setLiveMs(Math.max(0, Date.now() - startedAt)), 250);
    return () => clearInterval(id);
  }, [running, startedAt]);

  const elapsedMs = accumulatedMs + (running ? liveMs : 0);

  // Édition manuelle
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");

  const start = useCallback(() => {
    updateAttributes({ running: true, startedAt: Date.now() });
  }, [updateAttributes]);

  const stop = useCallback(() => {
    const frozen = accumulatedMs + (startedAt != null ? Date.now() - startedAt : 0);
    updateAttributes({ running: false, startedAt: null, accumulatedMs: frozen });
  }, [updateAttributes, accumulatedMs, startedAt]);

  const reset = useCallback(() => {
    updateAttributes({ running: false, startedAt: null, accumulatedMs: 0, frozen: false });
  }, [updateAttributes]);

  const freeze = useCallback(() => {
    const frozen_ms = accumulatedMs + (startedAt != null ? Date.now() - startedAt : 0);
    updateAttributes({ running: false, startedAt: null, accumulatedMs: frozen_ms, frozen: true });
  }, [updateAttributes, accumulatedMs, startedAt]);

  const unfreeze = useCallback(() => {
    updateAttributes({ frozen: false });
  }, [updateAttributes]);

  const openEdit = useCallback(() => {
    setDraft(formatDuration(elapsedMs));
    setEditing(true);
  }, [elapsedMs]);

  const confirmEdit = useCallback(() => {
    const ms = parseDuration(draft);
    if (ms == null) return;
    // L'édition manuelle stoppe le chrono et fixe la durée.
    updateAttributes({ running: false, startedAt: null, accumulatedMs: ms });
    setEditing(false);
  }, [draft, updateAttributes]);

  return (
    <NodeViewWrapper
      className="chrono-block my-2 inline-flex max-w-full items-center gap-3 rounded-lg border bg-card px-3 py-2"
      data-type="chrono-block"
    >
      <Timer className="h-4 w-4 shrink-0 text-muted-foreground" />

      <div className="flex min-w-0 flex-col">
        {editable ? (
          <input
            value={label}
            onChange={(e) => updateAttributes({ label: e.target.value })}
            onMouseDown={stopMouse}
            placeholder="Sans titre"
            className="w-32 truncate border-none bg-transparent text-xs text-muted-foreground outline-none placeholder:text-muted-foreground/50"
          />
        ) : (
          label && <span className="truncate text-xs text-muted-foreground">{label}</span>
        )}

        {editing ? (
          <div className="flex items-center gap-1">
            <input
              autoFocus
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onMouseDown={stopMouse}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  confirmEdit();
                } else if (e.key === "Escape") {
                  setEditing(false);
                }
              }}
              placeholder="HH:MM:SS"
              className="w-28 rounded border bg-background px-1.5 py-0.5 font-mono text-lg tabular-nums outline-none"
            />
            <button onClick={confirmEdit} className="rounded p-1 hover:bg-accent" aria-label="Valider">
              <Check className="h-3.5 w-3.5 text-emerald-600" />
            </button>
            <button onClick={() => setEditing(false)} className="rounded p-1 hover:bg-accent" aria-label="Annuler">
              <X className="h-3.5 w-3.5 text-muted-foreground" />
            </button>
          </div>
        ) : (
          <span className="font-mono text-lg font-semibold tabular-nums" aria-live="polite">
            {formatDuration(elapsedMs)}
          </span>
        )}
      </div>

      {editable && !editing && (
        <div className="flex shrink-0 items-center gap-0.5">
          {frozen ? (
            <>
              <Lock className="h-3.5 w-3.5 text-muted-foreground" />
              <button
                onClick={unfreeze}
                className="inline-flex items-center gap-1 rounded bg-sky-100 px-2 py-1 text-xs font-medium text-sky-800 hover:bg-sky-200 dark:bg-sky-900/40 dark:text-sky-200"
                title="Libérer le chrono"
              >
                <LockOpen className="h-3.5 w-3.5" /> Libérer
              </button>
            </>
          ) : (
            <>
              {running ? (
                <button
                  onClick={stop}
                  className="inline-flex items-center gap-1 rounded bg-amber-100 px-2 py-1 text-xs font-medium text-amber-800 hover:bg-amber-200 dark:bg-amber-900/40 dark:text-amber-200"
                >
                  <Pause className="h-3.5 w-3.5" /> Arrêter
                </button>
              ) : (
                <button
                  onClick={start}
                  className="inline-flex items-center gap-1 rounded bg-emerald-100 px-2 py-1 text-xs font-medium text-emerald-800 hover:bg-emerald-200 dark:bg-emerald-900/40 dark:text-emerald-200"
                >
                  <Play className="h-3.5 w-3.5" /> Démarrer
                </button>
              )}
              <button
                onClick={freeze}
                className="rounded p-1 text-muted-foreground hover:bg-accent"
                aria-label="Figer le chrono"
                title="Figer (verrouiller la valeur)"
              >
                <Lock className="h-3.5 w-3.5" />
              </button>
            </>
          )}
          {!frozen && (
            <>
              <button onClick={openEdit} className="rounded p-1 text-muted-foreground hover:bg-accent" aria-label="Éditer la durée" title="Éditer manuellement">
                <Pencil className="h-3.5 w-3.5" />
              </button>
              <button onClick={reset} className="rounded p-1 text-muted-foreground hover:bg-accent" aria-label="Réinitialiser" title="Réinitialiser">
                <RotateCcw className="h-3.5 w-3.5" />
              </button>
            </>
          )}
          <button onClick={() => deleteNode()} className="rounded p-1 text-muted-foreground hover:bg-accent hover:text-destructive" aria-label="Supprimer" title="Supprimer">
            <Trash2 className="h-3.5 w-3.5" />
          </button>
        </div>
      )}
    </NodeViewWrapper>
  );
}
