// Extraction du texte d'un PDF, exécutée dans un worker_thread aux ressources
// bornées (voir extract-pdf.ts). JS pur, jamais bundlé. Mêmes protections que
// pdf-thumbnail-worker.mjs : pas d'eval, pas de script PDF, pas de réseau,
// images embarquées plafonnées (jamais décodées pour du texte).
import { createRequire } from "node:module";
import path from "node:path";
import { parentPort, workerData } from "node:worker_threads";

const MAX_IMAGE_PIXELS = 16_000_000;

function assetDir(name) {
  try {
    const req = createRequire(import.meta.url);
    const root = path.dirname(req.resolve("pdfjs-dist/package.json"));
    return path.join(root, name) + path.sep;
  } catch {
    return undefined;
  }
}

async function extract(data, maxPages, maxChars) {
  const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
  const task = pdfjs.getDocument({
    data,
    isEvalSupported: false,
    enableScripting: false,
    disableFontFace: true,
    useSystemFonts: true,
    useWorkerFetch: false,
    maxImageSize: MAX_IMAGE_PIXELS,
    standardFontDataUrl: assetDir("standard_fonts"),
    cMapUrl: assetDir("cmaps"),
    cMapPacked: true,
    verbosity: 0,
  });
  const doc = await task.promise;
  const pages = doc.numPages;
  const limit = Math.min(pages, maxPages);
  let truncated = pages > maxPages;
  let text = "";
  for (let i = 1; i <= limit; i++) {
    const page = await doc.getPage(i);
    const content = await page.getTextContent();
    let line = "";
    for (const item of content.items) {
      if (typeof item.str !== "string") continue;
      line += item.str;
      line += item.hasEOL ? "\n" : " ";
    }
    const clean = line.replace(/[ \t]+/g, " ").replace(/ ?\n ?/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
    if (clean) text += (text ? "\n\n" : "") + clean;
    if (text.length >= maxChars) {
      truncated = true;
      break;
    }
  }
  if (text.length > maxChars) {
    text = text.slice(0, maxChars);
    truncated = true;
  }
  return { text, pages, truncated };
}

extract(new Uint8Array(workerData.data), workerData.maxPages, workerData.maxChars)
  .then((r) => parentPort.postMessage({ ok: true, ...r }))
  .catch(() => parentPort.postMessage({ ok: false }));
