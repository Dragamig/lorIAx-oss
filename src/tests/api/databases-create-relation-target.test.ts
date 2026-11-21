/** POST /api/databases : cibles de relation des colonnes initiales contrôlées. */
import { describe, it, expect, vi, beforeEach } from "vitest";

const SPACE = "11111111-1111-4111-8111-111111111111";
const TGT = "22222222-2222-4222-8222-222222222222";

const h = vi.hoisted(() => {
  class FakeOrgScopeError extends Error {
    constructor(public response: Response) {
      super("scope");
    }
  }
  return { FakeOrgScopeError, requireOrgScoped: vi.fn(), colInserts: [] as unknown[] };
});

vi.mock("@/lib/auth/require-org-scoped", () => ({
  requireOrgScoped: h.requireOrgScoped,
  OrgScopeError: h.FakeOrgScopeError,
}));
vi.mock("@/lib/onboarding/progress", () => ({ recordIfRealSpace: vi.fn(async () => undefined) }));
vi.mock("@/lib/databases/row-change-context", () => ({
  SKIP_ROW_HISTORY: { source: "system", skip: true },
  setRowChangeContext: vi.fn(async () => undefined),
}));

const tx = {
  insert: vi.fn((table: { _: { name?: string } } | unknown) => ({
    values: (v: unknown) => {
      const name = (table as { [k: symbol]: unknown })[Symbol.for("drizzle:Name")];
      if (name === "user_database_columns") h.colInserts.push(v);
      return { returning: async () => [{ id: "99999999-9999-4999-8999-999999999999" }] };
    },
  })),
};
vi.mock("@/lib/db", () => ({
  db: { transaction: vi.fn(async (cb: (t: typeof tx) => unknown) => cb(tx)) },
}));

import { POST } from "@/app/api/databases/route";

const req = (body: unknown) =>
  new Request("http://x/api/databases", { method: "POST", body: JSON.stringify(body) });

beforeEach(() => {
  vi.clearAllMocks();
  h.colInserts.length = 0;
  h.requireOrgScoped.mockImplementation(async (o: { resource: { id: string } }) => {
    if (o.resource.id === TGT) throw new h.FakeOrgScopeError(new Response(null, { status: 403 }));
    return { user: { id: "u" }, orgId: "o" };
  });
});

describe("POST /api/databases colonnes initiales", () => {
  it("cible de relation sans droit : 404 muet, rien créé", async () => {
    const res = await POST(
      req({ name: "B", spaceId: SPACE, columns: [{ name: "R", type: "relation", config: { targetDatabaseId: TGT } }] }) as never
    );
    expect(res.status).toBe(404);
    expect(tx.insert).not.toHaveBeenCalled();
  });

  it("inverseColumnId du client retiré, cible d'un type non relation ignorée", async () => {
    const res = await POST(
      req({
        name: "B",
        spaceId: SPACE,
        columns: [
          { name: "T", type: "text", config: { targetDatabaseId: TGT } },
          { name: "R", type: "relation", config: { inverseColumnId: "x" } },
        ],
      }) as never
    );
    expect(res.status).toBe(201);
    const cols = h.colInserts[0] as { config: Record<string, unknown> }[];
    expect(cols[0].config).toEqual({});
    expect(cols[1].config).toEqual({});
  });
});
