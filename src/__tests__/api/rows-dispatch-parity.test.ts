import { describe, it, expect, vi, beforeEach } from "vitest";

const h = vi.hoisted(() => ({
  calls: [] as unknown[][],
  selects: [] as unknown[][],
  deleted: [] as { id: string; cells: Record<string, unknown> }[],
  duplicated: [] as { id: string; cells: Record<string, unknown> }[],
  merged: new Map<string, { id: string; cells: Record<string, unknown> } | null>(),
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
vi.mock("@/lib/automations/executor", () => ({
  dispatchTrigger: vi.fn((...a: unknown[]) => {
    h.calls.push(["trigger", ...a]);
    return Promise.resolve();
  }),
  dispatchValueChanged: vi.fn((...a: unknown[]) => {
    h.calls.push(["valueChanged", ...a]);
    return Promise.resolve();
  }),
}));
vi.mock("@/lib/databases/row-writes", () => ({
  createDatabaseRow: vi.fn(async (_d: string, cells: Record<string, unknown>) => ({ id: "r1", cells })),
  mergeDatabaseRowCells: vi.fn(async (_d: string, id: string) => h.merged.get(id) ?? null),
}));
vi.mock("@/lib/databases/row-batch", () => ({
  deleteDatabaseRows: vi.fn(async () => h.deleted),
  duplicateDatabaseRows: vi.fn(async () => h.duplicated),
}));
vi.mock("@/lib/databases/row-change-context", () => ({ setRowChangeContext: vi.fn(async () => {}) }));
vi.mock("@/lib/bases/public-form-rate-limit", () => ({ tryAllowSubmission: async () => true }));
vi.mock("@/lib/bases/public-form-captcha", () => ({ isCaptchaEnabled: () => false, verifyHCaptcha: vi.fn() }));
vi.mock("@/lib/rate-limit", () => ({ getClientIpOrNull: () => "203.0.113.4" }));
vi.mock("@/lib/db", () => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const chain: any = {
    from: () => chain,
    where: () => chain,
    limit: () => Promise.resolve(h.selects.shift() ?? []),
    returning: () => Promise.resolve([{ id: "row1" }]),
    values: () => chain,
    then: (res: (v: unknown) => void) => res(h.selects.shift() ?? []),
  };
  const db = {
    select: () => chain,
    insert: () => chain,
    transaction: async (fn: (tx: unknown) => Promise<unknown>) => fn(db),
  };
  return { db };
});

import { NextRequest } from "next/server";
import { POST, PATCH, DELETE } from "@/app/api/databases/[databaseId]/rows/route";
import { POST as DUPLICATE } from "@/app/api/databases/[databaseId]/rows/duplicate/route";
import { POST as SUBMIT } from "@/app/api/public/views/[token]/submit/route";

const params = { params: Promise.resolve({ databaseId: "d1" }) };
const ROW = (n: number) => `00000000-0000-4000-8000-00000000000${n}`;
const req = (method: string, body: unknown) =>
  new Request("http://x/api", {
    method,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

beforeEach(() => {
  h.calls.length = 0;
  h.selects.length = 0;
  h.merged.clear();
  h.deleted = [];
  h.duplicated = [];
});

describe("parité des envois d'événements de ligne", () => {
  it("POST rows : un appel row_created avec { databaseId, rowId, cells }", async () => {
    await POST(req("POST", { cells: { a: 1 } }), params);
    expect(h.calls).toEqual([["trigger", "row_created", { databaseId: "d1", rowId: "r1", cells: { a: 1 } }]]);
  });

  it("PATCH rows de 2 lignes : row_updated puis valueChanged par ligne, before lu en base", async () => {
    h.selects.push([{ id: ROW(1), cells: { a: 1 } }, { id: ROW(2), cells: { a: 5 } }]);
    h.merged.set(ROW(1), { id: ROW(1), cells: { a: 2 } });
    h.merged.set(ROW(2), { id: ROW(2), cells: { a: 6 } });
    await PATCH(
      req("PATCH", { rows: [{ id: ROW(1), cells: { a: 2 } }, { id: ROW(2), cells: { a: 6 } }] }),
      params
    );
    expect(h.calls).toEqual([
      ["trigger", "row_updated", { databaseId: "d1", rowId: ROW(1), cells: { a: 2 } }],
      ["valueChanged", { databaseId: "d1", rowId: ROW(1), before: { a: 1 }, after: { a: 2 } }],
      ["trigger", "row_updated", { databaseId: "d1", rowId: ROW(2), cells: { a: 6 } }],
      ["valueChanged", { databaseId: "d1", rowId: ROW(2), before: { a: 5 }, after: { a: 6 } }],
    ]);
  });

  it("PATCH d'une ligne introuvable : aucun dispatch", async () => {
    h.selects.push([]);
    await PATCH(req("PATCH", { rows: [{ id: ROW(1), cells: { a: 2 } }] }), params);
    expect(h.calls).toEqual([]);
  });

  it("DELETE rows de 2 lignes : row_deleted par ligne avec les cellules d'avant", async () => {
    h.deleted = [
      { id: ROW(1), cells: { a: 1 } },
      { id: ROW(2), cells: { a: 2 } },
    ];
    await DELETE(req("DELETE", { rowIds: [ROW(1), ROW(2)] }), params);
    expect(h.calls).toEqual([
      ["trigger", "row_deleted", { databaseId: "d1", rowId: ROW(1), cells: { a: 1 } }],
      ["trigger", "row_deleted", { databaseId: "d1", rowId: ROW(2), cells: { a: 2 } }],
    ]);
  });

  it("duplicate : row_created par copie", async () => {
    h.duplicated = [
      { id: "n1", cells: { a: 1 } },
      { id: "n2", cells: { a: 2 } },
    ];
    await DUPLICATE(req("POST", { rowIds: [ROW(1), ROW(2)] }), params);
    expect(h.calls).toEqual([
      ["trigger", "row_created", { databaseId: "d1", rowId: "n1", cells: { a: 1 } }],
      ["trigger", "row_created", { databaseId: "d1", rowId: "n2", cells: { a: 2 } }],
    ]);
  });

  it("formulaire public : row_created avec les cellules filtrées", async () => {
    h.selects.push(
      [{ databaseId: "d9", type: "form" }],
      [
        { id: "c1", type: "text" },
        { id: "c2", type: "formula" },
      ],
      [{ max: 4 }]
    );
    const r = new NextRequest("http://localhost/api/public/views/x/submit", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ cells: { c1: "x", c2: "y", zz: "z" } }),
    });
    const res = await SUBMIT(r, { params: Promise.resolve({ token: "t".repeat(40) }) });
    expect(res.status).toBe(200);
    expect(h.calls).toEqual([["trigger", "row_created", { databaseId: "d9", rowId: "row1", cells: { c1: "x" } }]]);
  });
});
