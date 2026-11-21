import { describe, it, expect, vi, beforeEach } from "vitest";

const h = vi.hoisted(() => ({
  user: { id: "u1" } as unknown,
  list: vi.fn(),
  stats: vi.fn(),
}));

vi.mock("@/lib/auth/get-user", () => ({ getSessionUser: () => Promise.resolve(h.user) }));
vi.mock("@/lib/org/get-request-org", () => ({ getRequestOrgId: () => Promise.resolve("org1") }));
vi.mock("@/lib/media/ingest", () => ({ ingestMedia: vi.fn() }));
vi.mock("@/lib/media/list", () => ({ listMedia: h.list, getLibraryStats: h.stats }));

import { NextRequest } from "next/server";

const req = (qs = "") => new NextRequest("http://x/api/media" + qs);

beforeEach(() => {
  vi.clearAllMocks();
  h.user = { id: "u1" };
  h.list.mockResolvedValue({ items: [], nextCursor: null });
  h.stats.mockResolvedValue({ total: 0 });
});

describe("GET /api/media", () => {
  it("401 sans session", async () => {
    h.user = null;
    const { GET } = await import("@/app/api/media/route");
    expect((await GET(req())).status).toBe(401);
  });
  it("400 sur un type inconnu, avec le message", async () => {
    const { GET } = await import("@/app/api/media/route");
    const res = await GET(req("?kind=exe"));
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe("Type inconnu");
    expect(h.list).not.toHaveBeenCalled();
  });
  it("400 sur un curseur forgé", async () => {
    const { GET } = await import("@/app/api/media/route");
    expect((await GET(req("?cursor=zzz"))).status).toBe(400);
  });
  it("borne limit à 100", async () => {
    const { GET } = await import("@/app/api/media/route");
    await GET(req("?limit=100000"));
    expect(h.list.mock.calls[0][2].limit).toBe(100);
  });
  it("Cache-Control private, no-store", async () => {
    const { GET } = await import("@/app/api/media/route");
    const res = await GET(req());
    expect(res.status).toBe(200);
    expect(res.headers.get("Cache-Control")).toBe("private, no-store");
    expect(await res.json()).toEqual({ items: [], nextCursor: null });
  });
});

describe("GET /api/media/stats", () => {
  it("401 sans session", async () => {
    h.user = null;
    const { GET } = await import("@/app/api/media/stats/route");
    expect((await GET()).status).toBe(401);
  });
  it("200 avec no-store", async () => {
    const { GET } = await import("@/app/api/media/stats/route");
    const res = await GET();
    expect(res.status).toBe(200);
    expect(res.headers.get("Cache-Control")).toBe("private, no-store");
  });
});
