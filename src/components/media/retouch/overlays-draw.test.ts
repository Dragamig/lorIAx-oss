// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { createCanvas } from "canvas";
import { StaticCanvas } from "fabric";
import { renderRecipeOn } from "./render";
import { emptyRecipe, type RetouchRecipe } from "./recipe";

function solid(w: number, h: number) {
  const c = createCanvas(w, h);
  const ctx = c.getContext("2d");
  ctx.fillStyle = "#000000";
  ctx.fillRect(0, 0, w, h);
  return c as unknown as HTMLCanvasElement;
}

function pixelAt(canvas: StaticCanvas, fx: number, fy: number): number[] {
  const el = canvas.getElement();
  const ctx = el.getContext("2d")!;
  return Array.from(ctx.getImageData(Math.floor(fx * el.width), Math.floor(fy * el.height), 1, 1).data);
}

describe("calques rendus par le moteur", () => {
  const recipe: RetouchRecipe = {
    ...emptyRecipe({ width: 400, height: 300 }),
    layers: [
      { id: "r", type: "shape", shape: "rect", x: 0.25, y: 0.25, w: 0.5, h: 0.5, fill: "#ff0000", stroke: null, strokeWidth: 0 },
    ],
  };

  it.each([
    [200, 150],
    [400, 300],
  ])("le rectangle plein recouvre la même zone à %i x %i", (w, h) => {
    const canvas = new StaticCanvas(document.createElement("canvas"), { enableRetinaScaling: false, renderOnAddRemove: false });
    renderRecipeOn(canvas, recipe, solid(400, 300), { width: w, height: h });
    expect(pixelAt(canvas, 0.5, 0.5).slice(0, 3)).toEqual([255, 0, 0]);
    expect(pixelAt(canvas, 0.1, 0.1).slice(0, 3)).toEqual([0, 0, 0]);
    expect(pixelAt(canvas, 0.9, 0.9).slice(0, 3)).toEqual([0, 0, 0]);
  });

  it("texte et flèche se rendent sans erreur", () => {
    const r: RetouchRecipe = {
      ...recipe,
      layers: [
        { id: "t", type: "text", x: 0.1, y: 0.1, w: 0.6, text: "Bonjour", fontSize: 80, color: "#ffffff", font: "serif" },
        { id: "a", type: "shape", shape: "arrow", x: 0.2, y: 0.5, w: 0.4, h: 0.2, fill: null, stroke: "#00ff00", strokeWidth: 8 },
      ],
    };
    const canvas = new StaticCanvas(document.createElement("canvas"), { enableRetinaScaling: false, renderOnAddRemove: false });
    renderRecipeOn(canvas, r, solid(400, 300), { width: 400, height: 300 });
    expect(canvas.getObjects().length).toBeGreaterThanOrEqual(4);
  });
});
