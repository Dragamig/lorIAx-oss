import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({ serve: vi.fn(), guard: vi.fn() }));
vi.mock("@/lib/media/serve", () => ({ serveMediaObject: h.serve }));
vi.mock("@/lib/media/route-guard", () => ({ guardMediaRead: h.guard }));

import { GET, HEAD } from "./route";

const row = { id: "m1", storageKey: "k/a.pdf", mimeType: "application/pdf", filename: "a.pdf", updatedAt: new Date(0) };
const call = (qs = "") =>
  GET(new Request(`http://x/api/media/m1${qs}`), { params: Promise.resolve({ id: "m1" }) });

beforeEach(() => {
  h.serve.mockReset();
  h.serve.mockResolvedValue(new Response("ok"));
  h.guard.mockReset();
  h.guard.mockResolvedValue({ ok: true, row });
});

describe("GET /api/media/[id]", () => {
  it("sert en ligne par défaut (aperçu, vignettes)", async () => {
    await call();
    expect(h.serve.mock.calls[0][0].inline).toBe(true);
  });

  it("?download=1 force Content-Disposition: attachment", async () => {
    await call("?download=1");
    expect(h.serve.mock.calls[0][0].inline).toBe(false);
  });

  it("une autre valeur de download reste en ligne", async () => {
    await call("?download=0");
    expect(h.serve.mock.calls[0][0].inline).toBe(true);
  });

  it("le refus du garde est renvoyé tel quel", async () => {
    const res = new Response(null, { status: 404 });
    h.guard.mockResolvedValue({ ok: false, res });
    expect(await call("?download=1")).toBe(res);
    expect(h.serve).not.toHaveBeenCalled();
  });

  it("HEAD : mêmes contrôles d'accès, transmet la requête HEAD au service", async () => {
    await HEAD(new Request("http://x/api/media/m1", { method: "HEAD" }), { params: Promise.resolve({ id: "m1" }) });
    expect(h.guard).toHaveBeenCalledWith("m1");
    expect(h.serve.mock.calls[0][0].req.method).toBe("HEAD");
  });

  it("HEAD : le refus du garde est renvoyé tel quel", async () => {
    const res = new Response(null, { status: 404 });
    h.guard.mockResolvedValue({ ok: false, res });
    expect(await HEAD(new Request("http://x/api/media/m1", { method: "HEAD" }), { params: Promise.resolve({ id: "m1" }) })).toBe(res);
    expect(h.serve).not.toHaveBeenCalled();
  });
});
