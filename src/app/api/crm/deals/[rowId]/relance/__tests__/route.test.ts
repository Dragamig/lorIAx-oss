import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest, NextResponse } from "next/server";

const h = vi.hoisted(() => ({
  access: "ok" as "ok" | "401" | "404",
  ctx: {} as object | null,
  result: { status: "ok", relance: "2026-11-25" } as object,
}));

vi.mock("@/lib/crm/access", () => ({
  requireCrm: vi.fn(async () => {
    if (h.access === "401") return { ok: false, response: NextResponse.json({ error: "Non authentifié" }, { status: 401 }) };
    if (h.access === "404") return { ok: false, response: NextResponse.json({ error: "Introuvable" }, { status: 404 }) };
    return { ok: true, user: { id: "u1" }, orgId: "org1", isAdmin: false, enabled: true };
  }),
}));
vi.mock("@/lib/crm/context", () => ({ loadCrmContext: vi.fn(async () => h.ctx) }));
vi.mock("@/lib/crm/relance-write", async (orig) => ({
  ...(await orig<typeof import("@/lib/crm/relance-write")>()),
  writeRelance: vi.fn(async () => h.result),
}));

import { POST } from "@/app/api/crm/deals/[rowId]/relance/route";

const params = { params: Promise.resolve({ rowId: "r1" }) };
const post = (body: unknown) =>
  POST(new NextRequest("http://x/api/crm/deals/r1/relance", { method: "POST", body: JSON.stringify(body) }), params);

beforeEach(() => {
  h.access = "ok";
  h.ctx = {};
  h.result = { status: "ok", relance: "2026-11-25" };
});

describe("POST deals/[rowId]/relance", () => {
  it("session absente : 401", async () => {
    h.access = "401";
    expect((await post({ done: true })).status).toBe(401);
  });
  it("module inactif : 404", async () => {
    h.access = "404";
    expect((await post({ done: true })).status).toBe(404);
  });
  it("corps invalide : 400 invalid_params", async () => {
    h.result = { status: "invalid_params" };
    const res = await post({ snoozeDays: -1 });
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "Paramètres invalides", code: "invalid_params" });
  });
  it("contexte absent : 404", async () => {
    h.ctx = null;
    expect((await post({ done: true })).status).toBe(404);
  });
  it("introuvable : 404 uniforme", async () => {
    h.result = { status: "not_found" };
    const res = await post({ done: true });
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: "Introuvable" });
  });
  it("past_date : 400", async () => {
    h.result = { status: "error", code: "past_date" };
    const res = await post({ date: "2020-01-01" });
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "Paramètres invalides", code: "past_date" });
  });
  it("succès : relance", async () => {
    const res = await post({ snoozeDays: 7 });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ relance: "2026-11-25" });
  });
});
