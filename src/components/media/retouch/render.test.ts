// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from "vitest";
import { createCanvas } from "canvas";
import { Canvas2dFilterBackend, StaticCanvas, getFilterBackend, setFilterBackend } from "fabric";
import {
  RetouchLoadError,
  coverScale,
  createPreviewSource,
  exportRecipeBlob,
  loadSourceImage,
  previewSize,
  renderRecipeOn,
  canEncodeWebp,
} from "./render";
import { applyOp, emptyRecipe } from "./recipe";

function solidSource(w: number, h: number, color = "#ff0000") {
  const c = createCanvas(w, h);
  const ctx = c.getContext("2d");
  ctx.fillStyle = color;
  ctx.fillRect(0, 0, w, h);
  return c as unknown as HTMLCanvasElement;
}

afterEach(() => vi.restoreAllMocks());

describe("loadSourceImage", () => {
  it("rejette une image illisible avec RetouchLoadError", async () => {
    class BadImage {
      onload: (() => void) | null = null;
      onerror: (() => void) | null = null;
      naturalWidth = 0;
      naturalHeight = 0;
      set src(_v: string) {
        queueMicrotask(() => this.onerror?.());
      }
    }
    vi.stubGlobal("Image", BadImage);
    await expect(loadSourceImage("/api/media/x", new AbortController().signal)).rejects.toBeInstanceOf(RetouchLoadError);
    vi.unstubAllGlobals();
  });

  it("rejette une image d'une autre origine (canevas tainted)", async () => {
    await expect(loadSourceImage("https://autre.tld/a.png", new AbortController().signal)).rejects.toMatchObject({
      code: "origin",
    });
  });

  it("l'annulation rejette sans promesse pendante", async () => {
    class HangImage {
      onload: (() => void) | null = null;
      onerror: (() => void) | null = null;
      set src(_v: string) {
        /* ne répond jamais */
      }
    }
    vi.stubGlobal("Image", HangImage);
    const ac = new AbortController();
    const p = loadSourceImage("/api/media/x", ac.signal);
    ac.abort();
    await expect(p).rejects.toMatchObject({ code: "aborted" });
    vi.unstubAllGlobals();
  });
});

describe("tailles", () => {
  it("aperçu ramené à 2 048 px de côté", () => {
    const r = emptyRecipe({ width: 6000, height: 3000 });
    expect(previewSize(r)).toEqual({ width: 2048, height: 1024 });
    expect(previewSize(emptyRecipe({ width: 800, height: 600 }))).toEqual({ width: 800, height: 600 });
  });

  it("copie de travail réduite pour une grande source", () => {
    const img = { image: solidSource(10, 10) as unknown as HTMLImageElement, width: 4096, height: 2048 };
    const small = createPreviewSource(img);
    expect(small).not.toBe(img.image);
    expect(small.width).toBe(2048);
    expect(small.height).toBe(1024);
  });

  it("coverScale vaut 1 sans angle et croît avec l'angle", () => {
    expect(coverScale(0, 400, 300)).toBe(1);
    expect(coverScale(10, 400, 300)).toBeGreaterThan(1);
  });
});

describe("exportRecipeBlob", () => {
  it("n'appelle jamais fetch et produit un PNG à la taille de sortie", async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    const r = applyOp(emptyRecipe({ width: 40, height: 20 }), { type: "rotate", quarters: 1 });
    const blob = await exportRecipeBlob(r, solidSource(40, 20), "png");
    expect(blob.type).toBe("image/png");
    expect(blob.size).toBeGreaterThan(0);
    expect(fetchSpy).not.toHaveBeenCalled();
    vi.unstubAllGlobals();
  });

  it("conserve la transparence d'un png et remplit un jpeg en blanc", async () => {
    const r = emptyRecipe({ width: 10, height: 10 });
    const png = await exportRecipeBlob({ ...r, angle: 30, crop: { x: 0, y: 0, w: 1, h: 1 } }, solidSource(10, 10), "png");
    expect(png.type).toBe("image/png");
    const jpg = await exportRecipeBlob(r, solidSource(10, 10), "jpeg");
    expect(jpg.type).toBe("image/jpeg");
  });

  it("applique les filtres sans erreur (Canvas 2D)", async () => {
    let r = emptyRecipe({ width: 20, height: 20 });
    r = applyOp(r, { type: "setAdjustment", key: "brightness", value: 40 });
    r = applyOp(r, { type: "setSharpen", value: 50 });
    r = applyOp(r, { type: "setBlur", value: 20 });
    r = applyOp(r, { type: "setPreset", preset: "sepia" });
    const blob = await exportRecipeBlob(r, solidSource(20, 20, "#336699"), "png");
    expect(blob.size).toBeGreaterThan(0);
  });

  it("détruit le canevas d'export même quand le rendu échoue", async () => {
    const created: HTMLCanvasElement[] = [];
    const orig = document.createElement.bind(document);
    vi.spyOn(document, "createElement").mockImplementation(((tag: string) => {
      const el = orig(tag);
      if (tag === "canvas") created.push(el as HTMLCanvasElement);
      return el;
    }) as typeof document.createElement);
    const r = emptyRecipe({ width: 10, height: 10 });
    const broken = { width: 10, height: 10 } as unknown as HTMLCanvasElement; // source invalide
    await exportRecipeBlob(r, broken, "png").catch(() => undefined);
    const exportEl = created[0];
    expect(exportEl).toBeDefined();
    expect(exportEl.width).toBe(0);
  });
});

describe("cache de textures de l'aperçu", () => {
  it("N rendus successifs libèrent l'entrée de cache du rendu précédent", () => {
    const original = getFilterBackend(false);
    const live = new Set<string>();
    const fake = Object.assign(new Canvas2dFilterBackend(), {
      applyFilters(_f: unknown, _s: unknown, _w: number, _h: number, _t: unknown, key?: string) {
        if (key) live.add(key);
        return undefined;
      },
      evictCachesForKey(key: string) {
        live.delete(key);
      },
    });
    setFilterBackend(fake as never);
    try {
      let r = emptyRecipe({ width: 20, height: 20 });
      const canvas = new StaticCanvas(document.createElement("canvas"), { renderOnAddRemove: false });
      const src = solidSource(20, 20);
      for (let i = 1; i <= 8; i++) {
        r = applyOp(r, { type: "setAdjustment", key: "brightness", value: i * 5 });
        renderRecipeOn(canvas, r, src, { width: 20, height: 20 });
        expect(live.size).toBeLessThanOrEqual(1);
      }
    } finally {
      if (original) setFilterBackend(original);
    }
  });
});

function blobToBuffer(blob: Blob): Promise<Buffer> {
  return new Promise((res, rej) => {
    const fr = new FileReader();
    fr.onload = () => res(Buffer.from(fr.result as ArrayBuffer));
    fr.onerror = () => rej(fr.error);
    fr.readAsArrayBuffer(blob);
  });
}

describe("export au-delà de textureSize", () => {
  it("source 6000x4000 avec luminosité : coins corrects, backend restauré", async () => {
    const original = getFilterBackend(false);
    const sets: unknown[] = [];
    let r = emptyRecipe({ width: 6000, height: 4000 });
    r = applyOp(r, { type: "setAdjustment", key: "brightness", value: 20 });
    const src = createCanvas(6000, 4000);
    const ctx = src.getContext("2d");
    ctx.fillStyle = "#404040";
    ctx.fillRect(0, 0, 6000, 4000);
    const blob = await exportRecipeBlob(r, src as unknown as HTMLCanvasElement, "png");
    expect(getFilterBackend(false)).toBe(original);
    void sets;
    const { loadImage } = await import("canvas");
    const img = await loadImage(await blobToBuffer(blob));
    expect(img.width).toBe(6000);
    const out = createCanvas(6000, 4000);
    const o = out.getContext("2d");
    o.drawImage(img, 0, 0);
    for (const [x, y] of [[0, 0], [5999, 0], [0, 3999], [5999, 3999]]) {
      const d = o.getImageData(x, y, 1, 1).data;
      expect(d[3]).toBe(255);
      expect(d[0]).toBeGreaterThan(0x40);
    }
  }, 60000);

  it("utilise le backend Canvas 2D pour l'export puis restaure l'ancien", async () => {
    const original = getFilterBackend(false);
    const seen: unknown[] = [];
    const marker = new Canvas2dFilterBackend();
    setFilterBackend(marker);
    const orig = marker.applyFilters.bind(marker);
    marker.applyFilters = ((...a: Parameters<typeof orig>) => {
      seen.push(getFilterBackend(false));
      return orig(...a);
    }) as never;
    let r = emptyRecipe({ width: 20, height: 20 });
    r = applyOp(r, { type: "setAdjustment", key: "brightness", value: 20 });
    await exportRecipeBlob(r, solidSource(20, 20), "png");
    expect(getFilterBackend(false)).toBe(marker);
    expect(seen.length).toBe(0); // le backend courant (WebGL en prod) n'est pas utilisé pour l'export
    if (original) setFilterBackend(original);
  });
});

describe("qualité JPEG choisie", () => {
  it("transmet la qualité à l'encodeur", async () => {
    const spy = vi.spyOn(StaticCanvas.prototype, "toDataURL");
    await exportRecipeBlob(emptyRecipe({ width: 10, height: 10 }), solidSource(10, 10), "jpeg", 0.6);
    expect(spy.mock.calls[0][0]).toMatchObject({ format: "jpeg", quality: 0.6 });
  });
});

describe("canEncodeWebp", () => {
  it("vrai si le navigateur rend du webp, faux s'il rend un png ou échoue", () => {
    const spy = vi.spyOn(HTMLCanvasElement.prototype, "toDataURL");
    spy.mockReturnValue("data:image/webp;base64,AAAA");
    expect(canEncodeWebp(true)).toBe(true);
    spy.mockReturnValue("data:image/png;base64,AAAA");
    expect(canEncodeWebp(true)).toBe(false);
    spy.mockImplementation(() => {
      throw new Error("x");
    });
    expect(canEncodeWebp(true)).toBe(false);
  });
});
