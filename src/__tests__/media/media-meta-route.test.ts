import { describe, it, expect, vi, beforeEach } from "vitest";

const h = vi.hoisted(() => ({
  user: { id: "u1" } as unknown,
  org: "org1" as string | null,
  get: vi.fn(),
  update: vi.fn(),
}));

vi.mock("@/lib/auth/get-user", () => ({ getSessionUser: () => Promise.resolve(h.user) }));
vi.mock("@/lib/org/get-request-org", () => ({ getRequestOrgId: () => Promise.resolve(h.org) }));
vi.mock("@/lib/media/tags", () => ({ TagError: class TagError extends Error { status = 400; } }));
vi.mock("@/lib/media/metadata", () => {
  class MetadataError extends Error {
    status: number;
    constructor(status: number, message: string) {
      super(message);
      this.status = status;
    }
  }
  return { MetadataError, getMediaDetail: h.get, updateMedia: h.update };
});

import { NextRequest } from "next/server";
import { MetadataError } from "@/lib/media/metadata";

const ID = "11111111-1111-4111-8111-111111111111";
const params = { params: Promise.resolve({ id: ID }) };
const patch = (body: unknown) =>
  new NextRequest("http://x", {
    method: "PATCH",
    body: typeof body === "string" ? body : JSON.stringify(body),
  });

beforeEach(() => {
  vi.clearAllMocks();
  h.user = { id: "u1" };
  h.org = "org1";
});

describe("/api/media/[id]/meta", () => {
  it("401 sans session", async () => {
    h.user = null;
    const r = await import("@/app/api/media/[id]/meta/route");
    expect((await r.GET(new NextRequest("http://x"), params)).status).toBe(401);
    expect((await r.PATCH(patch({}), params)).status).toBe(401);
  });
  it("GET 404 si non lisible, 200 sinon", async () => {
    const r = await import("@/app/api/media/[id]/meta/route");
    h.get.mockResolvedValueOnce(null);
    expect((await r.GET(new NextRequest("http://x"), params)).status).toBe(404);
    h.get.mockResolvedValueOnce({ id: ID });
    const ok = await r.GET(new NextRequest("http://x"), params);
    expect(ok.status).toBe(200);
    expect((await ok.json()).media.id).toBe(ID);
  });
  it("id non uuid : 404", async () => {
    const r = await import("@/app/api/media/[id]/meta/route");
    const res = await r.GET(new NextRequest("http://x"), { params: Promise.resolve({ id: "x" }) });
    expect(res.status).toBe(404);
  });
  it("PATCH 200 et transmet le patch", async () => {
    h.update.mockResolvedValue({ id: ID });
    const r = await import("@/app/api/media/[id]/meta/route");
    const res = await r.PATCH(patch({ title: "x", tags: ["a"] }), params);
    expect(res.status).toBe(200);
    expect(h.update).toHaveBeenCalledWith(h.user, "org1", ID, { title: "x", tags: ["a"] });
  });
  it("PATCH : champ inconnu (deleted) refusé par zod strict", async () => {
    const r = await import("@/app/api/media/[id]/meta/route");
    expect((await r.PATCH(patch({ deleted: true }), params)).status).toBe(400);
    expect((await r.PATCH(patch({ deletedAt: null }), params)).status).toBe(400);
    expect(h.update).not.toHaveBeenCalled();
  });
  it("PATCH : JSON invalide 400 ; folderId non uuid 400", async () => {
    const r = await import("@/app/api/media/[id]/meta/route");
    expect((await r.PATCH(patch("nope"), params)).status).toBe(400);
    expect((await r.PATCH(patch({ folderId: "abc" }), params)).status).toBe(400);
  });
  it("PATCH : MetadataError 403 et 404 relayées", async () => {
    const r = await import("@/app/api/media/[id]/meta/route");
    h.update.mockRejectedValueOnce(new MetadataError(403, "no"));
    expect((await r.PATCH(patch({ title: "x" }), params)).status).toBe(403);
    h.update.mockRejectedValueOnce(new MetadataError(404, "no"));
    expect((await r.PATCH(patch({ title: "x" }), params)).status).toBe(404);
  });
});
