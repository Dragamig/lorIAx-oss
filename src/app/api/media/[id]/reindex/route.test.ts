import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({ user: vi.fn(), full: vi.fn(), access: vi.fn(), reindex: vi.fn(), rate: vi.fn() }));
vi.mock("@/lib/auth/get-user", () => ({ getSessionUser: h.user }));
vi.mock("@/lib/media/access", () => ({ getMediaFull: h.full, resolveMediaAccess: h.access }));
vi.mock("@/lib/media/ai/reindex", () => ({ requestReindex: h.reindex }));
vi.mock("@/lib/rate-limit", async (orig) => ({
  ...(await orig<typeof import("@/lib/rate-limit")>()),
  checkRateLimitAsync: h.rate,
}));

import { POST } from "./route";

const ID = "11111111-1111-4111-8111-111111111111";
const call = (id = ID) => POST(new Request("http://x", { method: "POST" }), { params: Promise.resolve({ id }) });
const row = { id: ID, organizationId: "org1", deletedAt: null, mimeType: "application/pdf", filename: "a.pdf" };

beforeEach(() => {
  vi.clearAllMocks();
  h.user.mockResolvedValue({ id: "u1", globalRole: "member" });
  h.full.mockResolvedValue(row);
  h.access.mockResolvedValue({ allowed: true });
  h.rate.mockResolvedValue({ success: true, resetAt: Date.now() + 1000 });
  h.reindex.mockResolvedValue({ ok: true, status: "pending" });
});

describe("POST /api/media/[id]/reindex", () => {
  it("401 sans session", async () => {
    h.user.mockResolvedValue(null);
    expect((await call()).status).toBe(401);
  });
  it("404 : id invalide, inconnu, corbeille", async () => {
    expect((await call("zzz")).status).toBe(404);
    h.full.mockResolvedValue(null);
    expect((await call()).status).toBe(404);
    h.full.mockResolvedValue({ ...row, deletedAt: new Date() });
    expect((await call()).status).toBe(404);
    expect(h.reindex).not.toHaveBeenCalled();
  });
  it("404 muet quand la lecture est refusée (autre organisation, espace, hors espace)", async () => {
    h.access.mockResolvedValue({ allowed: false, reason: "org" });
    const res = await call();
    expect(res.status).toBe(404);
    expect(JSON.stringify(await res.json())).not.toContain("a.pdf");
  });
  it("403 : lecture permise, écriture refusée", async () => {
    h.access.mockImplementation(async (_u: unknown, _r: unknown, mode: string) =>
      mode === "read" ? { allowed: true } : { allowed: false, reason: "space" });
    expect((await call()).status).toBe(403);
    expect(h.reindex).not.toHaveBeenCalled();
  });
  it("429 si le quota de débit est atteint", async () => {
    h.rate.mockResolvedValue({ success: false, resetAt: Date.now() + 30_000 });
    const res = await call();
    expect(res.status).toBe(429);
    expect(res.headers.get("retry-after")).toBeTruthy();
    expect(h.reindex).not.toHaveBeenCalled();
  });
  it("409 indexation désactivée, 429 plafond du jour, avec motif", async () => {
    h.reindex.mockResolvedValue({ ok: false, status: 409, code: "index_disabled", error: "off" });
    let res = await call();
    expect(res.status).toBe(409);
    expect((await res.json()).code).toBe("index_disabled");
    h.reindex.mockResolvedValue({ ok: false, status: 429, code: "daily_cap", error: "cap" });
    res = await call();
    expect(res.status).toBe(429);
    expect((await res.json()).code).toBe("daily_cap");
  });
  it("200 : pending, clé de débit par utilisateur", async () => {
    const res = await call();
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ status: "pending" });
    expect(h.rate).toHaveBeenCalledWith("media-reindex:u1", expect.objectContaining({ maxRequests: 10 }));
  });
});
