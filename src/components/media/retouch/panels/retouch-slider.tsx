"use client";

import { useRef, useState, type KeyboardEvent, type PointerEvent } from "react";
import { ActionButton } from "../../action-button";

export interface RetouchSliderProps {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  neutral: number;
  onChange: (value: number) => void;
  /** Texte de l'info-bulle du bouton quand la valeur est déjà neutre. */
  neutralReason: string;
  /** Libellé du bouton de remise à zéro. */
  resetLabel: string;
  /** Libellé du champ numérique. */
  inputLabel: string;
  unit?: string;
}

const decimalsOf = (step: number) => (Number.isInteger(step) ? 0 : String(step).split(".")[1]?.length ?? 0);

/** Curseur accessible : role slider, flèches (Maj ou Page : x10), Début, Fin, glisser, double-clic, champ numérique. */
export function RetouchSlider({
  label,
  value,
  min,
  max,
  step,
  neutral,
  onChange,
  neutralReason,
  resetLabel,
  inputLabel,
  unit = "",
}: RetouchSliderProps) {
  const track = useRef<HTMLDivElement>(null);
  const [draft, setDraft] = useState<string | null>(null);
  const decimals = decimalsOf(step);
  const fmt = (v: number) => v.toFixed(decimals);
  const clamp = (v: number) => Math.min(max, Math.max(min, v));
  const snap = (v: number) => clamp(Math.round((v - min) / step) * step + min);
  const set = (v: number) => {
    const next = Number(fmt(snap(v)));
    if (next !== value) onChange(next);
  };
  const pct = ((value - min) / (max - min)) * 100;
  const neutralPct = ((neutral - min) / (max - min)) * 100;

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    const big = e.shiftKey ? 10 : 1;
    const moves: Record<string, number | undefined> = {
      ArrowRight: step * big,
      ArrowUp: step * big,
      ArrowLeft: -step * big,
      ArrowDown: -step * big,
      PageUp: step * 10,
      PageDown: -step * 10,
    };
    if (e.key === "Home") set(min);
    else if (e.key === "End") set(max);
    else if (moves[e.key] !== undefined) set(value + (moves[e.key] as number));
    else return;
    e.preventDefault();
  };

  const fromPointer = (e: PointerEvent<HTMLDivElement>) => {
    const r = track.current?.getBoundingClientRect();
    if (!r || r.width === 0) return;
    set(min + ((e.clientX - r.left) / r.width) * (max - min));
  };

  const atNeutral = value === neutral;
  return (
    <div className="flex flex-col gap-1.5 py-1.5" data-slider={label}>
      <div className="flex items-center justify-between gap-2 text-xs">
        <span className="text-foreground font-medium">{label}</span>
        <div className="flex items-center gap-1">
          <input
            type="number"
            aria-label={inputLabel}
            min={min}
            max={max}
            step={step}
            value={draft ?? fmt(value)}
            onChange={(e) => {
              setDraft(e.target.value);
              const n = Number(e.target.value);
              if (e.target.value !== "" && Number.isFinite(n)) set(n);
            }}
            onBlur={() => setDraft(null)}
            className="border-input bg-background h-7 w-16 rounded-md border px-1.5 text-right text-xs tabular-nums"
          />
          <ActionButton
            id="resetSlider"
            label={resetLabel}
            size="icon-sm"
            disabledReason={atNeutral ? neutralReason : undefined}
            onAction={() => set(neutral)}
          />
        </div>
      </div>
      <div
        ref={track}
        role="slider"
        tabIndex={0}
        aria-label={label}
        aria-valuemin={min}
        aria-valuemax={max}
        aria-valuenow={value}
        aria-valuetext={`${fmt(value)}${unit}`}
        onKeyDown={onKeyDown}
        onDoubleClick={() => set(neutral)}
        onPointerDown={(e) => {
          e.currentTarget.setPointerCapture?.(e.pointerId);
          fromPointer(e);
        }}
        onPointerMove={(e) => {
          if (e.buttons === 1) fromPointer(e);
        }}
        className="focus-visible:ring-ring/50 relative flex h-6 cursor-pointer touch-none items-center rounded-md outline-none focus-visible:ring-3"
      >
        <div className="bg-muted relative h-1.5 w-full rounded-full">
          <div
            className="bg-primary/70 absolute h-full rounded-full"
            style={{ left: `${Math.min(pct, neutralPct)}%`, width: `${Math.abs(pct - neutralPct)}%` }}
          />
          <div className="bg-border absolute top-[-2px] h-2.5 w-px" style={{ left: `${neutralPct}%` }} />
        </div>
        <div
          className="bg-primary border-background absolute size-4 -translate-x-1/2 rounded-full border-2 shadow"
          style={{ left: `${pct}%` }}
        />
      </div>
    </div>
  );
}
