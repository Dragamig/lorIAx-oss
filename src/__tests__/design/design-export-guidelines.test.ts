import { describe, it, expect } from "vitest";
import { runWithoutGuidelines } from "@/components/editor/extensions/design-canvas/utils";

// Reproduit le bug Fabric v7 × AligningGuidelines (épopée #45) :
// `Canvas.toCanvasElement` met `contextTop` (= elements.upper.ctx) à `undefined`
// pendant l'export, SANS try/finally. Le handler `before:render` des smart guides
// fait alors `clearContext(contextTop)` → throw → Fabric ne restaure jamais
// contextTop → tous les `renderAll()` suivants plantent et le canvas se fige.
//
// `runWithoutGuidelines` détache les hooks des smart guides autour de l'export et
// répare contextTop en sortie. Ce test garde contre toute régression.

type FakeHandlers = Record<string, Array<() => void>>;

function makeFakeCanvas() {
  const ctxSentinel = { id: "ctx2d" } as unknown as CanvasRenderingContext2D;
  const handlers: FakeHandlers = {};

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const canvas: any = {
    elements: {
      upper: { el: { getContext: () => ctxSentinel }, ctx: ctxSentinel },
    },
    get contextTop() {
      return this.elements.upper.ctx;
    },
    clearContext(ctx: unknown) {
      // Mime `ctx.clearRect(...)` : crash si le contexte est undefined.
      if (!ctx) {
        throw new TypeError("Cannot read properties of undefined (reading 'clearRect')");
      }
    },
    on(ev: string, fn: () => void) {
      (handlers[ev] ??= []).push(fn);
    },
    off(ev: string, fn: () => void) {
      handlers[ev] = (handlers[ev] ?? []).filter((h) => h !== fn);
    },
    _fire(ev: string) {
      (handlers[ev] ?? []).forEach((h) => h());
    },
  };

  const guidelines = {
    dispose() {},
    beforeRender() {
      canvas.clearContext(canvas.contextTop);
    },
    afterRender() {},
  };
  canvas.__aligningGuidelines = guidelines;
  canvas.on("before:render", guidelines.beforeRender);
  canvas.on("after:render", guidelines.afterRender);

  // Mime fabric.Canvas.toCanvasElement (annule contextTop sans try/finally).
  canvas.fakeToCanvasElement = () => {
    canvas.elements.upper.ctx = undefined; // contextTop → undefined
    canvas._fire("before:render"); // jette si les smart guides sont encore attachés
    canvas.elements.upper.ctx = canvas.elements.upper.el.getContext("2d"); // sauté si throw
    return "data:image/png;base64,FAKE";
  };

  return { canvas, handlers };
}

describe("runWithoutGuidelines — garde anti-crash export Design Studio", () => {
  it("reproduit le bug : sans garde, l'export fige contextTop", () => {
    const { canvas } = makeFakeCanvas();
    expect(() => canvas.fakeToCanvasElement()).toThrow(/clearRect/);
    expect(canvas.contextTop).toBeUndefined(); // canvas gelé
  });

  it("avec le garde : l'export réussit et contextTop reste valide", () => {
    const { canvas, handlers } = makeFakeCanvas();
    const result = runWithoutGuidelines(canvas, () => canvas.fakeToCanvasElement());
    expect(result).toBe("data:image/png;base64,FAKE");
    expect(canvas.contextTop).toBeTruthy(); // canvas toujours rendable
    // Hooks des smart guides ré-attachés après l'export
    expect(handlers["before:render"]).toHaveLength(1);
    expect(handlers["after:render"]).toHaveLength(1);
  });

  it("répare contextTop même si l'export jette pour une autre raison", () => {
    const { canvas, handlers } = makeFakeCanvas();
    canvas.elements.upper.ctx = undefined; // déjà corrompu
    expect(() =>
      runWithoutGuidelines(canvas, () => {
        throw new Error("export KO");
      }),
    ).toThrow("export KO");
    expect(canvas.contextTop).toBeTruthy(); // réparé par le finally
    expect(handlers["before:render"]).toHaveLength(1); // ré-attaché
  });
});
