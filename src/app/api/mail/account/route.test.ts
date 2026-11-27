import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextResponse, NextRequest } from "next/server";

const h = vi.hoisted(() => ({
  session: true,
  row: null as Record<string, unknown> | null,
  deleted: [] as unknown[],
  audit: vi.fn(),
  test: vi.fn(),
  exceeded: false,
  consume: vi.fn(),
}));
vi.mock("@/lib/rate-limit", () => ({
  getClientIpOrNull: () => null,
  peekQuotaExceeded: async () => h.exceeded,
  consumeQuota: (...a: unknown[]) => h.consume(...a),
}));
vi.mock("@/lib/mailing/connection-test", () => ({ testMailConnection: (...a: unknown[]) => h.test(...a) }));

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
vi.mock("@/lib/audit/log", () => ({ auditLog: (...a: unknown[]) => h.audit(...a) }));
vi.mock("@/lib/crypto", () => ({ encrypt: (v: string) => `enc:${v}`, decrypt: (v: string) => v }));
vi.mock("@/lib/db", () => ({
  db: {
    select: () => ({ from: () => ({ where: () => ({ limit: async () => (h.row ? [h.row] : []) }) }) }),
    update: () => ({
      set: (v: Record<string, unknown>) => ({
        where: () => {
          const apply = () => { h.row = { ...h.row, ...v }; return [h.row]; };
          return {
            returning: async () => apply(),
            then: (resolve: (x: unknown) => void) => resolve(apply()),
          };
        },
      }),
    }),
    insert: () => ({
      values: (v: Record<string, unknown>) => ({ returning: async () => { h.row = { id: "m1", ...v }; return [h.row]; } }),
    }),
    delete: () => ({ where: () => ({ returning: async () => (h.row ? [{ id: "m1" }] : []) }) }),
  },
}));

import { GET, PUT, DELETE } from "./route";
import { MASKED_SECRET } from "@/lib/settings/secrets";

const valid = {
  address: "a@b.fr", displayName: "A", smtpHost: "smtp.b.fr", smtpPort: 465, smtpSecurity: "ssl",
  imapHost: "imap.b.fr", imapPort: 993, imapSecurity: "ssl", password: "secret",
  signature: "", cancelDelaySeconds: 10, pollIntervalMinutes: 5,
};
const req = (method: string, body?: unknown) =>
  new NextRequest("http://x/api/mail/account", {
    method,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
const stored = () => ({
  id: "m1", organizationId: "org1", userId: "u1", ...valid, password: undefined, passwordEnc: "enc:old",
  status: "ok", statusMessage: null,
});

beforeEach(() => {
  h.session = true;
  h.row = null;
  h.audit.mockClear();
  h.exceeded = false;
  h.consume.mockReset();
  h.test.mockReset();
  h.test.mockResolvedValue({ smtp: { ok: true, message: "ok" }, imap: { ok: true, message: "ok" } });
});

describe("account route", () => {
  it("GET returns 401 without session", async () => {
    h.session = false;
    expect((await GET(req("GET"))).status).toBe(401);
  });
  it("GET returns null account when none", async () => {
    const r = await GET(req("GET"));
    expect(await r.json()).toEqual({ account: null });
  });
  it("GET never contains passwordEnc nor a clear password", async () => {
    h.row = stored();
    const text = JSON.stringify(await (await GET(req("GET"))).json());
    expect(text).not.toContain("passwordEnc");
    expect(text).not.toContain("enc:old");
    expect(text).toContain(MASKED_SECRET);
  });
  it("PUT with masked password leaves passwordEnc untouched", async () => {
    h.row = stored();
    const r = await PUT(req("PUT", { ...valid, password: MASKED_SECRET }));
    expect(r.status).toBe(200);
    expect(h.row?.passwordEnc).toBe("enc:old");
  });
  it("PUT with cancelDelaySeconds 7 returns 400", async () => {
    expect((await PUT(req("PUT", { ...valid, cancelDelaySeconds: 7 }))).status).toBe(400);
  });
  it("PUT with unknown field returns 400", async () => {
    expect((await PUT(req("PUT", { ...valid, userId: "evil" }))).status).toBe(400);
  });
  it("PUT tests the connection when it changes and stores ok", async () => {
    h.row = stored();
    const r = await PUT(req("PUT", { ...valid, password: "nouveau", smtpHost: "smtp.autre.fr" }));
    expect(h.test).toHaveBeenCalledTimes(1);
    expect(h.test.mock.calls[0][0]).toMatchObject({ smtpHost: "smtp.autre.fr", address: "a@b.fr" });
    expect(h.row?.status).toBe("ok");
    expect((await r.json()).account.status).toBe("ok");
  });
  it("PUT stores error with a readable message when the test fails", async () => {
    h.row = stored();
    h.test.mockResolvedValue({ smtp: { ok: false, message: "authentification refusée" }, imap: { ok: true, message: "ok" } });
    const r = await PUT(req("PUT", { ...valid, password: "nouveau", smtpHost: "smtp.autre.fr" }));
    expect(r.status).toBe(200);
    expect(h.row?.status).toBe("error");
    expect(h.row?.statusMessage).toContain("smtp: authentification refusée");
    expect((await r.json()).account.status).toBe("error");
  });
  it("PUT stays unverified, still 200, when the test itself crashes", async () => {
    h.row = stored();
    h.test.mockRejectedValue(new Error("boom"));
    const r = await PUT(req("PUT", { ...valid, password: "nouveau", smtpHost: "smtp.autre.fr" }));
    expect(r.status).toBe(200);
    expect(h.row?.status).toBe("unverified");
  });
  it("PUT with an exhausted save quota returns 429 and writes nothing", async () => {
    h.row = stored();
    h.exceeded = true;
    const r = await PUT(req("PUT", { ...valid, password: "nouveau", smtpHost: "smtp.autre.fr" }));
    expect(r.status).toBe(429);
    expect(await r.json()).toMatchObject({ code: "rate_limited" });
    expect(h.test).not.toHaveBeenCalled();
    expect(h.row?.smtpHost).toBe("smtp.b.fr");
    expect(h.row?.passwordEnc).toBe("enc:old");
    expect(h.audit).not.toHaveBeenCalled();
  });
  it("PUT uses its own save quota, distinct from the Test button", async () => {
    h.row = stored();
    await PUT(req("PUT", { ...valid, password: "nouveau", smtpHost: "smtp.autre.fr" }));
    expect(h.consume).toHaveBeenCalledWith("mail-account-save:u1", [expect.objectContaining({ maxRequests: 60 })]);
    expect(h.consume).not.toHaveBeenCalledWith("mail-test:u1", expect.anything());
  });

  it("PUT creating an account tests it too", async () => {
    await PUT(req("PUT", valid));
    expect(h.test).toHaveBeenCalledTimes(1);
    expect(h.row?.status).toBe("ok");
  });
  it("PUT returns 400 password_required when a host changes with a masked password", async () => {
    h.row = stored();
    const r = await PUT(req("PUT", { ...valid, password: MASKED_SECRET, smtpHost: "evil.example" }));
    expect(r.status).toBe(400);
    expect(await r.json()).toMatchObject({ error: "password_required" });
    expect(h.row?.smtpHost).toBe("smtp.b.fr");
  });
  it("PUT keeps status when only the signature changes", async () => {
    h.row = stored();
    await PUT(req("PUT", { ...valid, password: MASKED_SECRET, signature: "Cordialement" }));
    expect(h.row?.status).toBe("ok");
    expect(h.test).not.toHaveBeenCalled();
  });
  it("DELETE of an account of another org returns 404", async () => {
    h.row = null;
    expect((await DELETE(req("DELETE"))).status).toBe(404);
    expect(h.audit).not.toHaveBeenCalled();
  });
  it("DELETE writes an audit log", async () => {
    h.row = stored();
    expect((await DELETE(req("DELETE"))).status).toBe(200);
    expect(h.audit).toHaveBeenCalledWith("mail.account.delete", "u1", expect.anything(), undefined);
  });
  it("PUT writes an audit log without the password", async () => {
    await PUT(req("PUT", valid));
    expect(h.audit).toHaveBeenCalledTimes(1);
    const [action, user, details] = h.audit.mock.calls[0];
    expect(action).toBe("mail.account.update");
    expect(user).toBe("u1");
    expect(JSON.stringify(details)).not.toContain("secret");
    expect(details).not.toHaveProperty("password");
  });
});
