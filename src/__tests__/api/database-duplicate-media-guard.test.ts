import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  selects: [] as unknown[][],
  inserted: [] as { table: string; values: unknown }[],
  allowed: new Set<string>(),
}));

vi.mock("@/lib/auth/require-org-scoped", () => ({
  OrgScopeError: class extends Error {},
  requireOrgScoped: vi.fn(async () => ({ user: { id: "u1" }, orgId: "org-a" })),
}));
vi.mock("@/lib/databases/row-change-context", () => ({
  SKIP_ROW_HISTORY: { skip: true },
  setRowChangeContext: vi.fn(async () => undefined),
}));
vi.mock("@/lib/databases/relation-sync", () => ({ cloneColumnConfig: (_t: string, c: unknown) => c }));
vi.mock("@/lib/databases/row-writes", () => ({ loadColumnTypes: vi.fn() }));
vi.mock("@/lib/media/access", () => ({
  getMediaForAccess: vi.fn(async (id: string) => ({ id })),
  resolveMediaAccess: vi.fn(async (_u: unknown, row: { id: string }) => ({ allowed: h.allowed.has(row.id) })),
}));
vi.mock("@/lib/db", async () => {
  const { getTableName } = await import("drizzle-orm");
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const make = (): any => {
    let table = "";
    let isInsert = false;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const chain: any = {
      from: (t: never) => {
        table = getTableName(t);
        return chain;
      },
      where: () => chain,
      orderBy: () => chain,
      limit: () => Promise.resolve(h.selects.shift() ?? []),
      values: (v: unknown) => {
        h.inserted.push({ table, values: v });
        return chain;
      },
      returning: () => Promise.resolve(
          table === "user_databases" ? [{ id: "clone" }] : [{ id: "ci2" }, { id: "ca2" }]
        ),
      then: (res: (v: unknown) => void) => res(isInsert ? undefined : (h.selects.shift() ?? [])),
    };
    return { chain, setInsert: (t: never) => { table = getTableName(t); isInsert = true; return chain; } };
  };
  const db = {
    select: () => make().chain,
    insert: (t: never) => make().setInsert(t),
    transaction: async (fn: (tx: unknown) => Promise<unknown>) => fn(db),
  };
  return { db };
});

import { POST } from "@/app/api/databases/[databaseId]/duplicate/route";

const A = "11111111-1111-4111-8111-111111111111";
const B = "22222222-2222-4222-8222-222222222222";
const piece = (mediaId: string) => ({ mediaId, filename: "a.pdf", mimeType: "application/pdf", size: 1 });

async function run(rowCells: Record<string, unknown>) {
  h.inserted.length = 0;
  h.selects.length = 0;
  h.selects.push(
    [{ id: "src", spaceId: "s1", groupId: null, name: "B", description: null, icon: null }], // base source
    [
      { id: "ci", type: "image" },
      { id: "ca", type: "attachment" },
    ], // types
    [{ id: "r1", cells: rowCells, position: 0 }], // lignes
    [
      { id: "ci", name: "I", type: "image", position: 0, config: {} },
      { id: "ca", name: "A", type: "attachment", position: 1, config: {} },
    ], // colonnes (dans la transaction)
    [] // vues
  );
  const res = await POST(new Request("http://x", { method: "POST" }), {
    params: Promise.resolve({ databaseId: "src" }),
  });
  const rows = h.inserted.find((i) => i.table === "user_database_rows")?.values as { cells: Record<string, unknown> }[];
  return { res, cells: rows?.[0]?.cells };
}

beforeEach(() => h.allowed.clear());

describe("duplication de base : garde des cellules médias", () => {
  it("neutralise un média illisible (autre organisation) et garde le média lisible", async () => {
    h.allowed.add(A);
    const { res, cells } = await run({ ci: `/api/media/${B}`, ca: [piece(A), piece(B)] });
    expect(res.status).toBe(201);
    expect(cells).toEqual({ ci2: "", ca2: [piece(A)] });
  });

  it("copie intacte une base sans référence de média ni accès nécessaire", async () => {
    const legacy = { key: "u/x.pdf", filename: "x" };
    const { res, cells } = await run({ ci: "https://x/y.png", ca: [legacy] });
    expect(res.status).toBe(201);
    expect(cells).toEqual({ ci2: "https://x/y.png", ca2: [legacy] });
  });
});
