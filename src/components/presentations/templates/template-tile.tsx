"use client";

import type { ReactNode } from "react";
import { Hint } from "@/components/ui/hint";
import { cn } from "@/lib/utils";
import { TemplateBadge, type TemplateBadgeKind } from "./template-badge";

/**
 * Gabarit unique des tuiles (règle du 08/11/2026) : largeur, hauteur et pied
 * fixes, définis une seule fois. Toute grille de modèles ou de présentations
 * utilise `TEMPLATE_GRID_CLASS` et `TemplateTile`.
 */
export const TEMPLATE_GRID_CLASS = "grid grid-cols-[repeat(auto-fill,minmax(200px,1fr))] gap-4";
export const TEMPLATE_TILE_CLASS =
  "relative flex h-56 w-full flex-col overflow-hidden rounded-lg border border-border bg-card p-0 text-left";
export const TEMPLATE_TILE_FOOT_CLASS =
  "flex h-16 min-w-0 flex-none flex-col justify-center gap-0.5 overflow-hidden px-2.5 py-2";

interface Props {
  title: string;
  subtitle?: string;
  badge?: TemplateBadgeKind;
  /** Vignette (zone haute, hauteur libre dans le reste de la tuile). */
  thumbnail?: ReactNode;
  /** Texte de l'info-bulle (relié par aria-describedby). Le nom accessible est le titre. */
  tip: string;
  ariaLabel?: string;
  onClick?: () => void;
  selected?: boolean;
  /** Tuile « vierge » : vignette pointillée. */
  blank?: boolean;
}

export function TemplateTile({
  title,
  subtitle,
  badge,
  thumbnail,
  tip,
  ariaLabel,
  onClick,
  selected = false,
  blank = false,
}: Props) {
  return (
    <Hint label={tip} className="w-full">
      <button
        type="button"
        aria-label={ariaLabel ?? title}
        aria-pressed={selected || undefined}
        onClick={onClick}
        data-template-tile=""
        className={cn(
          TEMPLATE_TILE_CLASS,
          "cursor-pointer outline-none transition-colors hover:border-primary focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50",
          selected && "border-ring ring-2 ring-ring"
        )}
      >
        <span
          className={cn(
            "flex min-h-0 flex-1 items-center justify-center overflow-hidden",
            blank && "border-b border-dashed border-border bg-muted text-muted-foreground"
          )}
        >
          {thumbnail}
        </span>
        <span className={TEMPLATE_TILE_FOOT_CLASS}>
          <span className="flex min-w-0 items-center gap-1.5 font-semibold">
            {badge ? <TemplateBadge kind={badge} /> : null}
            <span className="min-w-0 truncate">{title}</span>
          </span>
          {subtitle ? (
            <span className="text-muted-foreground block truncate text-xs">{subtitle}</span>
          ) : null}
        </span>
      </button>
    </Hint>
  );
}

/** Tuile de chargement, mêmes dimensions que `TemplateTile`. */
export function TemplateTileSkeleton() {
  return (
    <div aria-hidden="true" data-template-tile="" className={cn(TEMPLATE_TILE_CLASS, "animate-pulse")}>
      <div className="bg-muted min-h-0 flex-1" />
      <div className={TEMPLATE_TILE_FOOT_CLASS}>
        <div className="bg-muted h-3 w-2/3 rounded" />
        <div className="bg-muted mt-1.5 h-2.5 w-1/2 rounded" />
      </div>
    </div>
  );
}
