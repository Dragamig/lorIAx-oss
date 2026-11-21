// Alignement et distribution d'objets : cœur pur + branchement Fabric.
import type { Canvas as FabricCanvas } from "fabric";
import type { PageDimensions } from "./design-constants";

export interface AlignRect {
  left: number;
  top: number;
  width: number;
  height: number;
}

export type AlignAction =
  | "left" | "center-h" | "right"
  | "top" | "middle-v" | "bottom"
  | "distribute-h" | "distribute-v";

interface Delta { dx: number; dy: number; }

function boundingBox(rects: AlignRect[]): AlignRect {
  if (rects.length === 0) return { left: 0, top: 0, width: 0, height: 0 };
  const left = Math.min(...rects.map((r) => r.left));
  const top = Math.min(...rects.map((r) => r.top));
  const right = Math.max(...rects.map((r) => r.left + r.width));
  const bottom = Math.max(...rects.map((r) => r.top + r.height));
  return { left, top, width: right - left, height: bottom - top };
}

export function computeAlignDeltas(
  rects: AlignRect[],
  action: AlignAction,
  page: PageDimensions
): Delta[] {
  if (rects.length === 0) return [];

  if (action === "distribute-h" || action === "distribute-v") {
    if (rects.length < 3) return rects.map(() => ({ dx: 0, dy: 0 }));
    const horizontal = action === "distribute-h";
    const indexed = rects.map((r, i) => ({ r, i }));
    indexed.sort((a, b) => (horizontal ? a.r.left - b.r.left : a.r.top - b.r.top));
    const first = indexed[0].r;
    const last = indexed[indexed.length - 1].r;
    const span = horizontal
      ? last.left + last.width - first.left
      : last.top + last.height - first.top;
    const totalSize = indexed.reduce((s, { r }) => s + (horizontal ? r.width : r.height), 0);
    const gap = (span - totalSize) / (indexed.length - 1);
    const deltas: Delta[] = rects.map(() => ({ dx: 0, dy: 0 }));
    let cursor = horizontal ? first.left : first.top;
    for (const { r, i } of indexed) {
      const target = cursor;
      if (horizontal) deltas[i] = { dx: target - r.left, dy: 0 };
      else deltas[i] = { dx: 0, dy: target - r.top };
      cursor = target + (horizontal ? r.width : r.height) + gap;
    }
    return deltas;
  }

  // Référence : page pour un objet seul, bbox de la sélection sinon
  const frame: AlignRect =
    rects.length === 1
      ? { left: 0, top: 0, width: page.width, height: page.height }
      : boundingBox(rects);

  return rects.map((r) => {
    switch (action) {
      case "left":     return { dx: frame.left - r.left, dy: 0 };
      case "center-h": return { dx: frame.left + (frame.width - r.width) / 2 - r.left, dy: 0 };
      case "right":    return { dx: frame.left + frame.width - r.width - r.left, dy: 0 };
      case "top":      return { dx: 0, dy: frame.top - r.top };
      case "middle-v": return { dx: 0, dy: frame.top + (frame.height - r.height) / 2 - r.top };
      case "bottom":   return { dx: 0, dy: frame.top + frame.height - r.height - r.top };
    }
  });
}

/**
 * Applique une action d'alignement à la sélection active du canvas.
 * On dissout la sélection avant lecture des coordonnées (les enfants d'une
 * ActiveSelection ont des coordonnées relatives au groupe), puis on la recrée.
 */
export async function applyAlignment(
  canvas: FabricCanvas,
  action: AlignAction,
  page: PageDimensions
): Promise<void> {
  const objs = canvas.getActiveObjects();
  if (objs.length === 0) return;
  canvas.discardActiveObject();

  const rects: AlignRect[] = objs.map((o) => o.getBoundingRect());
  const deltas = computeAlignDeltas(rects, action, page);
  objs.forEach((o, i) => {
    o.set({ left: (o.left ?? 0) + deltas[i].dx, top: (o.top ?? 0) + deltas[i].dy });
    o.setCoords();
  });

  if (objs.length === 1) {
    canvas.setActiveObject(objs[0]);
  } else {
    const { ActiveSelection } = await import("fabric");
    canvas.setActiveObject(new ActiveSelection(objs, { canvas }));
  }
  canvas.requestRenderAll();
  canvas.fire("object:modified", {} as never); // pousse l'historique + autosave
}
