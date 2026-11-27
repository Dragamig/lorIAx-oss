import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest, NextResponse } from "next/server";

const h = vi.hoisted(() => ({
  access: "ok" as "ok" | "401" | "404",
  ctx: {} as object | null,
  deal: {} as object | null,
  list: [] as object[] | null,
}));

vi.mock("@/lib/crm/access", () => ({
  requireCrm: vi.fn(async () => {
    if (h.access === "401") return { ok: false, response: NextResponse.json({ error: "Non authentifié" }, { status: 401 }) };
    if (h.access === "404") return { ok: false, response: NextResponse.json({ error: "Introuvable" }, { status: 404 }) };
    return { ok: true, user: { id: "u1" }, orgId: "org1", isAdmin: false, enabled: true };
  }),
}));
vi.mock("@/lib/crm/context", () => ({ loadCrmContext: vi.fn(async () => h.ctx) }));
vi.mock("@/lib/crm/deals", () => ({
  loadDeal: vi.fn(async () => h.deal),
  listDealInteractions: vi.fn(async () => h.list),
}));

import { GET as getDeal } from "@/app/api/crm/deals/[rowId]/route";
import { GET as getInteractions } from "@/app/api/crm/deals/[rowId]/interactions/route";

const params = (rowId: string) => ({ params: Promise.resolve({ rowId }) });
const req = (p: string) => new NextRequest(`http://x/api/crm/deals/${p}`);

beforeEach(() => {
  h.access = "ok";
  h.ctx = {};
  h.deal = { deal: { id: "d" } };
  h.list = [];
});

describe.each([
  ["dossier", (id: string) => getDeal(req(id), params(id))],
  ["interactions", (id: string) => getInteractions(req(`${id}/interactions`), params(id))],
])("GET deals/[rowId] (%s)", (_n, call) => {
  it("session absente : 401", async () => {
    h.access = "401";
    expect((await call("a")).status).toBe(401);
  });
  it("module inactif : 404", async () => {
    h.access = "404";
    expect((await call("a")).status).toBe(404);
  });
  it("contexte nul : 404 uniforme", async () => {
    h.ctx = null;
    const res = await call("a");
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: "Introuvable" });
  });
  it("ligne introuvable : 404 uniforme", async () => {
    h.deal = null;
    h.list = null;
    const res = await call("a");
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: "Introuvable" });
  });
  it("trouvé : 200", async () => {
    expect((await call("a")).status).toBe(200);
  });
});
