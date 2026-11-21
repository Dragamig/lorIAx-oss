// Aimantation aux bords/centre de la page + tracé des guides.
// L'aimantation objet↔objet est gérée par AligningGuidelines (fabric/extensions).
import type { Canvas as FabricCanvas } from "fabric";
import { SNAP_THRESHOLD } from "./design-constants";
import type { PageDimensions } from "./design-constants";

interface Rect { left: number; top: number; width: number; height: number; }

export interface SnapResult {
  dx: number;
  dy: number;
  /** positions x (en px page) des guides verticaux à tracer */
  vLines: number[];
  /** positions y (en px page) des guides horizontaux à tracer */
  hLines: number[];
}

export function snapToPage(rect: Rect, page: PageDimensions, threshold: number): SnapResult {
  const result: SnapResult = { dx: 0, dy: 0, vLines: [], hLines: [] };

  // Candidats verticaux : (valeur de l'objet, cible page)
  const vCandidates: Array<{ value: number; target: number }> = [
    { value: rect.left, target: 0 },
    { value: rect.left + rect.width / 2, target: page.width / 2 },
    { value: rect.left + rect.width, target: page.width },
  ];
  let bestV: { delta: number; target: number } | null = null;
  for (const c of vCandidates) {
    const delta = c.target - c.value;
    if (Math.abs(delta) <= threshold && (!bestV || Math.abs(delta) < Math.abs(bestV.delta))) {
      bestV = { delta, target: c.target };
    }
  }
  if (bestV) {
    result.dx = bestV.delta;
    result.vLines.push(bestV.target);
  }

  const hCandidates: Array<{ value: number; target: number }> = [
    { value: rect.top, target: 0 },
    { value: rect.top + rect.height / 2, target: page.height / 2 },
    { value: rect.top + rect.height, target: page.height },
  ];
  let bestH: { delta: number; target: number } | null = null;
  for (const c of hCandidates) {
    const delta = c.target - c.value;
    if (Math.abs(delta) <= threshold && (!bestH || Math.abs(delta) < Math.abs(bestH.delta))) {
      bestH = { delta, target: c.target };
    }
  }
  if (bestH) {
    result.dy = bestH.delta;
    result.hLines.push(bestH.target);
  }

  return result;
}

/**
 * Branche le snapping page sur un canvas Fabric. Retourne une fonction de dispose.
 * getPage est un getter pour suivre les changements de format sans rebrancher.
 */
export function attachPageSnapping(canvas: FabricCanvas, getPage: () => PageDimensions): () => void {
  let lines: { v: number[]; h: number[] } = { v: [], h: [] };

  const onMoving = (e: { target?: unknown }) => {
    const target = e.target as import("fabric").FabricObject | undefined;
    if (!target) return;
    const zoom = canvas.getZoom() || 1;
    const rect = target.getBoundingRect();
    const snap = snapToPage(rect, getPage(), SNAP_THRESHOLD / zoom);
    if (snap.dx !== 0) target.set("left", (target.left ?? 0) + snap.dx);
    if (snap.dy !== 0) target.set("top", (target.top ?? 0) + snap.dy);
    if (snap.dx !== 0 || snap.dy !== 0) target.setCoords();
    lines = { v: snap.vLines, h: snap.hLines };
  };

  const onAfterRender = () => {
    if (lines.v.length === 0 && lines.h.length === 0) return;
    // contextTop is a getter property in fabric 7.x (no getTopContext() method)
    // NOTE: drawing assumes viewportTransform = pure zoom (no pan); if panning is ever added,
    // switch to ctx.transform(...canvas.viewportTransform) and draw in page coords like AligningGuidelines.
    const ctx = canvas.contextTop;
    if (!ctx) return;
    const zoom = canvas.getZoom() || 1;
    ctx.save();
    ctx.strokeStyle = "#8b5cf6";
    ctx.lineWidth = 1;
    ctx.setLineDash([4, 4]);
    for (const x of lines.v) {
      ctx.beginPath();
      ctx.moveTo(x * zoom, 0);
      ctx.lineTo(x * zoom, canvas.getHeight());
      ctx.stroke();
    }
    for (const y of lines.h) {
      ctx.beginPath();
      ctx.moveTo(0, y * zoom);
      ctx.lineTo(canvas.getWidth(), y * zoom);
      ctx.stroke();
    }
    ctx.restore();
  };

  const clear = () => {
    if (lines.v.length || lines.h.length) {
      lines = { v: [], h: [] };
      const ctx = canvas.contextTop;
      if (ctx) canvas.clearContext(ctx);
    }
  };

  canvas.on("object:moving", onMoving);
  canvas.on("after:render", onAfterRender);
  canvas.on("mouse:up", clear);

  return () => {
    canvas.off("object:moving", onMoving);
    canvas.off("after:render", onAfterRender);
    canvas.off("mouse:up", clear);
  };
}
