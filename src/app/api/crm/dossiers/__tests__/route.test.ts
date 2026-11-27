import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest, NextResponse } from "next/server";

const h = vi.hoisted(() => ({ access: "ok" as "ok" | "401" | "404", ctx: {} as object | null }));

vi.mock("@/lib/crm/access", () => ({
  requireCrm: vi.fn(async () => {
    if (h.access === "401") return { ok: false, response: NextResponse.json({ error: "Non authentifié" }, { status: 401 }) };
    if (h.access === "404") return { ok: false, response: NextResponse.json({ error: "Introuvable" }, { status: 404 }) };
    return { ok: true, user: { id: "u1" }, orgId: "org1", isAdmin: false, enabled: true };
  }),
}));
vi.mock("@/lib/crm/context", () => ({ loadCrmContext: vi.fn(async () => h.ctx) }));
vi.mock("@/lib/crm/dossiers", () => ({ loadDossiers: vi.fn(async () => ({ rows: [] })) }));

import { GET } from "@/app/api/crm/dossiers/route";
const get = () => GET(new NextRequest("http://x/api/crm/dossiers"));

beforeEach(() => {
  h.access = "ok";
  h.ctx = {};
});

describe("GET /api/crm/dossiers", () => {
  it("session absente : 401", async () => {
    h.access = "401";
    expect((await get()).status).toBe(401);
  });
  it("module inactif : 404", async () => {
    h.access = "404";
    expect((await get()).status).toBe(404);
  });
  it("contexte nul : 404 uniforme", async () => {
    h.ctx = null;
    const res = await get();
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: "Introuvable" });
  });
  it("nominal : 200", async () => {
    const res = await get();
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ rows: [] });
  });
});
