import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextResponse, NextRequest } from "next/server";

const h = vi.hoisted(() => ({
  access: null as unknown,
  ctx: null as unknown,
  fiche: null as unknown,
  scope: null as unknown,
  resolve: vi.fn(),
  rowScope: vi.fn(),
  interactions: vi.fn(),
  tasks: vi.fn(),
  listMails: vi.fn(),
  dealExists: vi.fn(),
}));

vi.mock("@/lib/crm/access", () => ({ requireCrm: vi.fn(async () => h.access) }));
vi.mock("@/lib/crm/context", () => ({ loadCrmContext: vi.fn(async () => h.ctx) }));
vi.mock("@/lib/mailing/crm-trace", () => ({
  resolveFicheContext: (...a: unknown[]) => {
    h.resolve(...a);
    return h.fiche;
  },
}));
vi.mock("@/lib/databases/row-route-access", () => ({
  requireRowScope: (...a: unknown[]) => {
    h.rowScope(...a);
    return h.scope;
  },
}));
vi.mock("@/lib/mailing/threads", async (orig) => ({
  ...(await orig<typeof import("@/lib/mailing/threads")>()),
  listFicheMails: (...a: unknown[]) => h.listMails(...a),
}));
vi.mock("@/lib/crm/activity", async (orig) => ({
  ...(await orig<typeof import("@/lib/crm/activity")>()),
  loadActivityInteractions: (...a: unknown[]) => h.interactions(...a),
  loadActivityTasks: (...a: unknown[]) => h.tasks(...a),
  dealExists: (...a: unknown[]) => h.dealExists(...a),
}));
vi.mock("@/lib/db", () => ({ db: {} }));

import { GET } from "../route";

const DB = "11111111-1111-4111-8111-111111111111";
const ROW = "22222222-2222-4222-8222-222222222222";
const ok = () => ({ ok: true, user: { id: "u1" }, orgId: "org1", isAdmin: false, enabled: true });
const get = (q = `databaseId=${DB}&rowId=${ROW}`) => new NextRequest(`http://x/api/crm/activity?${q}`);
const fakeCtx = (canLog = true) => ({
  databaseId: (role: string) => (role === "dossiers" ? DB : "99999999-9999-4999-8999-999999999999"),
  columns: { interactions: [], dossiers: [], contacts: [] },
  fieldColumn: () => (canLog ? "c1" : null),
  canEdit: () => true,
});
const fiche = (role: "dossiers" | "contacts") => ({
  role, contactRowId: ROW, contactDatabaseId: DB, contactEmail: null, contactName: "C",
  dossiers: [], defaultDossierRowId: null, fixedDossierRowId: null,
});
const mailRow = (over: Record<string, unknown> = {}) => ({
  id: "m1", messageId: "<m@x>", direction: "out", status: "sent", fromAddr: "a@x.fr", from: "a@x.fr",
  to: ["b@x.fr"], cc: [], bcc: ["secret@x.fr"], subject: "S", bodyHtml: "<p>x</p>", bodyText: "x",
  attachments: [], sentAt: new Date("2026-11-20T10:00:00Z"), scheduledAt: null, createdAt: new Date("2026-11-20T09:00:00Z"),
  ...over,
});

beforeEach(() => {
  h.access = ok();
  h.ctx = fakeCtx();
  h.fiche = fiche("dossiers");
  h.scope = { userId: "u1", userName: "U", orgId: "org1", spaceId: "s1", permission: "viewer" };
  h.resolve.mockClear();
  h.rowScope.mockClear();
  h.interactions.mockReset().mockResolvedValue([]);
  h.tasks.mockReset().mockResolvedValue([]);
  h.listMails.mockReset().mockResolvedValue([]);
  h.dealExists.mockReset().mockResolvedValue(true);
});

describe("GET /api/crm/activity", () => {
  it("returns the access response (401/403/404) without touching sources", async () => {
    h.access = { ok: false, response: NextResponse.json({ error: "x" }, { status: 401 }) };
    expect((await GET(get())).status).toBe(401);
    h.access = { ok: false, response: NextResponse.json({ error: "x" }, { status: 403 }) };
    expect((await GET(get())).status).toBe(403);
    expect(h.interactions).not.toHaveBeenCalled();
  });

  it("returns a silent 404 for non-uuid params", async () => {
    expect((await GET(get("databaseId=zz&rowId=yy"))).status).toBe(404);
    expect((await GET(get(`databaseId=${DB}`))).status).toBe(404);
    expect(h.resolve).not.toHaveBeenCalled();
  });

  it("returns 404 when the fiche is of another organization (resolveFicheContext null)", async () => {
    h.fiche = null;
    h.ctx = { ...fakeCtx(), databaseId: () => "88888888-8888-4888-8888-888888888888" };
    expect((await GET(get())).status).toBe(404);
    expect(h.interactions).not.toHaveBeenCalled();
    expect(h.tasks).not.toHaveBeenCalled();
  });

  it("dossier without linked contact: interactions and tasks served, mails empty and never queried", async () => {
    h.fiche = null;
    h.interactions.mockResolvedValue([{ id: "i1", date: "2026-11-21", type: "appel", title: "t", note: null, dealId: ROW }]);
    h.tasks.mockResolvedValue([{ id: "t1", title: "Relancer", dueAt: "2026-11-22T08:00:00.000Z" }]);
    const res = await GET(get());
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.role).toBe("dossiers");
    expect(body.partial).toEqual([]);
    expect(body.items.map((i: { kind: string }) => i.kind)).toEqual(["task", "interaction"]);
    expect(h.interactions.mock.calls[0][1]).toEqual({ kind: "deal", rowId: ROW });
    expect(h.listMails).not.toHaveBeenCalled();
    expect(h.rowScope.mock.calls[0][1]).toMatchObject({ databaseId: DB, rowId: ROW, min: "viewer" });
  });

  it("no contact and database of another organization: silent 404", async () => {
    h.fiche = null;
    h.ctx = { ...fakeCtx(), databaseId: () => "88888888-8888-4888-8888-888888888888" };
    expect((await GET(get())).status).toBe(404);
    expect(h.dealExists).not.toHaveBeenCalled();
    expect(h.interactions).not.toHaveBeenCalled();
    expect(h.tasks).not.toHaveBeenCalled();
  });

  it("no contact and row absent from the Dossiers base: silent 404", async () => {
    h.fiche = null;
    h.dealExists.mockResolvedValue(false);
    expect((await GET(get())).status).toBe(404);
    expect(h.tasks).not.toHaveBeenCalled();
  });

  it("no contact but database not readable (requireRowScope refuses): 404", async () => {
    h.fiche = null;
    h.scope = NextResponse.json({ error: "Introuvable" }, { status: 404 });
    expect((await GET(get())).status).toBe(404);
    expect(h.tasks).not.toHaveBeenCalled();
  });

  it("canToggle is true for assignee or author, false for others", async () => {
    h.tasks.mockResolvedValue([
      { id: "a", title: "A", dueAt: null, assigneeId: "u1", createdBy: "x" },
      { id: "b", title: "B", dueAt: null, assigneeId: "x", createdBy: "u1" },
      { id: "c", title: "C", dueAt: null, assigneeId: "x", createdBy: "y" },
      { id: "d", title: "D", dueAt: null, assigneeId: null, createdBy: "y" },
    ]);
    const body = await (await GET(get())).json();
    const by = Object.fromEntries(body.items.map((i: { id: string; task: { canToggle: boolean } }) => [i.id, i.task.canToggle]));
    expect(by).toEqual({ a: true, b: true, c: false, d: false });
  });

  it("returns 404 when the database is not readable (requireRowScope refuses)", async () => {
    h.scope = NextResponse.json({ error: "Introuvable" }, { status: 404 });
    expect((await GET(get())).status).toBe(404);
    expect(h.tasks).not.toHaveBeenCalled();
    expect(h.rowScope.mock.calls[0][1]).toMatchObject({ databaseId: DB, rowId: ROW, min: "viewer" });
  });

  it("deal fiche: deal scope for interactions and mails, canLogInteraction true", async () => {
    h.interactions.mockResolvedValue([{ id: "i1", date: "2026-11-21", type: "appel", title: "t", note: null, dealId: ROW }]);
    h.tasks.mockResolvedValue([{ id: "t1", title: "Relancer", dueAt: "2026-11-22T08:00:00.000Z" }]);
    h.listMails.mockResolvedValue([mailRow()]);
    const res = await GET(get());
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.role).toBe("dossiers");
    expect(body.canLogInteraction).toBe(true);
    expect(body.partial).toEqual([]);
    expect(body.items.map((i: { kind: string }) => i.kind)).toEqual(["task", "interaction", "mail"]);
    expect(h.interactions.mock.calls[0][1]).toEqual({ kind: "deal", rowId: ROW });
    expect(h.tasks.mock.calls[0][1]).toEqual({ databaseId: DB, rowId: ROW });
    expect(h.listMails.mock.calls[0]).toEqual(["org1", "u1", { kind: "dossier", dossierRowId: ROW }]);
  });

  it("contact fiche: contact scope, no interaction logging", async () => {
    h.fiche = fiche("contacts");
    const res = await GET(get());
    const body = await res.json();
    expect(body.role).toBe("contacts");
    expect(body.canLogInteraction).toBe(false);
    expect(h.interactions.mock.calls[0][1]).toEqual({ kind: "contact", rowId: ROW });
    expect(h.listMails.mock.calls[0]).toEqual(["org1", "u1", { kind: "contact", contactRowId: ROW }]);
  });

  it("canLogInteraction is false when the connection cannot log", async () => {
    h.ctx = fakeCtx(false);
    expect((await (await GET(get())).json()).canLogInteraction).toBe(false);
  });

  it("scopes mails to the session user: listFicheMails is called with the session user id", async () => {
    h.listMails.mockImplementation(async (_o: string, userId: string) => (userId === "u1" ? [] : [mailRow({ id: "other" })]));
    const body = await (await GET(get())).json();
    expect(body.items.find((i: { id: string }) => i.id === "other")).toBeUndefined();
    expect(h.listMails.mock.calls[0][1]).toBe("u1");
  });

  it("hides cancelled mails and exposes no bodyHtml, bcc or storage key", async () => {
    h.listMails.mockResolvedValue([
      mailRow({ id: "ok", attachments: [{ filename: "a.pdf", size: 3, storageKey: "k/secret", contentType: "application/pdf" }] }),
      mailRow({ id: "c", status: "cancelled" }),
    ]);
    const body = await (await GET(get())).json();
    const mails = body.items.filter((i: { kind: string }) => i.kind === "mail");
    expect(mails.map((m: { id: string }) => m.id)).toEqual(["ok"]);
    const json = JSON.stringify(body);
    expect(mails[0].mail.bodyHtml).toBe("");
    expect(mails[0].mail.bcc).toEqual([]);
    expect(json).not.toContain("storageKey");
    expect(json).not.toContain("k/secret");
    expect(json).not.toContain("secret@x.fr");
  });

  it("a failing source yields an empty list for it, others stay, and partial names it", async () => {
    h.interactions.mockRejectedValue(new Error("boom"));
    h.tasks.mockResolvedValue([{ id: "t1", title: "T", dueAt: null }]);
    const res = await GET(get());
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.partial).toEqual(["interactions"]);
    expect(body.items.map((i: { kind: string }) => i.kind)).toEqual(["task"]);
  });

  it("null interactions (fiche not in the role base) is partial, not a 500", async () => {
    h.interactions.mockResolvedValue(null);
    const body = await (await GET(get())).json();
    expect(body.partial).toEqual(["interactions"]);
  });

  it("sorts YYYY-MM-DD interactions and ISO tasks on the same timeline", async () => {
    h.interactions.mockResolvedValue([{ id: "i1", date: "2026-11-20", type: "a", title: "t", note: null, dealId: ROW }]);
    h.tasks.mockResolvedValue([
      { id: "t1", title: "A", dueAt: "2026-11-20T08:00:00.000Z" },
      { id: "t2", title: "B", dueAt: "2026-11-19T23:00:00.000Z" },
    ]);
    const body = await (await GET(get())).json();
    expect(body.items.map((i: { id: string }) => i.id)).toEqual(["t1", "i1", "t2"]);
  });
});
