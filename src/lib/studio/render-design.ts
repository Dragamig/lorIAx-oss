// server-only
//
// Rendu serveur d'un DesignDocument (Studio design) en image, SANS navigateur.
// On rejoue le pipeline Fabric côté Node : `fabric/node` s'appuie sur node-canvas
// (paquet `canvas`) pour rasteriser sur un canvas natif Cairo/Pango. C'est la
// transposition serveur de `exportPdf` (src/components/editor/extensions/design-export.ts).
//
// Fidélité des polices : node-canvas résout les familles via fontconfig sur Linux
// (polices installées dans l'image Docker) ; on enregistre en plus les TTF
// empaquetées (assets/video-fonts) en best-effort. Si une famille manque,
// fontconfig substitue silencieusement — on ne throw JAMAIS pour une police.
//
// À importer UNIQUEMENT côté serveur (Node) : dépend du binaire natif `canvas`.

import type { DesignDocument, DesignPage, PageDimensions, PageFormat } from "@/components/editor/extensions/design-constants";
import { PAGE_FORMATS } from "@/components/editor/extensions/design-constants";
import { assertPublicHostname } from "@/lib/security/url-validator-server";

export type RenderFormat = "png" | "pdf";

export interface RenderResult {
  buffer: Buffer;
  contentType: string;
  ext: string;
}

export interface RenderDesignOptions {
  format?: RenderFormat;
  /** Index de page à rendre en mode PNG (défaut 0, ignoré en PDF). */
  pageIndex?: number;
  /** Facteur de suréchantillonnage (défaut 2). Borné à [0.5, 4]. */
  scale?: number;
}

const MULTIPLIER_MIN = 0.5;
const MULTIPLIER_MAX = 4;
const DEFAULT_SCALE = 2;
/** Délai max de chargement/rasterisation d'une page (images externes incluses). */
const PAGE_RENDER_TIMEOUT_MS = 15_000;
/** Borne dure du nombre de pages rasterisées en PDF (anti-OOM). */
const MAX_PDF_PAGES = 50;

/** Nœud Fabric minimal manipulé lors de la sanitisation SSRF. */
interface FabricNode {
  src?: unknown;
  objects?: unknown;
  backgroundImage?: unknown;
  overlayImage?: unknown;
  [key: string]: unknown;
}

/**
 * Neutralise (ou conserve) une `src` d'objet image avant de la confier à
 * node-canvas, qui la `fetch` à l'exécution.
 * - `data:` URI → embarqué, conservé tel quel.
 * - URL absolue http(s) → validée via `assertPublicHostname` (anti-SSRF /
 *   anti-DNS-rebinding). Si l'hôte est privé/interne → neutralisé ("").
 * - URL relative / autre protocole (`file:`, etc.) → neutralisé ("").
 *   node-canvas ne peut de toute façon pas résoudre une URL relative sans origine.
 * Retourne toujours une valeur sûre : on ne throw jamais (dégradation gracieuse).
 */
async function safeImageSrc(src: string): Promise<string> {
  if (src.startsWith("data:")) return src;
  let url: URL;
  try {
    url = new URL(src);
  } catch {
    return ""; // relative ou invalide → pas de fetch possible/sûr
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") return "";
  try {
    await assertPublicHostname(url);
    return src;
  } catch {
    return ""; // hôte privé/interne/rebinding → neutralisé
  }
}

/** Sanitise récursivement un nœud Fabric (sa `src` + ses enfants groupés). */
async function sanitizeFabricNode(node: unknown): Promise<void> {
  if (!node || typeof node !== "object") return;
  const obj = node as FabricNode;
  if (typeof obj.src === "string") {
    obj.src = await safeImageSrc(obj.src);
  }
  // Groupes Fabric : enfants dans `objects`.
  if (Array.isArray(obj.objects)) {
    for (const child of obj.objects) await sanitizeFabricNode(child);
  }
  // Images de fond / d'overlay portées par la page.
  if (obj.backgroundImage) await sanitizeFabricNode(obj.backgroundImage);
  if (obj.overlayImage) await sanitizeFabricNode(obj.overlayImage);
}

/**
 * Clone défensif du DesignDocument puis passe de sanitisation SSRF sur toutes
 * les `src` d'images de toutes les pages (objets + groupes + fonds). On mute le
 * clone, jamais l'entrée (le document peut être partagé par l'appelant).
 * Exporté pour être testable en isolation.
 */
export async function sanitizeDesignForRender(design: DesignDocument): Promise<DesignDocument> {
  const clone: DesignDocument =
    typeof structuredClone === "function"
      ? structuredClone(design)
      : JSON.parse(JSON.stringify(design));
  for (const page of clone.pages ?? []) {
    const json = page.json as FabricNode | null;
    if (!json) continue;
    if (Array.isArray(json.objects)) {
      for (const obj of json.objects) await sanitizeFabricNode(obj);
    }
    if (json.backgroundImage) await sanitizeFabricNode(json.backgroundImage);
    if (json.overlayImage) await sanitizeFabricNode(json.overlayImage);
  }
  return clone;
}

/** Dimensions pixel d'une page, selon son format (identique au Studio). */
/** Format de repli si `page.format` est inconnu (le content template n'est pas
 * validé finement : un design ancien/malformé ne doit pas casser le rendu). */
const FALLBACK_FORMAT: PageFormat = "a4-portrait";

export function pageDimensions(page: DesignPage): PageDimensions {
  if (page.format === "free" && page.customWidth && page.customHeight) {
    return { width: page.customWidth, height: page.customHeight };
  }
  return PAGE_FORMATS[page.format] ?? PAGE_FORMATS[FALLBACK_FORMAT];
}

/** px @96dpi → pt PDF (1 pt = 1/72"). */
function pxToPt(px: number): number {
  return (px * 72) / 96;
}

/** Fond opaque : une page « transparente » devient blanche pour l'impression/aperçu. */
function resolveBackground(page: DesignPage): string {
  return !page.bgColor || page.bgColor === "transparent" ? "#ffffff" : page.bgColor;
}

function clampMultiplier(scale: number | undefined): number {
  const s = typeof scale === "number" && Number.isFinite(scale) ? scale : DEFAULT_SCALE;
  return Math.min(MULTIPLIER_MAX, Math.max(MULTIPLIER_MIN, s));
}

/** Enregistrement best-effort des polices empaquetées (une seule fois). */
let fontsRegistered = false;
async function registerBundledFonts(): Promise<void> {
  if (fontsRegistered) return;
  fontsRegistered = true; // même en cas d'échec : on ne retente pas à chaque rendu.
  try {
    const [{ registerFont }, path, { existsSync }] = await Promise.all([
      import("canvas"),
      import("node:path"),
      import("node:fs"),
    ]);
    const dir = path.join(process.cwd(), "assets", "video-fonts");
    const fonts: Array<{ file: string; family: string; weight?: string }> = [
      { file: "PlusJakartaSans-Regular.ttf", family: "Plus Jakarta Sans", weight: "normal" },
      { file: "PlusJakartaSans-Bold.ttf", family: "Plus Jakarta Sans", weight: "bold" },
      { file: "SourceSerif4-Regular.ttf", family: "Source Serif 4", weight: "normal" },
      { file: "SourceSerif4-Bold.ttf", family: "Source Serif 4", weight: "bold" },
    ];
    for (const f of fonts) {
      const full = path.join(dir, f.file);
      if (existsSync(full)) {
        try {
          registerFont(full, { family: f.family, weight: f.weight });
        } catch {
          // Police illisible : fontconfig prendra le relais, on continue.
        }
      }
    }
  } catch {
    // `canvas` indisponible ou fs inaccessible : rendu quand même via fontconfig.
  }
}

function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`${label} timeout after ${ms}ms`)), ms);
    promise.then(
      (v) => {
        clearTimeout(timer);
        resolve(v);
      },
      (e) => {
        clearTimeout(timer);
        reject(e);
      },
    );
  });
}

/**
 * Rasterise une page en PNG (data URL). En cas d'échec de chargement du JSON
 * (ex. image externe cassée / timeout), on dégrade gracieusement : rendu du seul
 * fond, sans faire échouer tout le document.
 */
async function renderPageToPngDataUrl(
  StaticCanvas: typeof import("fabric/node").StaticCanvas,
  page: DesignPage,
  multiplier: number,
): Promise<string> {
  const dims = pageDimensions(page);
  const canvas = new StaticCanvas(undefined as unknown as HTMLCanvasElement, {
    width: dims.width,
    height: dims.height,
  });
  try {
    if (page.json) {
      try {
        await withTimeout(canvas.loadFromJSON(page.json), PAGE_RENDER_TIMEOUT_MS, "loadFromJSON");
      } catch {
        // Une image distante cassée / lente ne doit pas casser tout le rendu :
        // on garde le fond et ce qui a pu être chargé.
      }
    }
    canvas.backgroundColor = resolveBackground(page);
    canvas.renderAll();
    return canvas.toDataURL({ format: "png", multiplier });
  } finally {
    canvas.dispose();
  }
}

function dataUrlToBuffer(dataUrl: string): Buffer {
  const comma = dataUrl.indexOf(",");
  return Buffer.from(comma >= 0 ? dataUrl.slice(comma + 1) : dataUrl, "base64");
}

async function renderPng(
  design: DesignDocument,
  pageIndex: number,
  multiplier: number,
): Promise<RenderResult> {
  const { StaticCanvas } = await import("fabric/node");
  const idx = Math.min(Math.max(0, Math.floor(pageIndex)), Math.max(0, design.pages.length - 1));
  const page = design.pages[idx];
  if (!page) throw new Error("renderDesign: aucune page à rendre");
  const dataUrl = await renderPageToPngDataUrl(StaticCanvas, page, multiplier);
  return { buffer: dataUrlToBuffer(dataUrl), contentType: "image/png", ext: "png" };
}

async function renderPdf(design: DesignDocument, multiplier: number): Promise<RenderResult> {
  const [{ StaticCanvas }, { PDFDocument }] = await Promise.all([
    import("fabric/node"),
    import("pdf-lib"),
  ]);
  if (design.pages.length === 0) throw new Error("renderDesign: document sans page");
  const pdf = await PDFDocument.create();
  // Anti-OOM : on borne le nombre de pages rasterisées ; au-delà, on tronque.
  const pages = design.pages.slice(0, MAX_PDF_PAGES);
  if (design.pages.length > MAX_PDF_PAGES) {
    console.warn(
      `renderDesign: document de ${design.pages.length} pages tronqué à ${MAX_PDF_PAGES} pour le rendu PDF`,
    );
  }
  for (const page of pages) {
    const dims = pageDimensions(page);
    const dataUrl = await renderPageToPngDataUrl(StaticCanvas, page, multiplier);
    const png = await pdf.embedPng(dataUrl);
    const pdfPage = pdf.addPage([pxToPt(dims.width), pxToPt(dims.height)]);
    pdfPage.drawImage(png, {
      x: 0,
      y: 0,
      width: pxToPt(dims.width),
      height: pxToPt(dims.height),
    });
  }
  const bytes = await pdf.save();
  return {
    buffer: Buffer.from(bytes),
    contentType: "application/pdf",
    ext: "pdf",
  };
}

/**
 * Rend un DesignDocument en image côté serveur (Node, sans navigateur).
 * - `png` (défaut) : rasterise la page `pageIndex` (défaut 0).
 * - `pdf` : toutes les pages, rasterisées puis embarquées via pdf-lib.
 */
export async function renderDesign(
  design: DesignDocument,
  opts: RenderDesignOptions = {},
): Promise<RenderResult> {
  await registerBundledFonts();
  const multiplier = clampMultiplier(opts.scale);
  // Sanitisation SSRF sur un clone défensif AVANT tout rendu : node-canvas fetch
  // les `src` d'images du JSON — on neutralise toute cible privée/interne.
  const safeDesign = await sanitizeDesignForRender(design);
  if (opts.format === "pdf") {
    return renderPdf(safeDesign, multiplier);
  }
  return renderPng(safeDesign, opts.pageIndex ?? 0, multiplier);
}
