import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest, NextResponse } from "next/server";

const h = vi.hoisted(() => ({
  access: "ok" as "ok" | "404",
  isAdmin: true,
  existing: false,
  requireOpts: [] as unknown[],
  listCalls: [] as unknown[][],
  list: [] as unknown[],
  spaces: [] as { id: string; name: string }[],
  collisionCalls: [] as unknown[][],
  collisions: {} as unknown,
  orgs: [] as unknown[],
  userArgs: [] as unknown[],
}));

vi.mock("@/lib/crm/access", () => ({
  requireCrm: vi.fn(async (opts: { level: string; requireEnabled: boolean }) => {
    h.requireOpts.push(opts);
    if (h.access === "404") return { ok: false, response: NextResponse.json({ error: "Introuvable" }, { status: 404 }) };
    if (opts.level === "admin" && !h.isAdmin)
      return { ok: false, response: NextResponse.json({ error: "Accès refusé" }, { status: 403 }) };
    return { ok: true, user: { id: "u1", globalRole: "admin" }, orgId: "org1", isAdmin: h.isAdmin, enabled: false };
  }),
}));
vi.mock("@/lib/crm/connection", () => ({
  listCandidates: vi.fn(async (...a: unknown[]) => {
    h.listCalls.push(a);
    return h.list;
  }),
  hasConnectionRow: vi.fn(async () => h.existing),
}));
vi.mock("@/lib/crm/preview", async (orig) => {
  const real = await orig<typeof import("@/lib/crm/preview")>();
  return {
    ...real,
    listEditableSpaces: vi.fn(async () => h.spaces),
    findCollisions: vi.fn(async (...a: unknown[]) => {
      h.collisionCalls.push(a);
      return h.collisions;
    }),
  };
});
vi.mock("@/lib/crm/orgs", () => ({
  listCrmAdminOrgs: vi.fn(async (u: unknown) => {
    h.userArgs.push(u);
    return h.orgs;
  }),
}));

import { GET as previewGET } from "@/app/api/crm/activate/preview/route";

const cand = (databaseId: string, name: string, score: number, compatible: boolean) => ({
  databaseId, name, spaceId: "s", spaceName: "S", columns: [], proposal: {}, score, compatible,
  status: compatible ? "compatible" : "none", missing: [],
});
const getP = (cookie?: string) =>
  previewGET(new NextRequest("http://x/api/crm/activate/preview?orgId=autre", cookie ? { headers: { cookie } } : undefined));

beforeEach(() => {
  h.access = "ok";
  h.isAdmin = true;
  h.existing = false;
  h.requireOpts = [];
  h.listCalls = [];
  h.list = [];
  h.spaces = [];
  h.collisionCalls = [];
  h.collisions = { contacts: [], dossiers: [], interactions: [] };
  h.orgs = [];
  h.userArgs = [];
});

describe("GET /api/crm/activate/preview", () => {
  it("fonctionne sans activation (requireEnabled false)", async () => {
    const res = await getP();
    expect(res.status).toBe(200);
    expect(h.requireOpts[0]).toEqual({ level: "admin", requireEnabled: false });
  });
  it("membre : 403 ; module absent : 404", async () => {
    h.isAdmin = false;
    expect((await getP()).status).toBe(403);
    h.isAdmin = true;
    h.access = "404";
    expect((await getP()).status).toBe(404);
  });
  it("preselected : meilleur score compatible, égalité par nom", async () => {
    h.list = [cand("d3", "Zeta", 5, true), cand("d2", "Beta", 5, true), cand("d1", "Alpha", 7, false)];
    const j = await (await getP()).json();
    expect(j.roles.contacts.preselected).toBe("d2");
    expect(Object.keys(j.roles)).toEqual(["contacts", "dossiers", "interactions"]);
  });
  it("candidats listés avec l'organisation de la requête, relationTargetKnown vrai et libellés de champ de la locale", async () => {
    await getP("NEXT_LOCALE=en");
    const call = h.listCalls[0];
    expect(call.slice(0, 3)).toEqual(["org1", "u1", "contacts"]);
    const opts = call[4] as { relationTargetKnown: boolean; fieldLabel: (r: string, k: string) => string };
    expect(opts.relationTargetKnown).toBe(true);
    expect(opts.fieldLabel("contacts", "email")).not.toBe("email");
    expect(opts.fieldLabel("contacts", "inexistant")).toBe("inexistant");
  });
  it("existing vrai si ligne présente", async () => {
    h.existing = true;
    expect((await (await getP()).json()).existing).toBe(true);
  });
  it("spaces rendus tels que fournis par l'organisation de la requête, sans autre champ", async () => {
    h.spaces = [{ id: "s1", name: "Ventes" }];
    const j = await (await getP()).json();
    expect(j.spaces).toEqual([{ id: "s1", name: "Ventes" }]);
  });
  it("suggestedSpaceId null sans espace « CRM », collisions calculées pour null", async () => {
    h.spaces = [{ id: "s1", name: "Ventes" }];
    const j = await (await getP()).json();
    expect(j.suggestedSpaceId).toBeNull();
    expect(h.collisionCalls[0][0]).toBeNull();
  });
  it("suggestedSpaceId : espace « CRM » éditable, casse et espaces ignorés ; collisions pour cet espace avec les noms de création", async () => {
    h.spaces = [{ id: "s1", name: "Ventes" }, { id: "s2", name: "  crm " }];
    h.collisions = { contacts: [{ databaseId: "d1", name: "Contacts" }], dossiers: [], interactions: [] };
    const j = await (await getP()).json();
    expect(j.suggestedSpaceId).toBe("s2");
    expect(h.collisionCalls[0][0]).toBe("s2");
    expect(h.collisionCalls[0][1]).toEqual({ contacts: "Contacts", dossiers: "Dossiers", interactions: "Interactions" });
    expect(j.collisions.contacts).toEqual([{ databaseId: "d1", name: "Contacts" }]);
  });
  it("orgs : slug et nom seulement, utilisateur de la session, jamais un id du client", async () => {
    h.orgs = [{ slug: "alpha", name: "Alpha" }];
    const j = await (await getP()).json();
    expect(j.orgs).toEqual([{ slug: "alpha", name: "Alpha" }]);
    expect(JSON.stringify(j.orgs)).not.toMatch(/id/i);
    expect(h.userArgs[0]).toMatchObject({ id: "u1" });
  });
});
