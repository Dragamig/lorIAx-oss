"use client";

import { useCallback, useEffect, useRef, useState, type RefObject } from "react";
import { StaticCanvas } from "fabric";
import {
  RetouchLoadError,
  createPreviewSource,
  exportRecipeBlob,
  loadSourceImage,
  previewSize,
  releaseFilterCaches,
  renderRecipeOn,
  type ExportFormat,
  type LoadedSource,
  type RenderSource,
} from "./render";
import { emptyRecipe, type RetouchRecipe } from "./recipe";

const RENDER_DEBOUNCE_MS = 16;

export interface UseRetouchCanvasOptions {
  /** URL de l'image, même origine (`/api/media/<id>`). */
  url: string;
  canvasRef: RefObject<HTMLCanvasElement | null>;
  onLoaded?: (size: { width: number; height: number }) => void;
}

export interface UseRetouchCanvas {
  ready: boolean;
  error: RetouchLoadError | null;
  retry: () => void;
  setRecipe: (recipe: RetouchRecipe) => void;
  /** Vrai : affiche l'image d'origine (recette neutre), faux : la recette courante. */
  showBefore: (before: boolean) => void;
  exportBlob: (format?: ExportFormat, quality?: number) => Promise<Blob>;
}

/** Un seul canevas d'aperçu ; le rendu est déclenché par recette, anti-rebond de 16 ms. */
export function useRetouchCanvas({ url, canvasRef, onLoaded }: UseRetouchCanvasOptions): UseRetouchCanvas {
  const [ready, setReady] = useState(false);
  const [error, setError] = useState<RetouchLoadError | null>(null);
  const [attempt, setAttempt] = useState(0);
  const fullRef = useRef<LoadedSource | null>(null);
  const previewRef = useRef<RenderSource | null>(null);
  const canvasObj = useRef<StaticCanvas | null>(null);
  const recipeRef = useRef<RetouchRecipe | null>(null);
  const beforeRef = useRef(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const onLoadedRef = useRef(onLoaded);
  useEffect(() => {
    onLoadedRef.current = onLoaded;
  }, [onLoaded]);

  const draw = useCallback(() => {
    const canvas = canvasObj.current;
    const preview = previewRef.current;
    const recipe = recipeRef.current;
    if (!canvas || !preview || !recipe) return;
    const shown = beforeRef.current ? emptyRecipe(recipe.source) : recipe;
    renderRecipeOn(canvas, shown, preview, previewSize(shown));
  }, []);

  const schedule = useCallback(() => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(draw, RENDER_DEBOUNCE_MS);
  }, [draw]);

  useEffect(() => {
    const ac = new AbortController();
    setReady(false);
    setError(null);
    loadSourceImage(url, ac.signal)
      .then((src) => {
        const el = canvasRef.current;
        if (!el || ac.signal.aborted) return;
        fullRef.current = src;
        previewRef.current = createPreviewSource(src);
        canvasObj.current = new StaticCanvas(el, { enableRetinaScaling: false, renderOnAddRemove: false });
        if (!recipeRef.current) recipeRef.current = emptyRecipe({ width: src.width, height: src.height });
        onLoadedRef.current?.({ width: src.width, height: src.height });
        setReady(true);
        draw();
      })
      .catch((e: unknown) => {
        if (e instanceof RetouchLoadError && e.code === "aborted") return;
        setError(e instanceof RetouchLoadError ? e : new RetouchLoadError("network", String(e)));
      });
    return () => {
      ac.abort();
      if (timer.current) clearTimeout(timer.current);
      const canvas = canvasObj.current;
      canvasObj.current = null;
      previewRef.current = null;
      fullRef.current = null;
      releaseFilterCaches();
      void canvas?.dispose();
    };
  }, [url, canvasRef, attempt, draw]);

  const setRecipe = useCallback(
    (recipe: RetouchRecipe) => {
      recipeRef.current = recipe;
      schedule();
    },
    [schedule],
  );

  const showBefore = useCallback(
    (before: boolean) => {
      beforeRef.current = before;
      schedule();
    },
    [schedule],
  );

  const exportBlob = useCallback(async (format: ExportFormat = "png", quality = 0.92) => {
    const full = fullRef.current;
    const recipe = recipeRef.current;
    if (!full || !recipe) throw new RetouchLoadError("decode", "Image non chargée");
    return exportRecipeBlob(recipe, full.image, format, quality);
  }, []);

  const retry = useCallback(() => setAttempt((n) => n + 1), []);

  return { ready, error, retry, setRecipe, showBefore, exportBlob };
}
