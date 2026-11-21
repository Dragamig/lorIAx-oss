import { describe, it, expect, vi, beforeEach } from "vitest";
import { userDatabases, userDatabaseViews, userDatabaseColumns, userDatabaseRows } from "@/lib/db/schema";

const h = vi.hoisted(() => ({
  visible: [] as Record<string, unknown>[],
  inserts: [] as { table: unknown; values: Record<string, unknown> }[],
  listArgs: [] as unknown[][],
  directViewReads: 0,
  viewerProps: null as Record<string, unknown> | null,
}));

vi.mock("next/navigation", () => ({
  redirect: (url: string) => {
    throw new Error(`REDIRECT:${url}`);
  },
  notFound: () => {
    throw new Error("NOT_FOUND");
  },
}));

vi.mock("@/lib/auth/require-org-scoped", () => {
  class OrgScopeError extends Error {}
  return {
    OrgScopeError,
    requireOrgScoped: vi.fn(async () => ({ user: { id: "u1" }, orgId: "o", permission: "editor" })),
  };
});

vi.mock("@/lib/databases/view-access", async () => {
  const actual = await vi.importActual<typeof import("@/lib/databases/view-access")>("@/lib/databases/view-access");
  return {
    ...actual,
    listVisibleViews: vi.fn(async (...a: unknown[]) => {
      h.listArgs.push(a);
      return h.visible;
    }),
  };
});

vi.mock("@/components/bases/base-viewer", () => ({
  BaseViewer: (props: Record<string, unknown>) => {
    h.viewerProps = props;
    return null;
  },
}));

vi.mock("@/lib/db", () => {
  function rowsFor(table: unknown): unknown[] {
    if (table === userDatabases) return [{ id: "db1", name: "Base", spaceId: "s1", description: null }];
    if (table === userDatabaseViews) {
      h.directViewReads++;
      return [];
    }
    if (table === userDatabaseColumns || table === userDatabaseRows) return [];
    return [];
  }
  function chain() {
    let table: unknown;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const c: any = {
      from: (t: unknown) => ((table = t), c),
      innerJoin: () => c,
      where: () => c,
      orderBy: () => c,
      limit: () => Promise.resolve(rowsFor(table)),
      then: (res: (v: unknown) => void, rej?: (e: unknown) => void) => Promise.resolve(rowsFor(table)).then(res, rej),
    };
    return c;
  }
  return {
    db: {
      select: () => chain(),
      selectDistinct: () => chain(),
      insert: (table: unknown) => ({
        values: (values: Record<string, unknown>) => {
          h.inserts.push({ table, values });
          return { returning: async () => [{ id: "created" }] };
        },
      }),
    },
  };
});

import DatabaseHomePage from "@/app/[locale]/(app)/bases/[databaseId]/page";
import DatabaseViewPage from "@/app/[locale]/(app)/bases/[databaseId]/views/[viewId]/page";

const view = (over: Record<string, unknown>) => ({
  id: "v",
  databaseId: "db1",
  name: "V",
  type: "grid",
  config: {},
  isDefault: false,
  position: 0,
  scope: "shared",
  createdBy: null,
  ...over,
});

async function run(fn: () => Promise<unknown>): Promise<string> {
  try {
    await fn();
    return "OK";
  } catch (e) {
    return (e as Error).message;
  }
}

const homeProps = () => ({
  params: Promise.resolve({ databaseId: "db1" }),
  searchParams: Promise.resolve({}),
});
const viewProps = (viewId: string) => ({
  params: Promise.resolve({ databaseId: "db1", viewId }),
  searchParams: Promise.resolve({}),
});

describe("pages Bases : portée des vues", () => {
  beforeEach(() => {
    h.visible = [];
    h.inserts = [];
    h.listArgs = [];
    h.directViewReads = 0;
    h.viewerProps = null;
  });

  it("page de base : redirige vers la vue partagée par défaut, jamais vers une personnelle même si elle a une position plus basse", async () => {
    h.visible = [
      view({ id: "perso", scope: "personal", createdBy: "u1", position: 0 }),
      view({ id: "partagee", scope: "shared", isDefault: true, position: 5 }),
    ];
    const out = await run(() => DatabaseHomePage(homeProps()));
    expect(out).toContain("REDIRECT:");
    expect(out).toContain("partagee");
    expect(out).not.toContain("perso");
    expect(h.listArgs[0].slice(1)).toEqual(["db1", "u1"]);
    expect(h.directViewReads).toBe(0);
  });

  it("page de base : sans vue, crée la vue de repli en scope shared", async () => {
    h.visible = [];
    const out = await run(() => DatabaseHomePage(homeProps()));
    expect(out).toContain("created");
    expect(h.inserts).toHaveLength(1);
    expect(h.inserts[0].values).toMatchObject({ scope: "shared", isDefault: true, createdBy: "u1" });
  });

  it("page de vue : la vue personnelle d'un autre déclenche notFound", async () => {
    h.visible = [view({ id: "partagee" })];
    expect(await run(() => DatabaseViewPage(viewProps("perso-autrui")))).toBe("NOT_FOUND");
    expect(h.directViewReads).toBe(0);
  });

  it("page de vue : sa propre vue personnelle s'affiche", async () => {
    h.visible = [view({ id: "partagee" }), view({ id: "perso", scope: "personal", createdBy: "u1" })];
    const el = (await DatabaseViewPage(viewProps("perso"))) as { props: Record<string, unknown> };
    h.viewerProps = el.props;
    const views = h.viewerProps?.views as { id: string }[];
    expect(views.map((v) => v.id)).toEqual(["partagee", "perso"]);
    expect(h.viewerProps?.activeViewId).toBe("perso");
    expect(h.listArgs[0].slice(1)).toEqual(["db1", "u1"]);
  });
});
