import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

const h = vi.hoisted(() => ({
  row: null as Record<string, unknown> | null,
  exceeded: false,
  consume: vi.fn(),
  peek: vi.fn(),
  test: vi.fn(),
  setStatus: vi.fn(),
}));

vi.mock("@/lib/auth/require-org-scoped", () => {
  class OrgScopeError extends Error {
    constructor(public response: Response) {
      super("scope");
    }
  }
  return {
    OrgScopeError,
    requireOrgScoped: vi.fn(async () => ({ user: { id: "u1" }, orgId: "org1", orgSlug: "x" })),
  };
});
vi.mock("@/lib/rate-limit", () => ({
  peekQuotaExceeded: (...a: unknown[]) => h.peek(...a),
  consumeQuota: (...a: unknown[]) => h.consume(...a),
}));
vi.mock("@/lib/crypto", () => ({ encrypt: (v: string) => `enc:${v}`, decrypt: (v: string) => v.replace(/^enc:/, "") }));
vi.mock("@/lib/mailing/accounts", async (orig) => ({
  ...(await orig<typeof import("@/lib/mailing/accounts")>()),
  getAccountFor: vi.fn(async () => h.row),
  setAccountStatus: (...a: unknown[]) => h.setStatus(...a),
}));
vi.mock("@/lib/mailing/connection-test", () => ({ testMailConnection: (c: unknown) => h.test(c) }));
vi.mock("@/lib/db", () => ({ db: {} }));

import { POST } from "./route";
import { MASKED_SECRET } from "@/lib/settings/secrets";

const body = {
  address: "a@b.fr", smtpHost: "smtp.b.fr", smtpPort: 465, smtpSecurity: "ssl",
  imapHost: "imap.b.fr", imapPort: 993, imapSecurity: "ssl", password: "secret",
};
const req = (b: unknown) =>
  new NextRequest("http://x/api/mail/account/test", { method: "POST", body: JSON.stringify(b) });
const stored = { id: "m1", ...body, passwordEnc: "enc:secret" };

beforeEach(() => {
  vi.clearAllMocks();
  h.row = null;
  h.peek.mockResolvedValue(false);
  h.test.mockResolvedValue({ smtp: { ok: true, message: "ok" }, imap: { ok: true, message: "ok", inboxCount: 1 } });
});

describe("POST /api/mail/account/test", () => {
  it("route is rate limited to 10 tests per hour per user", async () => {
    h.peek.mockResolvedValue(true);
    const res = await POST(req(body));
    expect(res.status).toBe(429);
    expect(h.test).not.toHaveBeenCalled();
    h.peek.mockResolvedValue(false);
    await POST(req(body));
    expect(h.peek.mock.calls[0][0]).toContain("u1");
    expect(h.peek.mock.calls[0][1]).toEqual([{ maxRequests: 10, windowMs: 3_600_000 }]);
    expect(h.consume).toHaveBeenCalledTimes(1);
  });

  it("route returns 400 when masked password and no stored account", async () => {
    const res = await POST(req({ ...body, password: MASKED_SECRET }));
    expect(res.status).toBe(400);
    expect(h.test).not.toHaveBeenCalled();
  });

  it("returns 400 when the stored account has no password", async () => {
    h.row = { ...stored, passwordEnc: null };
    const res = await POST(req({ ...body, password: "" }));
    expect(res.status).toBe(400);
  });

  it("uses the stored password and updates status when config matches", async () => {
    h.row = stored;
    const res = await POST(req({ ...body, password: MASKED_SECRET }));
    expect(res.status).toBe(200);
    expect(h.test.mock.calls[0][0].password).toBe("secret");
    expect(h.setStatus).toHaveBeenCalledWith("org1", "u1", "ok", null);
  });

  it("returns 400 password_required when a host changed and no password is typed", async () => {
    h.row = stored;
    for (const change of [{ smtpHost: "evil.example" }, { imapHost: "evil.example" }, { address: "x@evil.fr" }]) {
      const res = await POST(req({ ...body, ...change, password: MASKED_SECRET }));
      expect(res.status).toBe(400);
      expect(await res.json()).toMatchObject({ error: "password_required" });
    }
    expect(h.test).not.toHaveBeenCalled();
  });

  it("uses a typed password when a host changed", async () => {
    h.row = stored;
    const res = await POST(req({ ...body, smtpHost: "other.b.fr", password: "typed" }));
    expect(res.status).toBe(200);
    expect(h.test.mock.calls[0][0].password).toBe("typed");
  });

  it("does not touch the stored status when the tested config differs", async () => {
    h.row = stored;
    await POST(req({ ...body, smtpHost: "other.b.fr" }));
    expect(h.setStatus).not.toHaveBeenCalled();
  });

  it("never returns the password", async () => {
    const res = await POST(req(body));
    expect(JSON.stringify(await res.json())).not.toContain("secret");
  });
});
