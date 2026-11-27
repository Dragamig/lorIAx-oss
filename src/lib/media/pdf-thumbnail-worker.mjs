// Rendu de la 1re page d'un PDF, exécuté dans un worker_thread aux ressources
// bornées (voir pdf-thumbnail.ts). Fichier JS pur : chargé tel quel par Node,
// jamais traité par le bundler, donc identique en test, en dev et en production.
import { createRequire } from "node:module";
import path from "node:path";
import { parentPort, workerData } from "node:worker_threads";

/** Image embarquée au-delà de 16 Mpx : ignorée par pdfjs avant tout décodage. */
const MAX_IMAGE_PIXELS = 16_000_000;
/** Aire de canvas maximale (octets, 4 par pixel) acceptée par pdfjs. */
const CANVAS_MAX_AREA_BYTES = 64 * 1024 * 1024;
/** Page 1 plus grande que 200 pouces de côté (14 400 points) : pas de rendu. */
const MAX_PAGE_POINTS = 14_400;
/** Hauteur de rendu maximale en pixels (page très haute : échelle réduite). */
const MAX_RENDER_HEIGHT = 1_920;

function assetDir(name) {
  try {
    const req = createRequire(import.meta.url);
    const root = path.dirname(req.resolve("pdfjs-dist/package.json"));
    return path.join(root, name) + path.sep;
  } catch {
    return undefined;
  }
}

async function render(data, width) {
  const [pdfjs, canvasMod, sharpMod] = await Promise.all([
    import("pdfjs-dist/legacy/build/pdf.mjs"),
    import("@napi-rs/canvas"),
    import("sharp"),
  ]);
  const sharp = sharpMod.default;
  const { createCanvas } = canvasMod;
  // pdfjs trace les chemins avec Path2D, absent de node-canvas : @napi-rs/canvas
  // fournit Path2D, DOMMatrix, ImageData.
  globalThis.Path2D ??= canvasMod.Path2D;
  globalThis.DOMMatrix ??= canvasMod.DOMMatrix;
  globalThis.ImageData ??= canvasMod.ImageData;

  const canvasFactory = {
    create(w, h) {
      const canvas = createCanvas(Math.max(1, w), Math.max(1, h));
      return { canvas, context: canvas.getContext("2d") };
    },
    reset(target, w, h) {
      target.canvas.width = Math.max(1, w);
      target.canvas.height = Math.max(1, h);
    },
    destroy(target) {
      if (target.canvas) {
        target.canvas.width = 0;
        target.canvas.height = 0;
      }
      target.canvas = null;
    },
  };

  const task = pdfjs.getDocument({
    data,
    isEvalSupported: false,
    enableScripting: false,
    disableFontFace: true,
    useSystemFonts: true,
    useWorkerFetch: false,
    maxImageSize: MAX_IMAGE_PIXELS,
    canvasMaxAreaInBytes: CANVAS_MAX_AREA_BYTES,
    standardFontDataUrl: assetDir("standard_fonts"),
    cMapUrl: assetDir("cmaps"),
    cMapPacked: true,
    verbosity: 0,
    CanvasFactory: function () {
      return canvasFactory;
    },
  });
  const doc = await task.promise;
  const pageCount = doc.numPages;
  const page = await doc.getPage(1);
  const base = page.getViewport({ scale: 1 });
  if (
    !(base.width > 0 && base.height > 0) ||
    base.width > MAX_PAGE_POINTS ||
    base.height > MAX_PAGE_POINTS
  ) {
    return null;
  }
  const scale = Math.min(width / base.width, MAX_RENDER_HEIGHT / base.height);
  const viewport = page.getViewport({ scale });
  const w = Math.max(1, Math.round(viewport.width));
  const h = Math.max(1, Math.round(viewport.height));
  const canvas = createCanvas(w, h);
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, w, h);
  await page.render({ canvasContext: ctx, viewport, canvas }).promise;
  const webp = await sharp(await canvas.encode("png")).webp({ quality: 80 }).toBuffer();
  return { webp, width: w, height: h, pageCount };
}

render(new Uint8Array(workerData.data), workerData.width)
  .then((r) => parentPort.postMessage(r ? { ok: true, ...r } : { ok: false }))
  .catch(() => parentPort.postMessage({ ok: false }));
