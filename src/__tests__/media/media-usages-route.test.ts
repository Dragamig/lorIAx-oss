import { describe, it, expect, vi, beforeEach } from "vitest";

const h = vi.hoisted(() => ({
  user: { id: "u1" } as unknown,
  org: "org1" as string | null,
  usages: vi.fn(),
  summary: vi.fn(),
}));
vi.mock("@/lib/auth/get-user", () => ({ getSessionUser: () => Promise.resolve(h.user) }));
vi.mock("@/lib/org/get-request-org", () => ({ getRequestOrgId: () => Promise.resolve(h.org) }));
vi.mock("@/lib/media/usage-links", () => ({
  SUMMARY_MAX_IDS: 200,
  getMediaUsages: h.usages,
  summarizeUsages: h.summary,
}));

vi.mock("@/lib/media/library-settings", () => ({
  getLibrarySettings: () => Promise.resolve({ trashRetentionDays: 30 }),
}));

import { NextRequest } from "next/server";

const ID = "11111111-1111-4111-8111-111111111111";
const params = (id = ID) => ({ params: Promise.resolve({ id }) });
const post = (body: unknown) =>
  new NextRequest("http://x", { method: "POST", body: typeof body === "string" ? body : JSON.stringify(body) });

beforeEach(() => {
  vi.clearAllMocks();
  h.user = { id: "u1" };
  h.org = "org1";
});

describe("GET /api/media/[id]/usages", () => {
  it("401, 404 (null, id invalide), 200", async () => {
    const r = await import("@/app/api/media/[id]/usages/route");
    h.user = null;
    expect((await r.GET(new NextRequest("http://x"), params())).status).toBe(401);
    h.user = { id: "u1" };
    h.usages.mockResolvedValueOnce(null);
    expect((await r.GET(new NextRequest("http://x"), params())).status).toBe(404);
    expect((await r.GET(new NextRequest("http://x"), params("x"))).status).toBe(404);
    h.usages.mockResolvedValueOnce({ entries: [], hiddenCount: 2 });
    const ok = await r.GET(new NextRequest("http://x"), params());
    expect(ok.status).toBe(200);
    expect((await ok.json()).hiddenCount).toBe(2);
  });
});

describe("POST /api/media/usages-summary", () => {
  it("401 sans session", async () => {
    const r = await import("@/app/api/media/usages-summary/route");
    h.user = null;
    expect((await r.POST(post({ ids: [] }))).status).toBe(401);
  });
  it("400 : plus de 200 ids, non uuid, corps invalide", async () => {
    const r = await import("@/app/api/media/usages-summary/route");
    const many = Array.from({ length: 201 }, () => ID);
    expect((await r.POST(post({ ids: many }))).status).toBe(400);
    expect((await r.POST(post({ ids: ["x"] }))).status).toBe(400);
    expect((await r.POST(post("nope"))).status).toBe(400);
    expect(h.summary).not.toHaveBeenCalled();
  });
  it("200 transmet les ids", async () => {
    const r = await import("@/app/api/media/usages-summary/route");
    h.summary.mockResolvedValue({ perMedia: {}, usedCount: 0 });
    const res = await r.POST(post({ ids: [ID] }));
    expect(res.status).toBe(200);
    expect(h.summary).toHaveBeenCalledWith(h.user, "org1", [ID]);
    expect((await res.json()).trashRetentionDays).toBe(30);
  });
});
