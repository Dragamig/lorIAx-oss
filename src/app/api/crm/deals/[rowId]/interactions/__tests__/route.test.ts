import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest, NextResponse } from "next/server";

const h = vi.hoisted(() => ({
  access: "ok" as "ok" | "401" | "404",
  ctx: {} as object | null,
  // Simule la lib : droit d'écriture refusé => 404 avant toute validation du corps.
  allowed: true,
  created: { id: "i1", type: "Appel" } as object,
}));

vi.mock("@/lib/crm/access", () => ({
  requireCrm: vi.fn(async () => {
    if (h.access === "401") return { ok: false, response: NextResponse.json({ error: "Non authentifié" }, { status: 401 }) };
    if (h.access === "404") return { ok: false, response: NextResponse.json({ error: "Introuvable" }, { status: 404 }) };
    return { ok: true, user: { id: "u1" }, orgId: "org1", isAdmin: false, enabled: true };
  }),
}));
vi.mock("@/lib/crm/context", () => ({ loadCrmContext: vi.fn(async () => h.ctx) }));
vi.mock("@/lib/crm/deals", () => ({ listDealInteractions: vi.fn(async () => []) }));
vi.mock("@/lib/crm/interaction-write", async (orig) => {
  const real = await orig<typeof import("@/lib/crm/interaction-write")>();
  return {
    ...real,
    createInteraction: vi.fn(async (_ctx: unknown, _id: string, body: unknown) => {
      if (!h.allowed) return { status: "not_found" };
      if (!real.interactionBody.safeParse(body).success) return { status: "invalid_params" };
      return { status: "ok", interaction: h.created };
    }),
  };
});

import { POST } from "@/app/api/crm/deals/[rowId]/interactions/route";

const params = { params: Promise.resolve({ rowId: "r1" }) };
const post = (body: unknown) =>
  POST(new NextRequest("http://x/api/crm/deals/r1/interactions", { method: "POST", body: JSON.stringify(body) }), params);

beforeEach(() => {
  h.access = "ok";
  h.ctx = {};
  h.allowed = true;
});

describe("POST deals/[rowId]/interactions", () => {
  it("corps invalide, utilisateur autorisé : 400 invalid_params", async () => {
    const res = await post({ type: "" });
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "Paramètres invalides", code: "invalid_params" });
  });
  it("succès : 201 et interaction", async () => {
    const res = await post({ type: "Appel" });
    expect(res.status).toBe(201);
    expect(await res.json()).toEqual({ interaction: { id: "i1", type: "Appel" } });
  });
  it("sans droit d'écriture et corps invalide : 404 avant 400", async () => {
    h.allowed = false;
    const res = await post({ type: "" });
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: "Introuvable" });
  });
});
