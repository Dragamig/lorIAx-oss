import { describe, it, expect, vi, beforeEach } from "vitest";
import { userDatabases, userDatabaseViews, userDatabaseColumns } from "@/lib/db/schema";

const h = vi.hoisted(() => ({
  visibleList: [] as Record<string, unknown>[],
  visibleView: null as Record<string, unknown> | null,
  inserts: [] as { table: unknown; values: unknown }[],
  directViewReads: 0,
  getVisibleArgs: [] as unknown[][],
  listArgs: [] as unknown[][],
  columns: [] as Record<string, unknown>[],
  rows: [] as Record<string, unknown>[],
}));

vi.mock("@/lib/auth/require-org-scoped", () => {
  class OrgScopeError extends Error {
    constructor(public response: Response) {
      super("scope");
    }
  }
  return {
    OrgScopeError,
    requireOrgScoped: vi.fn(async () => ({ user: { id: "u1" }, orgId: "o", spaceId: "s", permission: "editor" })),
  };
});

vi.mock("@/lib/databases/view-access", () => ({
  listVisibleViews: vi.fn(async (...a: unknown[]) => {
    h.listArgs.push(a);
    return h.visibleList;
  }),
  getVisibleView: vi.fn(async (...a: unknown[]) => {
    h.getVisibleArgs.push(a);
    return h.visibleView;
  }),
}));

vi.mock("@/lib/databases/attachment-cell-guard", () => ({
  neutralizeUnreadableMediaCells: vi.fn(async (_t: unknown, cells: unknown[]) => cells),
}));
vi.mock("@/lib/databases/row-change-context", () => ({
  setRowChangeContext: vi.fn(async () => {}),
  SKIP_ROW_HISTORY: "skip",
}));
vi.mock("@/lib/databases/relation-sync", () => ({ cloneColumnConfig: (_t: unknown, c: unknown) => c }));
vi.mock("@/lib/databases/relation-target-access", () => ({ canTargetRelationDatabase: async () => true }));
vi.mock("@/lib/onboarding/progress", () => ({ recordIfRealSpace: async () => {} }));

function rowsFor(table: unknown): unknown[] {
  if (table === userDatabases) return [{ id: "db1", name: "Base", spaceId: "s", groupId: null, description: null, icon: null }];
  if (table === userDatabaseColumns) return h.columns;
  if (table === userDatabaseViews) {
    h.directViewReads++;
    return [];
  }
  return h.rows;
}

function selectChain() {
  let table: unknown;
  const c: Record<string, unknown> = {};
  c.from = (t: unknown) => {
    table = t;
    return c;
  };
  for (const k of ["where", "orderBy", "limit"]) c[k] = () => c;
  c.then = (res: (v: unknown) => unknown, rej?: (e: unknown) => unknown) =>
    Promise.resolve(rowsFor(table)).then(res, rej);
  return c;
}

vi.mock("@/lib/db", () => {
  const tx = {
    select: () => selectChain(),
    insert: (table: unknown) => ({
      values: (values: unknown) => {
        h.inserts.push({ table, values });
        const r = {
          returning: async () => [{ id: "new", ...(Array.isArray(values) ? {} : (values as object)) }],
          then: (res: (v: unknown) => unknown) => Promise.resolve([]).then(res),
        };
        return r;
      },
    }),
    execute: async () => [],
  };
  return {
    db: {
      select: () => selectChain(),
      transaction: async (fn: (t: typeof tx) => unknown) => fn(tx),
    },
  };
});

const viewInserts = () => h.inserts.filter((i) => i.table === userDatabaseViews).flatMap((i) => (Array.isArray(i.values) ? i.values : [i.values])) as Record<string, unknown>[];

beforeEach(() => {
  h.visibleList = [];
  h.visibleView = null;
  h.inserts = [];
  h.directViewReads = 0;
  h.getVisibleArgs = [];
  h.listArgs = [];
  h.columns = [];
  h.rows = [];
});

describe("duplicate", () => {
  const call = async () => {
    const { POST } = await import("@/app/api/databases/[databaseId]/duplicate/route");
    return POST(new Request("http://x/api/databases/db1/duplicate", { method: "POST" }), {
      params: Promise.resolve({ databaseId: "db1" }),
    });
  };

  it("une vue personnelle d'un autre n'est pas lue ni copiée", async () => {
    h.visibleList = [{ name: "Partagée", type: "grid", config: {}, isDefault: true, position: 0, scope: "shared", createdBy: "u2" }];
    const res = await call();
    expect(res.status).toBe(201);
    expect(h.directViewReads).toBe(0);
    expect(h.listArgs[0][1]).toBe("db1");
    expect(h.listArgs[0][2]).toBe("u1");
    expect(viewInserts().map((v) => v.name)).toEqual(["Partagée"]);
  });

  it("une vue personnelle du duplicateur est copiée avec scope personal", async () => {
    h.visibleList = [
      { name: "Partagée", type: "grid", config: {}, isDefault: true, position: 0, scope: "shared", createdBy: "u2" },
      { name: "Perso", type: "grid", config: {}, isDefault: false, position: 1, scope: "personal", createdBy: "u1" },
    ];
    await call();
    const v = viewInserts().find((x) => x.name === "Perso")!;
    expect(v.scope).toBe("personal");
    expect(v.createdBy).toBe("u1");
  });

  it("les vues partagées sont copiées avec scope shared", async () => {
    h.visibleList = [{ name: "Partagée", type: "grid", config: {}, isDefault: true, position: 0, scope: "shared", createdBy: "u2" }];
    await call();
    const v = viewInserts()[0];
    expect(v.scope).toBe("shared");
    expect(v.createdBy).toBe("u1");
  });

  it("sans vue visible, la vue de repli Tableau est shared", async () => {
    await call();
    const v = viewInserts()[0];
    expect(v.name).toBe("Tableau");
    expect(v.scope).toBe("shared");
  });
});

describe("export", () => {
  const call = async (viewId: string) => {
    const { GET } = await import("@/app/api/databases/[databaseId]/export/route");
    const { NextRequest } = await import("next/server");
    return GET(new NextRequest(`http://x/api/databases/db1/export?format=csv&viewId=${viewId}`), {
      params: Promise.resolve({ databaseId: "db1" }),
    });
  };

  it("viewId personnel d'un autre : 404, corps identique à un viewId inexistant", async () => {
    h.visibleView = null;
    const a = await call("autre-perso");
    const b = await call("inexistant");
    expect(a.status).toBe(404);
    expect(await a.json()).toEqual({ error: "Vue introuvable" });
    expect(await b.json()).toEqual({ error: "Vue introuvable" });
    expect(h.directViewReads).toBe(0);
    expect(h.getVisibleArgs[0].slice(1)).toEqual(["db1", "autre-perso", "u1"]);
  });

  it("sa propre vue personnelle : tri et filtre appliqués", async () => {
    h.columns = [{ id: "c1", databaseId: "db1", name: "N", type: "number", position: 0, config: {} }];
    h.rows = [
      { id: "r1", databaseId: "db1", cells: { c1: 1 }, position: 0 },
      { id: "r2", databaseId: "db1", cells: { c1: 2 }, position: 1 },
      { id: "r3", databaseId: "db1", cells: { c1: 3 }, position: 2 },
    ];
    h.visibleView = {
      id: "mine", scope: "personal", createdBy: "u1",
      config: { sorts: [{ columnId: "c1", direction: "desc" }] },
    };
    const res = await call("mine");
    expect(res.status).toBe(200);
    const text = await res.text();
    expect(text.indexOf("3")).toBeLessThan(text.indexOf("1"));
  });
});

describe("création de base", () => {
  it("la vue initiale est shared", async () => {
    const { POST } = await import("@/app/api/databases/route");
    const res = await POST(
      new Request("http://x/api/databases", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name: "B", spaceId: "11111111-1111-4111-8111-111111111111" }),
      }) as never,
    );
    expect(res.status).toBe(201);
    const v = viewInserts()[0];
    expect(v.scope).toBe("shared");
  });
});
