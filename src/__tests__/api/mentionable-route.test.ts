import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest, NextResponse } from "next/server";

const h = vi.hoisted(() => ({
  scope: "ok" as "ok" | 404,
  candidates: [] as Array<{ id: string; name: string; avatarUrl: string | null; email?: string }>,
  denied: new Set<string>(),
  limitArg: undefined as number | undefined,
  pages: [] as number[],
  matchEmailOnly: false,
  whereArg: undefined as unknown,
}));

vi.mock("@/lib/auth/require-org-scoped", () => {
  class OrgScopeError extends Error {
    constructor(public response: Response) {
      super("scope");
    }
  }
  return {
    OrgScopeError,
    requireOrgScoped: vi.fn(async () => {
      if (h.scope === 404) throw new OrgScopeError(NextResponse.json({ error: "Introuvable" }, { status: 404 }));
      return { user: { id: "u1", name: "Ana" }, orgId: "org1", spaceId: "space1", permission: "viewer" };
    }),
  };
});
vi.mock("@/lib/db", () => {
  const chain: Record<string, unknown> = {};
  chain.select = () => chain;
  chain.from = () => chain;
  chain.innerJoin = () => chain;
  chain.where = (w: unknown) => {
    h.whereArg = w;
    return chain;
  };
  chain.orderBy = () => chain;
  chain.limit = (n: number) => {
    h.limitArg = n;
    return {
      offset: async (o: number) => {
        h.pages.push(o);
        return h.matchEmailOnly ? [] : h.candidates.slice(o, o + n);
      },
    };
  };
  return { db: chain };
});
vi.mock("@/lib/databases/row-eligibility", () => ({
  makeCanView: vi.fn(() => async (id: string) => !h.denied.has(id)),
}));

import { GET } from "@/app/api/databases/[databaseId]/mentionable/route";

const DB = "11111111-1111-4111-8111-111111111111";
const get = (qs = "") =>
  GET(new NextRequest(`http://localhost/api/x${qs}`), { params: Promise.resolve({ databaseId: DB }) });
const mk = (n: number) =>
  Array.from({ length: n }, (_, i) => ({ id: `id${i}`, name: `N${i}`, avatarUrl: null, email: `e${i}@x.fr` }));

beforeEach(() => {
  h.scope = "ok";
  h.candidates = mk(3);
  h.denied = new Set();
  h.limitArg = undefined;
  h.pages = [];
  h.matchEmailOnly = false;
  h.whereArg = undefined;
});

describe("GET mentionable", () => {
  it("autre organisation et base inexistante : 404", async () => {
    h.scope = 404;
    expect((await get()).status).toBe(404);
    const r = await GET(new NextRequest("http://localhost/api/x"), {
      params: Promise.resolve({ databaseId: "pas-un-uuid" }),
    });
    expect(r.status).toBe(404);
  });
  it("viewer autorisé", async () => {
    const r = await get();
    expect(r.status).toBe(200);
    expect((await r.json()).map((u: { id: string }) => u.id)).toEqual(["id0", "id1", "id2"]);
  });
  it("la réponse ne contient aucun champ email", async () => {
    const body = await (await get()).json();
    for (const u of body) expect(Object.keys(u).sort()).toEqual(["avatarUrl", "id", "name"]);
    expect(JSON.stringify(body)).not.toContain("@x.fr");
  });
  it("un membre sans accès à l'espace est absent", async () => {
    h.denied.add("id1");
    const body = await (await get()).json();
    expect(body.map((u: { id: string }) => u.id)).toEqual(["id0", "id2"]);
  });
  it.each(["0", "11", "abc"])("limit=%s : 400", async (l) => {
    expect((await get(`?limit=${l}`)).status).toBe(400);
  });
  it("défaut 8", async () => {
    h.candidates = mk(20);
    expect((await (await get()).json()).length).toBe(8);
    expect((await (await get("?limit=3")).json()).length).toBe(3);
  });
  it("la recherche porte sur le nom seulement : un courriel seul ne renvoie rien", async () => {
    h.matchEmailOnly = true;
    const r = await get("?q=e1%40x.fr");
    expect(h.whereArg).toBeDefined();
    expect(await r.json()).toEqual([]);
  });
  it("première page sans éligible, seconde avec un : il est renvoyé", async () => {
    h.candidates = mk(60);
    for (let i = 0; i < 50; i++) h.denied.add(`id${i}`);
    const body = await (await get("?limit=2")).json();
    expect(body.map((u: { id: string }) => u.id)).toEqual(["id50", "id51"]);
    expect(h.pages).toEqual([0, 50]);
  });
  it("au plus 4 pages (200 candidats) examinées", async () => {
    h.candidates = mk(300);
    for (const c of h.candidates) h.denied.add(c.id);
    expect(await (await get()).json()).toEqual([]);
    expect(h.pages).toEqual([0, 50, 100, 150]);
  });
  it("arrêt dès que la page est courte", async () => {
    h.candidates = mk(3);
    await get();
    expect(h.pages).toEqual([0]);
  });
});
