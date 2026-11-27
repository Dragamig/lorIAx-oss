"use client";

import { useEffect, useRef, useState, type ReactNode, type RefObject } from "react";
import { useTranslations } from "next-intl";
import { AlertTriangle, Lock } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import { ActionButton } from "../action-button";
import type { RetouchLoadError } from "./render";

const FALLBACK_BOX = { width: 640, height: 400 };

/** Taille disponible du conteneur, suivie à chaque redimensionnement (valeurs par défaut hors navigateur). */
function useBox(ref: RefObject<HTMLElement | null>) {
  const [box, setBox] = useState(FALLBACK_BOX);
  useEffect(() => {
    const el = ref.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const read = () => {
      const w = el.clientWidth;
      const h = el.clientHeight;
      if (w > 0 && h > 0) setBox({ width: w, height: h });
    };
    read();
    const ro = new ResizeObserver(read);
    ro.observe(el);
    return () => ro.disconnect();
  }, [ref]);
  return box;
}

export interface RetouchStageProps {
  canvasRef: RefObject<HTMLCanvasElement | null>;
  /** Dimensions naturelles de ce qui est affiché (sortie, ou image d'origine en comparaison). */
  natural: { width: number; height: number } | null;
  /** Pourcentage de zoom ; `null` : ajusté à la fenêtre. */
  zoom: number | null;
  loading: boolean;
  error: RetouchLoadError | null;
  onRetry: () => void;
  readOnly: boolean;
  outputLabel: string | null;
  comparing: boolean;
  /** Superposition de recadrage, posée sur l'image. */
  overlay?: ReactNode;
  /** Reçoit le pourcentage réellement affiché. */
  onScale?: (percent: number) => void;
}

/** Zone centrale : canevas d'aperçu à l'échelle choisie, états de chargement et d'erreur. */
export function RetouchStage({
  canvasRef,
  natural,
  zoom,
  loading,
  error,
  onRetry,
  readOnly,
  outputLabel,
  comparing,
  overlay,
  onScale,
}: RetouchStageProps) {
  const t = useTranslations("library.retouch");
  const hostRef = useRef<HTMLDivElement>(null);
  const box = useBox(hostRef);
  const nat = natural ?? { width: 1, height: 1 };
  const fit = Math.min((box.width - 32) / nat.width, (box.height - 32) / nat.height, 1);
  const scale = zoom === null ? Math.max(0.01, fit) : zoom / 100;
  const width = Math.max(1, Math.round(nat.width * scale));
  const height = Math.max(1, Math.round(nat.height * scale));
  const percent = Math.round(scale * 100);
  useEffect(() => onScale?.(percent), [percent, onScale]);

  return (
    <div className="relative flex h-full min-h-0 flex-col">
      {readOnly ? (
        <div
          role="status"
          className="bg-muted text-muted-foreground border-border m-2 flex items-center gap-2 rounded-md border px-3 py-1.5 text-xs"
        >
          <Lock className="size-3.5 shrink-0" aria-hidden="true" />
          {t("readOnlyBanner")}
        </div>
      ) : null}
      <div ref={hostRef} className="bg-muted/50 relative flex min-h-0 flex-1 overflow-auto p-4" data-testid="retouch-stage">
        <div
          className="relative m-auto shrink-0 shadow-md ring-1 ring-black/10"
          style={{ width, height, visibility: error ? "hidden" : undefined }}
        >
          <canvas ref={canvasRef} aria-label={comparing ? t("comparing") : undefined} className="block h-full! w-full! bg-white" />
          {overlay}
          {loading && !error ? (
            <div role="status" aria-label={t("loading")} className="absolute inset-0">
              <Skeleton className="h-full w-full rounded-none" />
            </div>
          ) : null}
        </div>
        {error ? (
          <div role="alert" className="absolute inset-0 flex flex-col items-center justify-center gap-3 p-6 text-center">
            <AlertTriangle className="text-destructive size-8" aria-hidden="true" />
            <p className="max-w-sm text-sm">{error.code === "decode" ? t("loadErrorDecode") : t("loadErrorNetwork")}</p>
            <ActionButton id="retryRetouch" variant="outline" size="sm" showLabel onAction={onRetry} />
          </div>
        ) : null}
        {outputLabel ? (
          <span className="bg-card text-muted-foreground border-border absolute bottom-2 left-2 rounded-full border px-2 py-0.5 text-xs">
            {outputLabel}
          </span>
        ) : null}
      </div>
    </div>
  );
}
