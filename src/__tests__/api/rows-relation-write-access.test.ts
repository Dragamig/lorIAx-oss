import { describe, it, expect, vi, beforeEach } from "vitest";
import { userDatabaseColumns } from "@/lib/db/schema";

const TARGET = "22222222-2222-4222-8222-222222222222";
const REL_COL = "33333333-3333-4333-8333-333333333333";
const OTHER = "44444444-4444-4444-8444-444444444444";

const h = vi.hoisted(() => ({
  targetAllowed: false,
  writes: [] as string[],
  stored: {} as Record<string, unknown>,
}));

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
vi.mock("@/lib/databases/attachment-cell-guard", () => ({
  validateAttachmentCells: async () => ({ ok: true }),
}));
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
            : [{ id: "00000000-0000-4000-8000-000000000001", cells: h.stored }],
      };
      return self;
    },
  },
}));
vi.mock("@/lib/databases/relation-target-access", () => ({
  canTargetRelationDatabase: async () => h.targetAllowed,
}));
vi.mock("@/lib/databases/row-writes", () => ({
  createDatabaseRow: vi.fn(async () => {
    h.writes.push("create");
    return { id: "r1", cells: {} };
  }),
  mergeDatabaseRowCells: vi.fn(async (_d: string, id: string) => {
    h.writes.push("merge");
    return { id, cells: {} };
  }),
}));
vi.mock("@/lib/databases/row-batch", () => ({ deleteDatabaseRows: vi.fn() }));

import { POST, PATCH } from "@/app/api/databases/[databaseId]/rows/route";

const params = { params: Promise.resolve({ databaseId: "d1" }) };
const ROW = "00000000-0000-4000-8000-000000000001";
const req = (method: string, body: unknown) =>
  new Request("http://x/api", {
    method,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

beforeEach(() => {
  h.targetAllowed = false;
  h.writes.length = 0;
  h.stored = {};
});

describe("écriture de relation jumelée : accès à la base cible", () => {
  it("POST refuse 403 sans accès à la base cible, sans écriture", async () => {
    const res = await POST(req("POST", { cells: { [REL_COL]: [ROW] } }), params);
    expect(res.status).toBe(403);
    expect(h.writes).toEqual([]);
  });

  it("POST accepte avec accès à la base cible", async () => {
    h.targetAllowed = true;
    const res = await POST(req("POST", { cells: { [REL_COL]: [ROW] } }), params);
    expect(res.status).toBe(201);
  });

  it("POST sans cellule de relation : pas de contrôle", async () => {
    const res = await POST(req("POST", { cells: { x: "a" } }), params);
    expect(res.status).toBe(201);
  });

  it("PATCH refuse 403 sans accès, aucune ligne du lot écrite", async () => {
    const res = await PATCH(
      req("PATCH", { rows: [{ id: ROW, cells: { x: 1 } }, { id: ROW, cells: { [REL_COL]: [OTHER] } }] }),
      params
    );
    expect(res.status).toBe(403);
    expect(h.writes).toEqual([]);
  });

  it("PATCH accepte avec accès", async () => {
    h.targetAllowed = true;
    const res = await PATCH(req("PATCH", { rows: [{ id: ROW, cells: { [REL_COL]: [OTHER] } }] }), params);
    expect(res.status).toBe(200);
    expect(h.writes).toEqual(["merge"]);
  });

  it("PATCH avec valeur inchangée : pas de contrôle", async () => {
    h.stored = { [REL_COL]: [OTHER] };
    const res = await PATCH(req("PATCH", { rows: [{ id: ROW, cells: { [REL_COL]: [OTHER] } }] }), params);
    expect(res.status).toBe(200);
  });
});
