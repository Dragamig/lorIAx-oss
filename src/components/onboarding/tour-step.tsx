"use client";

// loriax-app/src/components/onboarding/tour-step.tsx
// Étape unitaire du tour guidé : positionne un popover à côté d'une cible (data-tour)
// avec fallback modal centré si la cible n'est pas présente dans le DOM.

import { useEffect, useLayoutEffect, useRef, useState, useCallback } from "react";
import { Button } from "@/components/ui/button";
import { X } from "lucide-react";

export interface TourStepProps {
  title: string;
  body: React.ReactNode;
  targetSelector: string;
  stepNumber: number;
  totalSteps: number;
  onNext: () => void;
  onPrev: () => void;
  onSkip: () => void;
  canAdvance: boolean;
  canGoBack: boolean;
}

type Rect = { top: number; left: number; width: number; height: number } | null;

function findTarget(selector: string): HTMLElement | null {
  if (typeof document === "undefined") return null;
  try {
    return document.querySelector(selector) as HTMLElement | null;
  } catch {
    return null;
  }
}

export function TourStep({
  title,
  body,
  targetSelector,
  stepNumber,
  totalSteps,
  onNext,
  onPrev,
  onSkip,
  canAdvance,
  canGoBack,
}: TourStepProps) {
  const [rect, setRect] = useState<Rect>(null);
  const [missing, setMissing] = useState(false);
  // Hauteur réelle du popover, mesurée après rendu. Une estimation fixe suffit
  // pour le 1er rendu, mais les étapes au texte long dépassent largement 200 px
  // et le popover sortait alors du bas de l'écran, boutons inaccessibles.
  const popoverRef = useRef<HTMLDivElement>(null);
  const [popoverHeight, setPopoverHeight] = useState(200);

  const refresh = useCallback(() => {
    const el = findTarget(targetSelector);
    if (!el) {
      setRect(null);
      setMissing(true);
      return;
    }
    const r = el.getBoundingClientRect();
    setRect({ top: r.top, left: r.left, width: r.width, height: r.height });
    setMissing(false);
    el.scrollIntoView({ block: "center", inline: "center", behavior: "smooth" });
  }, [targetSelector]);

  useEffect(() => {
    refresh();
    const onResize = () => refresh();
    window.addEventListener("resize", onResize);
    window.addEventListener("scroll", onResize, true);
    const interval = window.setInterval(refresh, 500);
    return () => {
      window.removeEventListener("resize", onResize);
      window.removeEventListener("scroll", onResize, true);
      window.clearInterval(interval);
    };
  }, [refresh]);

  useLayoutEffect(() => {
    const h = popoverRef.current?.offsetHeight;
    if (h && Math.abs(h - popoverHeight) > 1) setPopoverHeight(h);
  });

  // Fallback modal centré si pas de cible
  if (missing || !rect) {
    return (
      <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/40">
        <div className="bg-popover text-popover-foreground max-w-md rounded-lg p-6 shadow-lg">
          <div className="flex items-start justify-between gap-2">
            <h3 className="text-lg font-semibold">{title}</h3>
            <button
              onClick={onSkip}
              aria-label="Fermer le tutoriel"
              className="text-muted-foreground hover:text-foreground"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
          <div className="mt-2 text-sm">{body}</div>
          <div className="mt-4 flex items-center justify-between text-xs text-muted-foreground">
            <span>
              Étape {stepNumber}/{totalSteps}
            </span>
            <div className="flex gap-2">
              <Button variant="ghost" size="sm" onClick={onSkip}>
                Passer
              </Button>
              {canGoBack && (
                <Button variant="outline" size="sm" onClick={onPrev}>
                  Précédent
                </Button>
              )}
              <Button size="sm" onClick={onNext} disabled={!canAdvance}>
                Suivant
              </Button>
            </div>
          </div>
        </div>
      </div>
    );
  }

  // Position du popover : préférence en dessous, sinon au-dessus
  const popoverWidth = 360;
  const viewportH = typeof window !== "undefined" ? window.innerHeight : 800;
  const viewportW = typeof window !== "undefined" ? window.innerWidth : 1200;
  const spaceBelow = viewportH - (rect.top + rect.height);
  const placeBelow = spaceBelow > popoverHeight + 16;
  let top = placeBelow ? rect.top + rect.height + 8 : rect.top - popoverHeight - 8;
  // Bornage vertical : quelle que soit la cible, le popover doit rester
  // entièrement dans la fenêtre, sinon les boutons (Précédent / Suivant)
  // deviennent inatteignables et le tour se bloque.
  const maxTop = viewportH - popoverHeight - 8;
  top = Math.max(8, maxTop > 8 ? Math.min(top, maxTop) : 8);
  let left = rect.left + rect.width / 2 - popoverWidth / 2;
  if (left < 8) left = 8;
  if (left + popoverWidth > viewportW - 8) left = viewportW - popoverWidth - 8;

  return (
    <>
      {/* Overlay sans bloquer la cible */}
      <div className="fixed inset-0 z-[9998] pointer-events-none bg-black/20" />
      {/* Spotlight */}
      <div
        className="fixed z-[9998] rounded-md ring-2 ring-primary pointer-events-none transition-all"
        style={{
          top: rect.top - 4,
          left: rect.left - 4,
          width: rect.width + 8,
          height: rect.height + 8,
          boxShadow: "0 0 0 9999px rgba(0,0,0,0.4)",
        }}
      />
      {/* Popover */}
      <div
        ref={popoverRef}
        className="fixed z-[9999] max-h-[calc(100vh-16px)] overflow-y-auto rounded-lg border bg-popover text-popover-foreground p-4 shadow-lg"
        style={{ top, left, width: popoverWidth }}
        role="dialog"
        aria-label={title}
      >
        <div className="flex items-start justify-between gap-2">
          <h3 className="text-sm font-semibold">{title}</h3>
          <button
            onClick={onSkip}
            aria-label="Fermer le tutoriel"
            className="text-muted-foreground hover:text-foreground"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
        <div className="mt-2 text-sm">{body}</div>
        <div className="mt-3 flex items-center justify-between text-xs text-muted-foreground">
          <span>
            Étape {stepNumber}/{totalSteps}
          </span>
          <div className="flex gap-2">
            <Button variant="ghost" size="sm" onClick={onSkip}>
              Passer
            </Button>
            {canGoBack && (
              <Button variant="outline" size="sm" onClick={onPrev}>
                Précédent
              </Button>
            )}
            <Button size="sm" onClick={onNext} disabled={!canAdvance}>
              Suivant
            </Button>
          </div>
        </div>
      </div>
    </>
  );
}
