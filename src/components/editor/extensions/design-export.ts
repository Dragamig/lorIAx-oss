import type { Canvas as FabricCanvas } from "fabric";
import { PAGE_FORMATS, type DesignPage, type PageDimensions } from "./design-constants";
import { runWithoutGuidelines } from "./design-canvas/utils";
// pdf-lib and StaticCanvas imported lazily inside exportPdf

interface CanvasWithSvg {
  toSVG(opts?: object): string;
}

export function slugify(title: string): string {
  return (title || "design").trim().replace(/\s+/g, "-").toLowerCase() || "design";
}

export function pxToPt(px: number): number {
  return (px * 72) / 96;
}

export function exportMultiplier(dpi: number, zoomPercent: number): number {
  return Math.max(0.05, (dpi / 96) * (100 / Math.max(1, zoomPercent)));
}

function download(href: string, filename: string) {
  const a = document.createElement("a");
  a.href = href;
  a.download = filename;
  a.click();
}

export interface RasterOptions {
  format: "png" | "jpeg";
  dpi: number;
  zoomPercent: number;
  transparent: boolean;
  title: string;
}

export function exportRaster(canvas: FabricCanvas, opts: RasterOptions): void {
  const multiplier = exportMultiplier(opts.dpi, opts.zoomPercent);
  const prevBg = canvas.backgroundColor;
  if (opts.transparent && opts.format === "png") {
    canvas.backgroundColor = "";
    canvas.renderAll();
  }
  // Détache les smart guides pendant l'export (cf. runWithoutGuidelines) : sinon
  // l'export PNG/JPEG fige le canvas via le bug Fabric v7 × AligningGuidelines.
  const dataUrl = runWithoutGuidelines(canvas, () =>
    canvas.toDataURL({
      format: opts.format,
      quality: opts.format === "jpeg" ? 0.92 : undefined,
      multiplier,
    }),
  );
  if (opts.transparent && opts.format === "png") {
    canvas.backgroundColor = prevBg;
    canvas.renderAll();
  }
  download(dataUrl, `${slugify(opts.title)}.${opts.format === "jpeg" ? "jpg" : "png"}`);
}

export function exportSvg(canvas: FabricCanvas, page: PageDimensions, title: string): void {
  const svg = (canvas as CanvasWithSvg).toSVG({
    width: `${page.width}`,
    height: `${page.height}`,
    viewBox: { x: 0, y: 0, width: page.width, height: page.height },
  });
  const blob = new Blob([svg], { type: "image/svg+xml" });
  const url = URL.createObjectURL(blob);
  download(url, `${slugify(title)}.svg`);
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}

function pageDims(p: DesignPage): PageDimensions {
  return p.format === "free" && p.customWidth && p.customHeight
    ? { width: p.customWidth, height: p.customHeight }
    : PAGE_FORMATS[p.format];
}

export async function exportPdf(pages: DesignPage[], dpi: number, title: string): Promise<void> {
  const { PDFDocument } = await import("pdf-lib");
  const { StaticCanvas } = await import("fabric");
  const multiplier = Math.max(0.5, dpi / 96);
  const pdf = await PDFDocument.create();
  for (const page of pages) {
    const dims = pageDims(page);
    const tmp = new StaticCanvas(undefined as unknown as HTMLCanvasElement, {
      width: dims.width,
      height: dims.height,
    });
    try {
      if (page.json) await tmp.loadFromJSON(page.json);
      tmp.backgroundColor =
        !page.bgColor || page.bgColor === "transparent" ? "#ffffff" : page.bgColor;
      tmp.renderAll();
      const dataUrl = tmp.toDataURL({ format: "png", multiplier });
      const png = await pdf.embedPng(dataUrl);
      const pdfPage = pdf.addPage([pxToPt(dims.width), pxToPt(dims.height)]);
      pdfPage.drawImage(png, {
        x: 0,
        y: 0,
        width: pxToPt(dims.width),
        height: pxToPt(dims.height),
      });
    } finally {
      tmp.dispose();
    }
  }
  const bytes = await pdf.save();
  const blob = new Blob([bytes as unknown as BlobPart], { type: "application/pdf" });
  const url = URL.createObjectURL(blob);
  download(url, `${slugify(title)}.pdf`);
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}
