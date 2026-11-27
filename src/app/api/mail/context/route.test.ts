import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextResponse, NextRequest } from "next/server";

const h = vi.hoisted(() => ({
  access: null as unknown,
  fiche: null as unknown,
  account: null as unknown,
  resolve: vi.fn(),
}));
vi.mock("@/lib/crm/access", () => ({ requireCrm: vi.fn(async () => h.access) }));
vi.mock("@/lib/mailing/crm-trace", () => ({
  resolveFicheContext: (...a: unknown[]) => {
    h.resolve(...a);
    return h.fiche;
  },
}));
vi.mock("@/lib/mailing/accounts", () => ({ getAccountFor: async () => h.account }));
vi.mock("@/lib/mailing/quota", () => ({ peekMailQuota: async () => ({ exceeded: false, limit: 50 }) }));
vi.mock("@/lib/mailing/tick", () => ({ getTraceAlert: async () => ({ pending: 2, crmDisconnected: false }) }));

import { GET } from "./route";

const DB = "11111111-1111-4111-8111-111111111111";
const ROW = "22222222-2222-4222-8222-222222222222";
const req = (q = `databaseId=${DB}&rowId=${ROW}`) => new NextRequest(`http://x/api/mail/context?${q}`);
const ok = () => ({ ok: true, user: { id: "u1" }, orgId: "org1", isAdmin: false, enabled: true });
const fiche = () => ({
  role: "contacts", contactRowId: ROW, contactDatabaseId: DB, contactEmail: "c@x.fr", contactName: "Camille",
  dossiers: [{ rowId: "d1", title: "Dossier", updatedAt: new Date("2026-01-01T00:00:00Z") }],
  defaultDossierRowId: "d1", fixedDossierRowId: null,
});

beforeEach(() => {
  h.access = ok();
  h.fiche = fiche();
  h.account = null;
  h.resolve.mockClear();
});

describe("GET /api/mail/context", () => {
  it("returns the access response when the CRM is not enabled (404)", async () => {
    h.access = { ok: false, response: NextResponse.json({ error: "Introuvable" }, { status: 404 }) };
    expect((await GET(req())).status).toBe(404);
    expect(h.resolve).not.toHaveBeenCalled();
  });
  it("returns 404 for a row of another organization (resolveFicheContext null)", async () => {
    h.fiche = null;
    const res = await GET(req());
    expect(res.status).toBe(404);
    expect(h.resolve).toHaveBeenCalledWith("org1", "u1", { databaseId: DB, rowId: ROW });
  });
  it("returns 404 on malformed ids", async () => {
    expect((await GET(req("databaseId=x&rowId=y"))).status).toBe(404);
  });
  it("reports mailbox.configured false without account", async () => {
    const body = await (await GET(req())).json();
    expect(body.mailbox).toEqual({ configured: false, address: null, signature: "", cancelDelaySeconds: 10 });
    expect(body.viewer).toEqual({ orgId: "org1", userId: "u1" });
    expect(body.role).toBe("contacts");
    expect(body.contact).toEqual({ rowId: ROW, name: "Camille", email: "c@x.fr" });
    expect(body.quota).toEqual({ limit: 50, exceeded: false });
    expect(body.alert).toEqual({ pending: 2, crmDisconnected: false });
    expect(body.dossiers[0].rowId).toBe("d1");
  });
  it("never contains passwordEnc", async () => {
    h.account = { address: "a@b.fr", signature: "S", cancelDelaySeconds: 20, passwordEnc: "enc:secret", smtpHost: "h" };
    const text = JSON.stringify(await (await GET(req())).json());
    expect(text).not.toContain("passwordEnc");
    expect(text).not.toContain("enc:secret");
    expect(text).toContain("a@b.fr");
  });
});
