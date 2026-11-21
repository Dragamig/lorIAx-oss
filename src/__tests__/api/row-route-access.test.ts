import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest, NextResponse } from "next/server";

const h = vi.hoisted(() => ({
  mode: "ok" as "ok" | 404 | 403 | 401,
  permission: "viewer" as "viewer" | "editor" | "admin",
  calls: [] as unknown[],
}));

vi.mock("@/lib/auth/require-org-scoped", () => {
  class OrgScopeError extends Error {
    constructor(public response: Response) {
      super("scope");
    }
  }
  return {
    OrgScopeError,
    requireOrgScoped: vi.fn(async (opts: unknown) => {
      h.calls.push(opts);
      if (h.mode === 404) throw new OrgScopeError(NextResponse.json({ error: "Introuvable" }, { status: 404 }));
      if (h.mode === 403) throw new OrgScopeError(NextResponse.json({ error: "Accès refusé" }, { status: 403 }));
      if (h.mode === 401) throw new OrgScopeError(NextResponse.json({ error: "Non authentifié" }, { status: 401 }));
      return {
        user: { id: "u1", name: "Ana" },
        orgId: "org1",
        orgSlug: "o",
        spaceId: "space1",
        permission: h.permission,
      };
    }),
  };
});

import { requireRowScope } from "@/lib/databases/row-route-access";

const DB = "11111111-1111-4111-8111-111111111111";
const ROW = "22222222-2222-4222-8222-222222222222";
const req = () => new NextRequest("http://localhost/api/x");

beforeEach(() => {
  h.mode = "ok";
  h.permission = "viewer";
  h.calls = [];
});

describe("requireRowScope", () => {
  it("databaseId non uuid : 404 sans appel base", async () => {
    const r = await requireRowScope(req(), { databaseId: "nope", min: "viewer" });
    expect((r as NextResponse).status).toBe(404);
    expect(await (r as NextResponse).json()).toEqual({ error: "Introuvable" });
    expect(h.calls).toHaveLength(0);
  });

  it("rowId non uuid : 404", async () => {
    const r = await requireRowScope(req(), { databaseId: DB, rowId: "x", min: "viewer" });
    expect((r as NextResponse).status).toBe(404);
    expect(h.calls).toHaveLength(0);
  });

  it("autre organisation, base inexistante et sans permission d'espace : même 404 et même corps", async () => {
    h.mode = 404;
    const a = (await requireRowScope(req(), { databaseId: DB, min: "viewer" })) as NextResponse;
    h.mode = 403;
    const b = (await requireRowScope(req(), { databaseId: DB, min: "editor" })) as NextResponse;
    expect(a.status).toBe(404);
    expect(b.status).toBe(404);
    expect(await b.json()).toEqual(await a.json());
  });

  it("interroge requireOrgScoped au seuil viewer", async () => {
    await requireRowScope(req(), { databaseId: DB, min: "admin" });
    expect(h.calls[0]).toMatchObject({ minPermission: "viewer" });
  });

  it("viewer demandant editor : 403 Accès refusé", async () => {
    const r = (await requireRowScope(req(), { databaseId: DB, rowId: ROW, min: "editor" })) as NextResponse;
    expect(r.status).toBe(403);
    expect(await r.json()).toEqual({ error: "Accès refusé" });
  });

  it("editor demandant editor : renvoie le RowScope", async () => {
    h.permission = "editor";
    const r = await requireRowScope(req(), { databaseId: DB, rowId: ROW, min: "editor" });
    expect(r).toEqual({ userId: "u1", userName: "Ana", orgId: "org1", spaceId: "space1", permission: "editor" });
  });

  it("editor demandant admin : 403", async () => {
    h.permission = "editor";
    const r = (await requireRowScope(req(), { databaseId: DB, min: "admin" })) as NextResponse;
    expect(r.status).toBe(403);
  });

  it("non authentifié : 401 conservé", async () => {
    h.mode = 401;
    const r = (await requireRowScope(req(), { databaseId: DB, min: "viewer" })) as NextResponse;
    expect(r.status).toBe(401);
  });
});
