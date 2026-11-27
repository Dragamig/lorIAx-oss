import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest, NextResponse } from "next/server";

const h = vi.hoisted(() => ({
  access: "ok" as "ok" | "401" | "404",
  ctx: {} as object | null,
  calls: [] as unknown[][],
}));

vi.mock("@/lib/crm/access", () => ({
  requireCrm: vi.fn(async () => {
    if (h.access === "401") return { ok: false, response: NextResponse.json({ error: "Non authentifié" }, { status: 401 }) };
    if (h.access === "404") return { ok: false, response: NextResponse.json({ error: "Introuvable" }, { status: 404 }) };
    return { ok: true, user: { id: "u1" }, orgId: "org1", isAdmin: false, enabled: true };
  }),
}));
vi.mock("@/lib/crm/context", () => ({ loadCrmContext: vi.fn(async () => h.ctx) }));
vi.mock("@/lib/crm/pipeline", () => ({
  loadPipeline: vi.fn(async (...a: unknown[]) => {
    h.calls.push(a);
    return { deals: [] };
  }),
}));

import { GET } from "@/app/api/crm/pipeline/route";

const get = (q = "") => GET(new NextRequest(`http://x/api/crm/pipeline${q}`));

beforeEach(() => {
  h.access = "ok";
  h.ctx = {};
  h.calls = [];
});

describe("GET /api/crm/pipeline", () => {
  it("session absente : 401", async () => {
    h.access = "401";
    expect((await get()).status).toBe(401);
  });
  it("module inactif : 404", async () => {
    h.access = "404";
    const res = await get();
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: "Introuvable" });
  });
  it("ownerId non uuid : 400", async () => {
    expect((await get("?ownerId=abc")).status).toBe(400);
    expect(h.calls).toHaveLength(0);
  });
  it("contexte nul : 404 uniforme", async () => {
    h.ctx = null;
    const res = await get();
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: "Introuvable" });
  });
  it("passe les paramètres à loadPipeline", async () => {
    const id = "11111111-1111-4111-8111-111111111111";
    const res = await get(`?mine=1&late=true&ownerId=${id}&tz=Europe/Paris`);
    expect(res.status).toBe(200);
    expect(h.calls[0][1]).toEqual({ mine: true, late: true, ownerId: id, tz: "Europe/Paris" });
  });
  it("sans paramètre : tout à faux", async () => {
    await get();
    expect(h.calls[0][1]).toEqual({ mine: false, late: false, ownerId: null, tz: undefined });
  });
});
