import { describe, it, expect, vi, beforeEach } from "vitest";

const h = vi.hoisted(() => ({
  user: { id: "u1" } as unknown,
  org: "org1" as string | null,
  find: vi.fn(),
}));

vi.mock("@/lib/auth/get-user", () => ({ getSessionUser: () => Promise.resolve(h.user) }));
vi.mock("@/lib/org/get-request-org", () => ({ getRequestOrgId: () => Promise.resolve(h.org) }));
vi.mock("@/lib/media/duplicates", async (orig) => ({
  ...(await orig<typeof import("@/lib/media/duplicates")>()),
  findDuplicates: h.find,
}));

import { NextRequest } from "next/server";
import { POST } from "@/app/api/media/duplicates/route";

const A = "a".repeat(64);
const post = (body: unknown) =>
  new NextRequest("http://x/api/media/duplicates", {
    method: "POST",
    body: typeof body === "string" ? body : JSON.stringify(body),
  });

beforeEach(() => {
  vi.clearAllMocks();
  h.user = { id: "u1" };
  h.org = "org1";
  h.find.mockResolvedValue({});
});

describe("POST /api/media/duplicates", () => {
  it("401 sans session, 403 sans organisation", async () => {
    h.user = null;
    expect((await POST(post({ checksums: [A] }))).status).toBe(401);
    h.user = { id: "u1" };
    h.org = null;
    expect((await POST(post({ checksums: [A] }))).status).toBe(403);
  });

  it("400 : JSON invalide, tableau absent, somme mal formée, plus de 100 sommes", async () => {
    expect((await POST(post("pas du json"))).status).toBe(400);
    expect((await POST(post({}))).status).toBe(400);
    expect((await POST(post({ checksums: ["xyz"] }))).status).toBe(400);
    expect((await POST(post({ checksums: [A.toUpperCase()] }))).status).toBe(400);
    expect((await POST(post({ checksums: Array(101).fill(A) }))).status).toBe(400);
    expect(h.find).not.toHaveBeenCalled();
  });

  it("200 : transmet user, organisation et sommes, sans cache", async () => {
    h.find.mockResolvedValue({ [A]: { id: "m1", filename: "a.png", spaceName: null, thumbnailUrl: null } });
    const res = await POST(post({ checksums: [A] }));
    expect(res.status).toBe(200);
    expect(h.find).toHaveBeenCalledWith(h.user, "org1", [A]);
    expect(res.headers.get("Cache-Control")).toBe("private, no-store");
    expect((await res.json()).duplicates[A].id).toBe("m1");
  });
});
