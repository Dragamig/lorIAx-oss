import { Canvas2dFilterBackend, FabricImage, StaticCanvas, getFilterBackend, setFilterBackend } from "fabric";
import type { Canvas as FabricCanvas } from "fabric";
import { dataUrlToBlob, rasterDataUrl } from "@/components/editor/extensions/design-export";
import { buildFabricFilters } from "./filters";
import { drawOverlays } from "./overlays-draw";
import { PREVIEW_MAX_SIDE } from "./limits";
import { outputSize, type RetouchRecipe } from "./recipe";

export type RetouchLoadErrorCode = "network" | "decode" | "origin" | "aborted";

export class RetouchLoadError extends Error {
  constructor(
    public code: RetouchLoadErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "RetouchLoadError";
  }
}

export type RenderSource = CanvasImageSource & { width: number; height: number };

export interface LoadedSource {
  image: HTMLImageElement;
  /** Dimensions naturelles (orientation EXIF déjà appliquée par le navigateur). */
  width: number;
  height: number;
}

function sameOrigin(url: string): boolean {
  try {
    const base = typeof window !== "undefined" ? window.location.href : "http://localhost/";
    return new URL(url, base).origin === new URL(base).origin;
  } catch {
    return false;
  }
}

/**
 * Charge l'image source en lecture seule. Même origine exigée (`/api/media/<id>`) : un canevas
 * « tainted » interdirait l'export. L'orientation EXIF est appliquée par le navigateur.
 */
export function loadSourceImage(url: string, signal: AbortSignal): Promise<LoadedSource> {
  return new Promise((resolve, reject) => {
    if (!sameOrigin(url)) {
      reject(new RetouchLoadError("origin", "L'image doit provenir de la même origine"));
      return;
    }
    if (signal.aborted) {
      reject(new RetouchLoadError("aborted", "Chargement annulé"));
      return;
    }
    const img = new Image();
    const cleanup = () => {
      signal.removeEventListener("abort", onAbort);
      img.onload = null;
      img.onerror = null;
    };
    const onAbort = () => {
      cleanup();
      img.src = "";
      reject(new RetouchLoadError("aborted", "Chargement annulé"));
    };
    signal.addEventListener("abort", onAbort, { once: true });
    img.onload = () => {
      cleanup();
      if (!img.naturalWidth || !img.naturalHeight) {
        reject(new RetouchLoadError("decode", "Image illisible"));
        return;
      }
      resolve({ image: img, width: img.naturalWidth, height: img.naturalHeight });
    };
    img.onerror = () => {
      cleanup();
      reject(new RetouchLoadError("decode", "Image illisible"));
    };
    img.src = url;
  });
}

/** Facteur de réduction de la copie de travail (1 = pas de réduction). */
export function previewScale(width: number, height: number, maxSide = PREVIEW_MAX_SIDE): number {
  return Math.min(1, maxSide / Math.max(width, height));
}

/** Copie de travail de l'aperçu : réduite à `PREVIEW_MAX_SIDE`, sinon l'image elle-même. */
export function createPreviewSource(src: LoadedSource, maxSide = PREVIEW_MAX_SIDE): RenderSource {
  const k = previewScale(src.width, src.height, maxSide);
  if (k >= 1) return src.image;
  const c = document.createElement("canvas");
  c.width = Math.max(1, Math.round(src.width * k));
  c.height = Math.max(1, Math.round(src.height * k));
  const ctx = c.getContext("2d");
  if (!ctx) throw new RetouchLoadError("decode", "Canevas 2D indisponible");
  ctx.drawImage(src.image, 0, 0, c.width, c.height);
  return c;
}

/** Taille de sortie de l'aperçu : taille de la recette ramenée à `PREVIEW_MAX_SIDE`. */
export function previewSize(r: RetouchRecipe, maxSide = PREVIEW_MAX_SIDE): { width: number; height: number } {
  const o = outputSize(r);
  const k = previewScale(o.width, o.height, maxSide);
  return { width: Math.max(1, Math.round(o.width * k)), height: Math.max(1, Math.round(o.height * k)) };
}

/** Facteur d'agrandissement pour qu'une image tournée de `angle` degrés couvre tout le cadre. */
export function coverScale(angle: number, width: number, height: number): number {
  const a = (Math.abs(angle) * Math.PI) / 180;
  if (a === 0) return 1;
  return Math.cos(a) + Math.sin(a) * Math.max(width / height, height / width);
}

/** Libère les textures WebGL en cache (sans effet avec le backend Canvas 2D). */
export function releaseFilterCaches(): void {
  const backend = getFilterBackend(false) as { clearWebGLCaches?: () => void } | undefined;
  backend?.clearWebGLCaches?.();
}

/** Libère la texture WebGL (clé de cache) et l'élément des images Fabric du rendu précédent. */
function releaseCanvasImages(canvas: StaticCanvas | FabricCanvas): void {
  const backend = getFilterBackend(false) as { evictCachesForKey?: (k: string) => void } | undefined;
  for (const o of canvas.getObjects()) {
    if (o instanceof FabricImage) {
      backend?.evictCachesForKey?.(o.cacheKey);
      o.dispose();
    }
  }
}

/**
 * Rend la recette sur un canevas statique de la taille `size`. La source n'est jamais modifiée.
 * Les calques (texte, formes) sont posés par `overlays-draw.ts` en fractions de la taille `size` :
 * aperçu et export donnent la même composition.
 */
export function renderRecipeOn(
  canvas: StaticCanvas | FabricCanvas,
  recipe: RetouchRecipe,
  source: RenderSource,
  size: { width: number; height: number },
  opts: { background?: string } = {},
): FabricImage {
  const sw = source.width;
  const sh = source.height;
  const cw = Math.max(1, recipe.crop.w * sw);
  const ch = Math.max(1, recipe.crop.h * sh);
  const odd = recipe.quarterTurns % 2 === 1;
  releaseCanvasImages(canvas);
  canvas.setDimensions({ width: size.width, height: size.height });
  canvas.backgroundColor = opts.background ?? "";
  canvas.clear();
  if (opts.background !== undefined) canvas.backgroundColor = opts.background;

  const cover = coverScale(recipe.angle, size.width, size.height);
  const img = new FabricImage(source as HTMLImageElement, {
    cropX: recipe.crop.x * sw,
    cropY: recipe.crop.y * sh,
    width: cw,
    height: ch,
    originX: "center",
    originY: "center",
    left: size.width / 2,
    top: size.height / 2,
    scaleX: ((odd ? size.height : size.width) / cw) * cover,
    scaleY: ((odd ? size.width : size.height) / ch) * cover,
    flipX: recipe.flipH,
    flipY: recipe.flipV,
    angle: recipe.quarterTurns * 90 + recipe.angle,
    selectable: false,
    evented: false,
  });
  img.filters = buildFabricFilters(recipe.adjustments, { blur: recipe.blur, sharpen: recipe.sharpen }, recipe.preset);
  if (img.filters.length > 0) img.applyFilters();
  canvas.add(img);
  drawOverlays(canvas, recipe.layers, size);
  canvas.renderAll();
  return img;
}

export type ExportFormat = "png" | "jpeg" | "webp";

let webpSupport: boolean | undefined;

/** Vrai si le navigateur encode réellement le WebP (Safari rend un PNG). Résultat mis en cache. */
export function canEncodeWebp(refresh = false): boolean {
  if (webpSupport !== undefined && !refresh) return webpSupport;
  try {
    const c = document.createElement("canvas");
    c.width = 1;
    c.height = 1;
    webpSupport = c.toDataURL("image/webp").startsWith("data:image/webp");
  } catch {
    webpSupport = false;
  }
  return webpSupport;
}

/**
 * Rejoue la recette hors écran à la taille de sortie (plafonnée à 8 192 px et 24 Mpx par
 * `outputSize`) puis encode. Le canevas, l'image Fabric et les textures sont libérés dans `finally`.
 */
export async function exportRecipeBlob(
  recipe: RetouchRecipe,
  source: RenderSource,
  format: ExportFormat = "png",
  quality = 0.92,
): Promise<Blob> {
  const size = outputSize(recipe);
  const el = document.createElement("canvas");
  const canvas = new StaticCanvas(el, { enableRetinaScaling: false, renderOnAddRemove: false });
  // Le backend WebGL lit mal au-delà de `textureSize` (4096) : l'export passe par Canvas 2D.
  const previousBackend = getFilterBackend(false);
  setFilterBackend(new Canvas2dFilterBackend());
  try {
    renderRecipeOn(canvas, recipe, source, size, { background: format === "jpeg" ? "#ffffff" : undefined });
    if (format === "webp") {
      // rasterDataUrl ne connaît que png et jpeg : webp passe par toDataURL direct.
      const url = canvas.toDataURL({ format: "webp" as never, quality, multiplier: 1 });
      return dataUrlToBlob(url);
    }
    const url = rasterDataUrl(canvas as unknown as FabricCanvas, {
      format,
      dpi: 96,
      zoomPercent: 100,
      transparent: format === "png",
      title: "retouche",
      quality,
    });
    return dataUrlToBlob(url);
  } finally {
    releaseCanvasImages(canvas);
    if (previousBackend) setFilterBackend(previousBackend);
    releaseFilterCaches();
    try {
      await canvas.dispose();
    } finally {
      el.width = 0;
      el.height = 0;
    }
  }
}
