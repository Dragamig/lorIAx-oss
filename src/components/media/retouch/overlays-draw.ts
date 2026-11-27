import { Ellipse, FabricObject, Line, Rect, Textbox, Triangle } from "fabric";
import type { Canvas as FabricCanvas, StaticCanvas } from "fabric";
import { fontStack, layerGeometry, lineEnds, type ShapeLayer } from "./overlays";
import type { Layer } from "./recipe";

const FREEZE = { selectable: false, evented: false, objectCaching: false } as const;
/** Fabric v7 centre les objets par défaut : les calques sont positionnés par leur coin haut gauche. */
const TOP_LEFT = { originX: "left", originY: "top" } as const;

function arrowObjects(layer: ShapeLayer, size: { width: number; height: number }): FabricObject[] {
  const { x1, y1, x2, y2 } = lineEnds(layer, size);
  const sw = layerGeometry(layer, size).strokeWidth;
  const stroke = layer.stroke ?? "#000000";
  const shaft = new Line([x1, y1, x2, y2], { stroke, strokeWidth: sw, strokeLineCap: "round", ...FREEZE });
  if (layer.shape === "line") return [shaft];
  const head = Math.max(8, sw * 4);
  const deg = (Math.atan2(y2 - y1, x2 - x1) * 180) / Math.PI;
  const tip = new Triangle({
    left: x2,
    top: y2,
    originX: "center",
    originY: "center",
    width: head,
    height: head,
    angle: deg + 90,
    fill: stroke,
    ...FREEZE,
  });
  return [shaft, tip];
}

/** Objets Fabric d'un calque pour une taille de sortie : la même fonction sert l'aperçu et l'export. */
export function layerObjects(layer: Layer, size: { width: number; height: number }): FabricObject[] {
  const g = layerGeometry(layer, size);
  if (layer.type === "text") {
    return [
      new Textbox(layer.text, {
        ...TOP_LEFT,
        left: g.left,
        top: g.top,
        width: Math.max(1, g.width),
        fontSize: Math.max(1, g.fontSize),
        fontFamily: fontStack(layer.font),
        fill: layer.color,
        ...FREEZE,
      }),
    ];
  }
  const paint = {
    fill: layer.fill ?? "",
    stroke: layer.stroke ?? undefined,
    strokeWidth: layer.stroke ? g.strokeWidth : 0,
    strokeUniform: true,
    ...FREEZE,
  };
  if (layer.shape === "rect") {
    return [new Rect({ ...TOP_LEFT, left: g.left, top: g.top, width: g.width, height: g.height, ...paint })];
  }
  if (layer.shape === "ellipse") {
    return [new Ellipse({ ...TOP_LEFT, left: g.left, top: g.top, rx: g.width / 2, ry: g.height / 2, ...paint })];
  }
  return arrowObjects(layer, size);
}

/** Ajoute les calques au canevas, dans l'ordre de la recette (le dernier au-dessus). */
export function drawOverlays(
  canvas: StaticCanvas | FabricCanvas,
  layers: readonly Layer[],
  size: { width: number; height: number },
): void {
  for (const layer of layers) {
    for (const obj of layerObjects(layer, size)) canvas.add(obj);
  }
}
