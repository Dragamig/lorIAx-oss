import { describe, it, expect, vi, beforeEach } from "vitest";

const h = vi.hoisted(() => ({
  user: { id: "u1" },
  denied: false,
  calls: [] as { fn: string; ctx: unknown }[],
  order: [] as string[],
}));

vi.mock("@/lib/auth/require-org-scoped", () => {
  class OrgScopeError extends Error {
    response = new Response(JSON.stringify({ error: "Introuvable" }), { status: 404 });
  }
  return {
    OrgScopeError,
    requireOrgScoped: vi.fn(async () => {
      h.order.push("scope");
      if (h.denied) throw new OrgScopeError();
      return { user: h.user, orgId: "org1", orgSlug: "o" };
    }),
  };
});
vi.mock("@/lib/automations/executor", () => ({
  dispatchTrigger: vi.fn(async () => {}),
  dispatchValueChanged: vi.fn(async () => {}),
}));
vi.mock("@/lib/db", () => ({
  db: {
    select: () => {
      const self: Record<string, unknown> = {
        from: () => self,
        where: async () => [{ cells: {} }],
      };
      return self;
    },
  },
}));
vi.mock("@/lib/databases/relation-target-access", () => ({ canTargetRelationDatabase: async () => true }));
vi.mock("@/lib/databases/row-writes", () => ({
  createDatabaseRow: vi.fn(async (_d: string, _c: unknown, _e: unknown, ctx: unknown) => {
    h.order.push("helper");
    h.calls.push({ fn: "create", ctx });
    return { id: "r1", cells: {} };
  }),
  mergeDatabaseRowCells: vi.fn(async (_d: string, id: string, _c: unknown, _o: unknown, _e: unknown, ctx: unknown) => {
    h.order.push("helper");
    h.calls.push({ fn: "merge", ctx });
    return { id, cells: {} };
  }),
}));
vi.mock("@/lib/databases/row-batch", () => ({
  deleteDatabaseRows: vi.fn(async (_d: string, _r: string[], _e: unknown, ctx: unknown) => {
    h.order.push("helper");
    h.calls.push({ fn: "delete", ctx });
    return [];
  }),
  duplicateDatabaseRows: vi.fn(async (_d: string, _r: string[], _e: unknown, ctx: unknown) => {
    h.order.push("helper");
    h.calls.push({ fn: "duplicate", ctx });
    return [];
  }),
  restoreDatabaseRows: vi.fn(async (_d: string, _r: unknown, _e: unknown, _o: unknown, ctx: unknown) => {
    h.order.push("helper");
    h.calls.push({ fn: "restore", ctx });
    return { rows: [] };
  }),
}));

import { POST, PATCH, DELETE } from "@/app/api/databases/[databaseId]/rows/route";
import { POST as DUPLICATE } from "@/app/api/databases/[databaseId]/rows/duplicate/route";
import { POST as RESTORE } from "@/app/api/databases/[databaseId]/rows/restore/route";

const params = { params: Promise.resolve({ databaseId: "d1" }) };
const UUID = "11111111-1111-4111-8111-111111111111";
const ROW = (n: number) => `00000000-0000-4000-8000-00000000000${n}`;
const req = (method: string, body: unknown, headers: Record<string, string> = {}) =>
  new Request("http://x/api", {
    method,
    headers: { "Content-Type": "application/json", ...headers },
    body: JSON.stringify(body),
  });
const ctxOf = () => h.calls[h.calls.length - 1].ctx as Record<string, unknown>;
const isUuid = (v: unknown) => typeof v === "string" && /^[0-9a-f-]{36}$/i.test(v);

beforeEach(() => {
  h.calls.length = 0;
  h.order.length = 0;
  h.denied = false;
});

describe("rows routes history context", () => {
  it("POST sans en-tête : ctx ui avec acteur et batchId uuid", async () => {
    await POST(req("POST", { cells: {} }), params);
    expect(ctxOf()).toMatchObject({ source: "ui", actorUserId: "u1" });
    expect(isUuid(ctxOf().batchId)).toBe(true);
  });

  it("POST avec X-Row-Source import et X-Batch-Id uuid : ctx import avec ce batchId", async () => {
    await POST(req("POST", { cells: {} }, { "X-Row-Source": "import", "X-Batch-Id": UUID }), params);
    expect(ctxOf()).toMatchObject({ source: "import", actorUserId: "u1", batchId: UUID });
  });

  it("POST avec X-Row-Source automation (hors liste blanche) : ctx ui", async () => {
    const res = await POST(req("POST", { cells: {} }, { "X-Row-Source": "automation", "X-Batch-Id": UUID }), params);
    expect(res.status).toBe(201);
    expect(ctxOf().source).toBe("ui");
    expect(ctxOf().batchId).not.toBe(UUID);
  });

  it("POST avec X-Batch-Id invalide : batchId généré", async () => {
    await POST(req("POST", { cells: {} }, { "X-Row-Source": "import", "X-Batch-Id": "nope" }), params);
    expect(ctxOf().source).toBe("import");
    expect(isUuid(ctxOf().batchId)).toBe(true);
  });

  it("PATCH ignore X-Row-Source import", async () => {
    await PATCH(req("PATCH", { rows: [{ id: ROW(1), cells: {} }] }, { "X-Row-Source": "import" }), params);
    expect(ctxOf().source).toBe("ui");
  });

  it("PATCH de 3 lignes : les 3 appels partagent le même batchId", async () => {
    await PATCH(req("PATCH", { rows: [1, 2, 3].map((n) => ({ id: ROW(n), cells: {} })) }), params);
    const merges = h.calls.filter((c) => c.fn === "merge");
    expect(merges).toHaveLength(3);
    const ids = new Set(merges.map((c) => (c.ctx as { batchId: string }).batchId));
    expect(ids.size).toBe(1);
  });

  it("DELETE : ctx ui", async () => {
    await DELETE(req("DELETE", { rowId: ROW(1) }), params);
    expect(ctxOf()).toMatchObject({ source: "ui", actorUserId: "u1" });
  });

  it("duplicate : ctx ui", async () => {
    await DUPLICATE(req("POST", { rowIds: [ROW(1)] }, { "X-Row-Source": "import" }), params);
    expect(ctxOf()).toMatchObject({ source: "ui", actorUserId: "u1" });
  });

  it("restore : ctx restore", async () => {
    await RESTORE(req("POST", { rows: [{ id: ROW(1), cells: {}, position: 0 }] }), params);
    expect(ctxOf()).toMatchObject({ source: "restore", actorUserId: "u1" });
    expect(isUuid(ctxOf().batchId)).toBe(true);
  });

  it("base d'une autre organisation : 404 et aucun helper appelé", async () => {
    h.denied = true;
    const res = await POST(req("POST", { cells: {} }), params);
    expect(res.status).toBe(404);
    expect(h.calls).toHaveLength(0);
    expect(h.order[0]).toBe("scope");
  });
});
