import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest, NextResponse } from "next/server";

const h = vi.hoisted(() => ({
  access: "ok" as "ok" | "401" | "404",
  ctx: {} as object | null,
  calls: [] as unknown[][],
  counts: [] as unknown[][],
}));

vi.mock("@/lib/crm/access", () => ({
  requireCrm: vi.fn(async () => {
    if (h.access === "401") return { ok: false, response: NextResponse.json({ error: "Non authentifié" }, { status: 401 }) };
    if (h.access === "404") return { ok: false, response: NextResponse.json({ error: "Introuvable" }, { status: 404 }) };
    return { ok: true, user: { id: "u1" }, orgId: "org1", isAdmin: false, enabled: true };
  }),
}));
vi.mock("@/lib/crm/context", () => ({ loadCrmContext: vi.fn(async () => h.ctx) }));
vi.mock("@/lib/crm/relances", () => ({
  loadRelances: vi.fn(async (...a: unknown[]) => {
    h.calls.push(a);
    return { groups: { late: [], today: [], week: [] } };
  }),
  countRelances: vi.fn(async (...a: unknown[]) => {
    h.counts.push(a);
    return 3;
  }),
}));

import { GET } from "@/app/api/crm/relances/route";
import { GET as COUNT } from "@/app/api/crm/relances/count/route";

const get = (q = "") => GET(new NextRequest(`http://x/api/crm/relances${q}`));
const count = (q = "") => COUNT(new NextRequest(`http://x/api/crm/relances/count${q}`));

beforeEach(() => {
  h.access = "ok";
  h.ctx = {};
  h.calls = [];
  h.counts = [];
});

describe("GET /api/crm/relances", () => {
  it("session absente : 401", async () => {
    h.access = "401";
    expect((await get()).status).toBe(401);
  });
  it("module inactif : 404", async () => {
    h.access = "404";
    expect((await get()).status).toBe(404);
  });
  it.each(["0", "999", "abc", "1.5", "32"])("horizon=%s : 400", async (v) => {
    const res = await get(`?horizon=${v}`);
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
  it("défaut : horizon 7, mine faux", async () => {
    await get();
    expect(h.calls[0][1]).toEqual({ horizon: 7, mine: false, tz: undefined });
  });
  it("passe les paramètres", async () => {
    const res = await get("?horizon=31&mine=1&tz=Europe/Paris");
    expect(res.status).toBe(200);
    expect(h.calls[0][1]).toEqual({ horizon: 31, mine: true, tz: "Europe/Paris" });
  });
});

describe("GET /api/crm/relances/count", () => {
  it("session absente : 401", async () => {
    h.access = "401";
    expect((await count()).status).toBe(401);
  });
  it("contexte nul : 404 uniforme", async () => {
    h.ctx = null;
    const res = await count();
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: "Introuvable" });
  });
  it("rend { count }", async () => {
    const res = await count("?tz=Europe/Paris");
    expect(await res.json()).toEqual({ count: 3 });
    expect(h.counts[0][1]).toEqual({ tz: "Europe/Paris" });
  });
});
