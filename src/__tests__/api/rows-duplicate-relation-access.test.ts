import { describe, it, expect, vi, beforeEach } from "vitest";
import { userDatabaseColumns } from "@/lib/db/schema";

const TARGET = "22222222-2222-4222-8222-222222222222";
const REL_COL = "33333333-3333-4333-8333-333333333333";
const OTHER = "44444444-4444-4444-8444-444444444444";
const ROW = "00000000-0000-4000-8000-000000000001";

const h = vi.hoisted(() => ({ targetAllowed: false, duplicated: 0, cells: {} as Record<string, unknown> }));

vi.mock("@/lib/auth/require-org-scoped", () => {
  class OrgScopeError extends Error {
    response = new Response(JSON.stringify({ error: "Introuvable" }), { status: 404 });
  }
  return {
    OrgScopeError,
    requireOrgScoped: vi.fn(async () => ({ user: { id: "u1" }, orgId: "org1", orgSlug: "o" })),
  };
});
vi.mock("@/lib/automations/dispatch-row-events", () => ({ dispatchRowEvents: vi.fn() }));
vi.mock("@/lib/db", () => ({
  db: {
    select: () => {
      let table: unknown;
      const self: Record<string, unknown> = {
        from: (t: unknown) => {
          table = t;
          return self;
        },
        where: async () =>
          table === userDatabaseColumns
            ? [{ id: REL_COL, type: "relation", config: { targetDatabaseId: TARGET, inverseColumnId: OTHER } }]
            : [{ id: ROW, cells: h.cells }],
      };
      return self;
    },
  },
}));
vi.mock("@/lib/databases/relation-target-access", () => ({
  canTargetRelationDatabase: async () => h.targetAllowed,
}));
vi.mock("@/lib/databases/row-batch", () => ({
  duplicateDatabaseRows: vi.fn(async () => {
    h.duplicated++;
    return [];
  }),
}));

import { POST } from "@/app/api/databases/[databaseId]/rows/duplicate/route";

const params = { params: Promise.resolve({ databaseId: "d1" }) };
const req = () =>
  new Request("http://x/api", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ rowIds: [ROW] }),
  });

beforeEach(() => {
  h.targetAllowed = false;
  h.duplicated = 0;
  h.cells = { [REL_COL]: [OTHER] };
});

describe("duplication de lignes avec relation jumelée", () => {
  it("refuse 403 sans accès à la base cible, sans duplication", async () => {
    const res = await POST(req(), params);
    expect(res.status).toBe(403);
    expect(h.duplicated).toBe(0);
  });

  it("accepte avec accès aux deux bases", async () => {
    h.targetAllowed = true;
    const res = await POST(req(), params);
    expect(res.status).toBe(200);
    expect(h.duplicated).toBe(1);
  });

  it("accepte sans cible de relation sur la ligne", async () => {
    h.cells = { x: "a" };
    const res = await POST(req(), params);
    expect(res.status).toBe(200);
  });
});
