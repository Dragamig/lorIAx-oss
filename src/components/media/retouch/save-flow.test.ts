import { describe, it, expect, vi } from "vitest";
import { UNDO_WINDOW_MS, fileNameFor, saveErrorKey, saveRetouched, type SaveOptions } from "./save-flow";

const blob = () => new Blob([new Uint8Array([1, 2, 3])], { type: "image/png" });
const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

function opts(fetchImpl: typeof fetch, over: Partial<SaveOptions> = {}): SaveOptions {
  return {
    sourceId: "src-1",
    mode: "derived",
    name: "photo retouchée",
    spaceId: "sp-1",
    folderId: null,
    format: "png",
    quality: 90,
    expectedVersion: 3,
    getBlob: async () => blob(),
    fetchImpl,
    ...over,
  };
}

describe("saveRetouched", () => {
  it("dérivé créé : envoie le multipart attendu et l'undo ne met en corbeille que ce média", async () => {
    const calls: { url: string; init?: RequestInit }[] = [];
    const f = vi.fn(async (url: string, init?: RequestInit) => {
      calls.push({ url, init });
      if (url.endsWith("/retouch")) return json(201, { media: { id: "new-9", uploadedBy: "u1" }, duplicate: false });
      return json(200, { results: [{ id: "new-9", ok: true }] });
    }) as unknown as typeof fetch;
    const out = await saveRetouched(opts(f, { userId: "u1" }));
    expect(out.kind).toBe("created");
    const form = calls[0].init?.body as FormData;
    expect(calls[0].url).toBe("/api/media/src-1/retouch");
    expect(form.get("mode")).toBe("derived");
    expect(form.get("spaceId")).toBe("sp-1");
    expect(form.has("expectedVersion")).toBe(false);
    expect((form.get("file") as File).name).toBe("photo retouchée.png");
    if (out.kind !== "created") throw new Error();
    await out.undo();
    const undo = calls[1];
    expect(undo.url).toBe("/api/media/batch");
    expect(JSON.parse(undo.init?.body as string)).toEqual({ action: "trash", ids: ["new-9"] });
  });

  it("undo refusé hors délai de 10 s et pour un autre auteur", async () => {
    const f = vi.fn(async () => json(201, { media: { id: "n", uploadedBy: "u2" }, duplicate: false })) as unknown as typeof fetch;
    let t = 1000;
    const out = await saveRetouched(opts(f, { userId: "u1", now: () => t }));
    if (out.kind !== "created") throw new Error();
    await expect(out.undo()).rejects.toThrow("not-author");
    const out2 = await saveRetouched(opts(f, { now: () => t }));
    if (out2.kind !== "created") throw new Error();
    t += UNDO_WINDOW_MS + 1;
    await expect(out2.undo()).rejects.toThrow("expired");
    expect(f).toHaveBeenCalledTimes(2);
  });

  it("version : expectedVersion envoyé, undo supprime la version créée avec requireCurrent=1", async () => {
    const calls: { url: string; init?: RequestInit }[] = [];
    const f = vi.fn(async (url: string, init?: RequestInit) => {
      calls.push({ url, init });
      if (url.endsWith("/retouch")) return json(200, { media: { id: "src-1", currentVersion: 4 }, duplicate: false, versionId: "row-4" });
      return json(200, { media: {} });
    }) as unknown as typeof fetch;
    const out = await saveRetouched(opts(f, { mode: "version", folderId: "fo" }));
    expect(out.kind).toBe("versioned");
    expect((calls[0].init?.body as FormData).get("expectedVersion")).toBe("3");
    if (out.kind !== "versioned") throw new Error();
    await out.undo();
    expect(calls).toHaveLength(2);
    expect(calls[1].url).toBe("/api/media/src-1/versions/row-4?requireCurrent=1");
    expect(calls[1].init?.method).toBe("DELETE");
  });

  it("version sans id de ligne renvoyé : l'undo échoue sans rien supprimer", async () => {
    const calls: string[] = [];
    const f = vi.fn(async (url: string) => {
      calls.push(url);
      return json(200, { media: { id: "src-1", currentVersion: 4 }, duplicate: false });
    }) as unknown as typeof fetch;
    const out = await saveRetouched(opts(f, { mode: "version" }));
    if (out.kind !== "versioned") throw new Error();
    await expect(out.undo()).rejects.toThrow("undo-failed");
    expect(calls).toHaveLength(1);
  });

  it("doublon : aucun undo", async () => {
    const f = vi.fn(async () => json(200, { media: { id: "old" }, duplicate: true })) as unknown as typeof fetch;
    expect(await saveRetouched(opts(f))).toEqual({ kind: "duplicate", mediaId: "old" });
  });

  it.each([401, 403, 404, 409, 413, 415, 429, 507])("statut %i devient une erreur sans exception", async (status) => {
    const f = vi.fn(async () => json(status, { error: "x" })) as unknown as typeof fetch;
    const out = await saveRetouched(opts(f));
    expect(out).toMatchObject({ kind: "error", status });
    expect(saveErrorKey(status)).not.toBe("errGeneric");
  });

  it("507 signale le quota ; réseau coupé : status 0 ; échec d'export : status -1 sans appel réseau", async () => {
    const quota = vi.fn(async () => json(507, { error: "Quota" })) as unknown as typeof fetch;
    expect(await saveRetouched(opts(quota))).toMatchObject({ status: 507, quotaFull: true });
    const down = vi.fn(async () => {
      throw new TypeError("offline");
    }) as unknown as typeof fetch;
    expect(await saveRetouched(opts(down))).toMatchObject({ kind: "error", status: 0 });
    const never = vi.fn() as unknown as typeof fetch;
    const out = await saveRetouched(opts(never, { getBlob: async () => Promise.reject(new Error("boom")) }));
    expect(out).toMatchObject({ kind: "error", status: -1 });
    expect(never).not.toHaveBeenCalled();
  });

  it("n'utilise jamais fetch sur un data URL", async () => {
    const f = vi.fn(async () => json(500, {})) as unknown as typeof fetch;
    await saveRetouched(opts(f));
    for (const [url] of (f as unknown as { mock: { calls: [string][] } }).mock.calls) expect(url.startsWith("data:")).toBe(false);
  });
});

describe("type réel du fichier envoyé", () => {
  it("un WebP demandé mais encodé en PNG par le navigateur part en image/png, extension png", async () => {
    let sent: File | undefined;
    const f = vi.fn(async (_u: string, init?: RequestInit) => {
      sent = (init?.body as FormData).get("file") as File;
      return json(500, {});
    }) as unknown as typeof fetch;
    await saveRetouched(opts(f, { format: "webp", getBlob: async () => blob() }));
    expect(sent?.type).toBe("image/png");
    expect(sent?.name).toBe("photo retouchée.png");
  });
});

describe("noms et codes", () => {
  it("l'extension suit le format", () => {
    expect(fileNameFor("a.png", "jpeg")).toBe("a.jpg");
    expect(fileNameFor("  ", "webp")).toBe("retouche.webp");
  });
  it("chaque code a une clé distincte", () => {
    const keys = [0, -1, 401, 403, 404, 409, 413, 415, 429, 507, 500].map(saveErrorKey);
    expect(new Set(keys).size).toBe(keys.length);
  });
});
