import { describe, it, expect, vi, beforeEach } from "vitest";

const h = vi.hoisted(() => ({ user: { id: "u1" } as unknown, org: "org1" as string | null, erase: vi.fn() }));

vi.mock("@/lib/auth/get-user", () => ({ getSessionUser: () => Promise.resolve(h.user) }));
vi.mock("@/lib/org/get-request-org", () => ({ getRequestOrgId: () => Promise.resolve(h.org) }));
vi.mock("@/lib/media/purge", () => {
  class PurgeError extends Error {
    status: number;
    constructor(status: number, message: string) {
      super(message);
      this.status = status;
    }
  }
  return { PurgeError, eraseMediaForever: h.erase };
});

import { NextRequest } from "next/server";
import { PurgeError } from "@/lib/media/purge";

const ID = "11111111-1111-4111-8111-111111111111";
const call = async (id = ID) => {
  const r = await import("@/app/api/media/[id]/purge/route");
  return r.DELETE(new NextRequest("http://x", { method: "DELETE" }), { params: Promise.resolve({ id }) });
};

beforeEach(() => {
  vi.clearAllMocks();
  h.user = { id: "u1" };
  h.org = "org1";
});

describe("DELETE /api/media/[id]/purge", () => {
  it("401 sans session", async () => {
    h.user = null;
    expect((await call()).status).toBe(401);
    expect(h.erase).not.toHaveBeenCalled();
  });
  it("404 sans organisation ou id invalide", async () => {
    h.org = null;
    expect((await call()).status).toBe(404);
    h.org = "org1";
    expect((await call("x")).status).toBe(404);
  });
  it("403 et 404 de PurgeError relayés", async () => {
    h.erase.mockRejectedValueOnce(new PurgeError(403, "non"));
    expect((await call()).status).toBe(403);
    h.erase.mockRejectedValueOnce(new PurgeError(404, "non"));
    expect((await call()).status).toBe(404);
  });
  it("200 pour un admin", async () => {
    h.erase.mockResolvedValue(undefined);
    const res = await call();
    expect(res.status).toBe(200);
    expect(h.erase).toHaveBeenCalledWith(h.user, "org1", ID);
  });
});
