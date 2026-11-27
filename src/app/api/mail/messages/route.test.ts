import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextResponse, NextRequest } from "next/server";

const h = vi.hoisted(() => {
  class MailError extends Error {
    constructor(public code: string, message = code, public detail?: { reason?: string; limit?: number; statusMessage?: string }) {
      super(message);
    }
  }
  class AttachmentError extends Error {
    constructor(public code: string) {
      super(code);
    }
  }
  return {
    MailError,
    AttachmentError,
    access: null as unknown,
    fiche: null as unknown,
    schedule: vi.fn(),
    list: vi.fn(),
    resolve: vi.fn(),
  };
});
vi.mock("@/lib/crm/access", () => ({ requireCrm: vi.fn(async () => h.access) }));
vi.mock("@/lib/mailing/crm-trace", () => ({
  resolveFicheContext: (...a: unknown[]) => {
    h.resolve(...a);
    return h.fiche;
  },
}));
vi.mock("@/lib/mailing/outbox", () => ({ MailError: h.MailError, scheduleMail: (...a: unknown[]) => h.schedule(...a) }));
vi.mock("@/lib/mailing/attachments", () => ({ AttachmentError: h.AttachmentError }));
vi.mock("@/lib/mailing/threads", async (orig) => ({
  ...(await orig<typeof import("@/lib/mailing/threads")>()),
  listFicheMails: (...a: unknown[]) => h.list(...a),
}));
vi.mock("@/lib/db", () => ({ db: {} }));

import { GET, POST } from "./route";

const DB = "11111111-1111-4111-8111-111111111111";
const ROW = "22222222-2222-4222-8222-222222222222";
const ok = () => ({ ok: true, user: { id: "u1" }, orgId: "org1", isAdmin: false, enabled: true });
const fiche = (over = {}) => ({
  role: "contacts", contactRowId: ROW, contactDatabaseId: DB, contactEmail: null, contactName: "C",
  dossiers: [], defaultDossierRowId: null, fixedDossierRowId: null, ...over,
});
const body = (over: Record<string, unknown> = {}) => ({
  clientKey: "33333333-3333-4333-8333-333333333333", databaseId: DB, rowId: ROW,
  to: ["c@x.fr"], subject: "Salut", bodyHtml: "<p>Bonjour</p>", attachments: [], ...over,
});
const post = (b: unknown) => new NextRequest("http://x/api/mail/messages", { method: "POST", body: JSON.stringify(b) });
const get = (q = `databaseId=${DB}&rowId=${ROW}`) => new NextRequest(`http://x/api/mail/messages?${q}`);

beforeEach(() => {
  h.access = ok();
  h.fiche = fiche();
  h.schedule.mockReset().mockResolvedValue({ messageId: "<m@x>", rowId: "row1", scheduledAt: new Date("2026-01-01T10:00:10Z"), cancelDelaySeconds: 10 });
  h.list.mockReset().mockResolvedValue([]);
  h.resolve.mockClear();
});

describe("POST /api/mail/messages", () => {
  it("returns 201 with id, scheduledAt and cancelDelaySeconds", async () => {
    const res = await POST(post(body()));
    expect(res.status).toBe(201);
    expect(await res.json()).toEqual({ id: "row1", scheduledAt: "2026-01-01T10:00:10.000Z", cancelDelaySeconds: 10 });
  });
  it("returns 404 for a fiche the user cannot read, without scheduling", async () => {
    h.fiche = null;
    expect((await POST(post(body()))).status).toBe(404);
    expect(h.schedule).not.toHaveBeenCalled();
    expect(h.resolve).toHaveBeenCalledWith("org1", "u1", { databaseId: DB, rowId: ROW });
  });
  it("returns 409 account_error with the reason when the last test failed", async () => {
    h.schedule.mockRejectedValue(new h.MailError("account_error", "x", { statusMessage: "smtp: 535 refusé" }));
    const res = await POST(post(body()));
    expect(res.status).toBe(409);
    const json = await res.json();
    expect(json.code).toBe("account_error");
    expect(json.detail).toBe("smtp: 535 refusé");
    expect(json.error).toContain("smtp: 535 refusé");
  });
  it("returns 409 with code no_account when no mailbox", async () => {
    h.schedule.mockRejectedValue(new h.MailError("no_account"));
    const res = await POST(post(body()));
    expect(res.status).toBe(409);
    expect((await res.json()).code).toBe("no_account");
  });
  it("returns 409 with code account_unverified and a French message when the mailbox is not verified", async () => {
    h.schedule.mockRejectedValue(new h.MailError("account_unverified"));
    const res = await POST(post(body()));
    expect(res.status).toBe(409);
    const json = await res.json();
    expect(json.code).toBe("account_unverified");
    expect(json.error).toBe("Boîte mail non vérifiée : lancez le test de connexion dans Paramètres, Mails");
  });
  it.each([
    ["plan", "quota_plan"],
    ["abuse", "quota_abuse"],
  ])("returns 429 with code %s", async (reason, code) => {
    h.schedule.mockRejectedValue(new h.MailError("quota", "q", { reason, limit: 5 }));
    const res = await POST(post(body()));
    expect(res.status).toBe(429);
    expect((await res.json()).code).toBe(code);
  });
  it("returns 404 when the outbox reports fiche_forbidden", async () => {
    h.schedule.mockRejectedValue(new h.MailError("fiche_forbidden"));
    expect((await POST(post(body()))).status).toBe(404);
  });
  it("returns 400 dossier_mismatch", async () => {
    h.schedule.mockRejectedValue(new h.MailError("dossier_mismatch"));
    const res = await POST(post(body()));
    expect(res.status).toBe(400);
    expect((await res.json()).code).toBe("dossier_mismatch");
  });
  it("returns 400 on invalid recipients", async () => {
    for (const to of [["pas-un-mail"], [], ["a@x.fr\r\nBcc: z@y.fr"]]) {
      const res = await POST(post(body({ to })));
      expect(res.status).toBe(400);
      expect((await res.json()).code).toBe("invalid_body");
    }
    expect(h.schedule).not.toHaveBeenCalled();
  });
  it("sends from the account of the session user, rejecting any userId or from in the body", async () => {
    expect((await POST(post(body({ userId: "u2" })))).status).toBe(400);
    expect((await POST(post(body({ from: "x@y.fr" })))).status).toBe(400);
    expect(h.schedule).not.toHaveBeenCalled();
    await POST(post(body()));
    const arg = h.schedule.mock.calls[0][0];
    expect(arg.userId).toBe("u1");
    expect(arg.orgId).toBe("org1");
    expect(arg.compose).not.toHaveProperty("userId");
  });
  it("maps attachment errors", async () => {
    h.schedule.mockRejectedValue(new h.AttachmentError("too_large"));
    expect((await POST(post(body()))).status).toBe(413);
    h.schedule.mockRejectedValue(new h.AttachmentError("forbidden"));
    expect((await POST(post(body()))).status).toBe(404);
  });
  it("returns the access response without session or CRM", async () => {
    h.access = { ok: false, response: NextResponse.json({ error: "x" }, { status: 401 }) };
    expect((await POST(post(body()))).status).toBe(401);
  });
});

describe("GET /api/mail/messages", () => {
  it("returns 404 when the fiche is not readable", async () => {
    h.fiche = null;
    expect((await GET(get())).status).toBe(404);
    expect(h.list).not.toHaveBeenCalled();
  });
  it("scopes a contact fiche by contact and always by org and session user", async () => {
    await GET(get());
    expect(h.list).toHaveBeenCalledWith("org1", "u1", { kind: "contact", contactRowId: ROW });
  });
  it("scopes a dossier fiche by that dossier only", async () => {
    h.fiche = fiche({ role: "dossiers", fixedDossierRowId: ROW });
    await GET(get());
    expect(h.list).toHaveBeenCalledWith("org1", "u1", { kind: "dossier", dossierRowId: ROW });
  });
  it("returns conversations without secrets", async () => {
    const res = await GET(get());
    expect(await res.json()).toEqual({ conversations: [] });
  });
});
