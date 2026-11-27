import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextResponse, NextRequest } from "next/server";

const h = vi.hoisted(() => ({
  session: true,
  validation: { ok: true, ext: "pdf", safeName: "a.pdf", mime: "application/pdf" } as Record<string, unknown>,
  upload: vi.fn(),
  exceeded: false,
  consume: vi.fn(),
  peek: vi.fn(),
}));

vi.mock("@/lib/auth/require-org-scoped", () => {
  class OrgScopeError extends Error {
    constructor(public response: Response) {
      super("scope");
    }
  }
  return {
    OrgScopeError,
    requireOrgScoped: vi.fn(async () => {
      if (!h.session) throw new OrgScopeError(NextResponse.json({ error: "Non authentifié" }, { status: 401 }));
      return { user: { id: "u1" }, orgId: "org1", orgSlug: "x" };
    }),
  };
});
vi.mock("@/lib/media/validate-upload", () => ({ validateUpload: async () => h.validation }));
vi.mock("@/lib/rate-limit", () => ({
  peekQuotaExceeded: async (...a: unknown[]) => {
    h.peek(...a);
    return h.exceeded;
  },
  consumeQuota: async (...a: unknown[]) => {
    h.consume(...a);
  },
}));
vi.mock("@/lib/storage/s3", () => ({ uploadFile: (...a: unknown[]) => h.upload(...a) }));

import { POST } from "./route";

const req = (file?: File) => {
  const fd = new FormData();
  if (file) fd.set("file", file);
  return new NextRequest("http://x/api/mail/attachments", { method: "POST", body: fd });
};
const pdf = () => new File([new Uint8Array([1, 2, 3])], "a.pdf", { type: "application/pdf" });

beforeEach(() => {
  vi.clearAllMocks();
  h.session = true;
  h.exceeded = false;
  h.validation = { ok: true, ext: "pdf", safeName: "a.pdf", mime: "application/pdf" };
  h.upload.mockResolvedValue("k");
});

describe("POST /api/mail/attachments", () => {
  it("401 without session", async () => {
    h.session = false;
    expect((await POST(req(pdf()))).status).toBe(401);
  });
  it("400 without a file", async () => {
    expect((await POST(req())).status).toBe(400);
  });
  it("400 on a file refused by validateUpload", async () => {
    h.validation = { ok: false, status: 400, error: "Extension .exe non autorisée" };
    const res = await POST(req(pdf()));
    expect(res.status).toBe(400);
    expect(h.upload).not.toHaveBeenCalled();
  });
  it("413 when the file alone exceeds the mail cap", async () => {
    const big = new File([new Uint8Array(20 * 1024 * 1024 + 1)], "a.pdf", { type: "application/pdf" });
    expect((await POST(req(big))).status).toBe(413);
  });
  it("201 returns a ref with the user-scoped key", async () => {
    const res = await POST(req(pdf()));
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.source).toBe("upload");
    expect(body.storageKey).toMatch(/^mail\/org1\/u1\/[0-9a-f-]{36}-a\.pdf$/);
    expect(body).toMatchObject({ fileName: "a.pdf", mimeType: "application/pdf", size: 3 });
    expect(h.upload).toHaveBeenCalledWith(body.storageKey, expect.any(Buffer), "application/pdf");
  });
  it("429 with a stable code when the per-user upload limit is reached, nothing stored", async () => {
    h.exceeded = true;
    const res = await POST(req(pdf()));
    expect(res.status).toBe(429);
    expect((await res.json()).code).toBe("upload_rate_limited");
    expect(h.upload).not.toHaveBeenCalled();
    expect(h.consume).not.toHaveBeenCalled();
  });
  it("limits to 60 uploads per hour per user, key scoped to the user", async () => {
    await POST(req(pdf()));
    expect(h.peek).toHaveBeenCalledWith("mail-upload:u1", [{ maxRequests: 60, windowMs: 3_600_000 }]);
    expect(h.consume).toHaveBeenCalledWith("mail-upload:u1", [{ maxRequests: 60, windowMs: 3_600_000 }]);
  });
});
