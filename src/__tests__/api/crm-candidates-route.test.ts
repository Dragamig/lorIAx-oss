import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest, NextResponse } from "next/server";

const h = vi.hoisted(() => ({
  access: "ok" as "ok" | "404",
  isAdmin: true,
  requireOpts: [] as unknown[],
  listCalls: [] as unknown[][],
  list: [] as unknown[],
}));

vi.mock("@/lib/crm/access", () => ({
  requireCrm: vi.fn(async (opts: { level: string; requireEnabled: boolean }) => {
    h.requireOpts.push(opts);
    if (h.access === "404") return { ok: false, response: NextResponse.json({ error: "Introuvable" }, { status: 404 }) };
    if (opts.level === "admin" && !h.isAdmin)
      return { ok: false, response: NextResponse.json({ error: "Accès refusé" }, { status: 403 }) };
    return { ok: true, user: { id: "u1" }, orgId: "org1", isAdmin: h.isAdmin, enabled: false };
  }),
}));
vi.mock("@/lib/crm/connection", () => ({
  listCandidates: vi.fn(async (...a: unknown[]) => {
    h.listCalls.push(a);
    return h.list;
  }),
}));

import { GET as candidatesGET } from "@/app/api/crm/connection/candidates/route";

const cand = (databaseId: string, name: string, score: number, compatible: boolean) => ({
  databaseId, name, spaceId: "s", spaceName: "S", columns: [], proposal: {}, score, compatible,
});
const getC = (q = "") => candidatesGET(new NextRequest(`http://x/api/crm/connection/candidates${q}`));

beforeEach(() => {
  h.access = "ok";
  h.isAdmin = true;
  h.requireOpts = [];
  h.listCalls = [];
  h.list = [];
});

describe("GET /api/crm/connection/candidates", () => {
  it("membre : 403", async () => {
    h.isAdmin = false;
    expect((await getC("?role=contacts")).status).toBe(403);
  });
  it("module absent : 404", async () => {
    h.access = "404";
    expect((await getC("?role=contacts")).status).toBe(404);
  });
  it("role absent ou invalide : 400", async () => {
    expect((await getC()).status).toBe(400);
    expect((await getC("?role=zzz")).status).toBe(400);
  });
  it("liste avec l'organisation de la requête uniquement, jamais un id du client", async () => {
    h.list = [cand("d1", "A", 3, true)];
    const res = await getC("?role=dossiers&organizationId=autre&orgId=autre");
    const j = await res.json();
    expect(res.status).toBe(200);
    expect(j.role).toBe("dossiers");
    expect(j.candidates).toHaveLength(1);
    expect(h.listCalls[0].slice(0, 3)).toEqual(["org1", "u1", "dossiers"]);
    expect(h.requireOpts[0]).toEqual({ level: "admin", requireEnabled: true });
  });
});
