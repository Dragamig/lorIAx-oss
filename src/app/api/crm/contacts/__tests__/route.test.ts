import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest, NextResponse } from "next/server";

const h = vi.hoisted(() => ({ access: "ok" as "ok" | "401" | "404", ctx: {} as object | null, calls: [] as unknown[][] }));

vi.mock("@/lib/crm/access", () => ({
  requireCrm: vi.fn(async () => {
    if (h.access === "401") return { ok: false, response: NextResponse.json({ error: "Non authentifié" }, { status: 401 }) };
    if (h.access === "404") return { ok: false, response: NextResponse.json({ error: "Introuvable" }, { status: 404 }) };
    return { ok: true, user: { id: "u1" }, orgId: "org1", isAdmin: false, enabled: true };
  }),
}));
vi.mock("@/lib/crm/context", () => ({ loadCrmContext: vi.fn(async () => h.ctx) }));
vi.mock("@/lib/crm/contacts", () => ({
  CONTACT_SEARCH_MAX: 100,
  loadContacts: vi.fn(async (...a: unknown[]) => {
    h.calls.push(a);
    return { contacts: [] };
  }),
}));

import { GET } from "@/app/api/crm/contacts/route";
const get = (q = "") => GET(new NextRequest(`http://x/api/crm/contacts${q}`));

beforeEach(() => {
  h.access = "ok";
  h.ctx = {};
  h.calls = [];
});

describe("GET /api/crm/contacts", () => {
  it("session absente : 401", async () => {
    h.access = "401";
    expect((await get()).status).toBe(401);
  });
  it("module inactif : 404", async () => {
    h.access = "404";
    expect((await get()).status).toBe(404);
  });
  it("recherche de plus de 100 caractères : 400", async () => {
    const res = await get(`?search=${"a".repeat(101)}`);
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "Paramètres invalides", code: "invalid_params" });
    expect(h.calls).toHaveLength(0);
  });
  it("contexte nul : 404 uniforme", async () => {
    h.ctx = null;
    const res = await get();
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: "Introuvable" });
  });
  it("transmet la recherche", async () => {
    expect((await get("?search=dup&tz=Europe/Paris")).status).toBe(200);
    expect(h.calls[0][1]).toEqual({ search: "dup", tz: "Europe/Paris" });
  });
});
