import { describe, it, expect, vi, beforeEach } from "vitest";

const h = vi.hoisted(() => ({
  user: { id: "u1" } as unknown,
  org: "org1" as string | null,
  list: vi.fn(),
  create: vi.fn(),
}));

vi.mock("@/lib/auth/get-user", () => ({ getSessionUser: () => Promise.resolve(h.user) }));
vi.mock("@/lib/org/get-request-org", () => ({ getRequestOrgId: () => Promise.resolve(h.org) }));
vi.mock("@/lib/media/tags", async () => {
  class TagError extends Error {
    status: number;
    constructor(status: number, message: string) {
      super(message);
      this.status = status;
    }
  }
  return { TagError, listTags: h.list, createTag: h.create };
});

import { NextRequest } from "next/server";
import { TagError } from "@/lib/media/tags";

const post = (body: unknown) =>
  new NextRequest("http://x/api/media/tags", {
    method: "POST",
    body: typeof body === "string" ? body : JSON.stringify(body),
  });

beforeEach(() => {
  vi.clearAllMocks();
  h.user = { id: "u1" };
  h.org = "org1";
});

describe("/api/media/tags", () => {
  it("401 sans session", async () => {
    h.user = null;
    const r = await import("@/app/api/media/tags/route");
    expect((await r.GET()).status).toBe(401);
    expect((await r.POST(post({}))).status).toBe(401);
  });
  it("403 sans organisation", async () => {
    h.org = null;
    const r = await import("@/app/api/media/tags/route");
    expect((await r.GET()).status).toBe(403);
  });
  it("GET liste pour l'organisation de la requête, sans cache", async () => {
    h.list.mockResolvedValue([{ id: "t", label: "Logo", count: 1 }]);
    const { GET } = await import("@/app/api/media/tags/route");
    const res = await GET();
    expect(h.list).toHaveBeenCalledWith(h.user, "org1");
    expect(res.headers.get("Cache-Control")).toBe("private, no-store");
    expect((await res.json()).tags).toHaveLength(1);
  });
  it("POST 201", async () => {
    h.create.mockResolvedValue({ id: "t", label: "Logo" });
    const { POST } = await import("@/app/api/media/tags/route");
    const res = await POST(post({ label: "Logo" }));
    expect(res.status).toBe(201);
    expect(h.create).toHaveBeenCalledWith(h.user, "org1", "Logo");
  });
  it("POST viewer : 403", async () => {
    h.create.mockRejectedValue(new TagError(403, "Droits insuffisants"));
    const { POST } = await import("@/app/api/media/tags/route");
    expect((await POST(post({ label: "Logo" }))).status).toBe(403);
  });
  it("POST libellé trop long : 400 ; JSON invalide : 400", async () => {
    h.create.mockRejectedValue(new TagError(400, "Tag trop long"));
    const { POST } = await import("@/app/api/media/tags/route");
    expect((await POST(post({ label: "x" }))).status).toBe(400);
    expect((await POST(post("pas du json"))).status).toBe(400);
  });
});
