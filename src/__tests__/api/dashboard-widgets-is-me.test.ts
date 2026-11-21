import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";
import { filterUsesIsMe, DASHBOARD_IS_ME_REJECTED_MESSAGE } from "@/lib/dashboards/is-me";

const h = vi.hoisted(() => ({ writes: 0 }));

vi.mock("@/lib/auth/require-org-scoped", () => {
  class OrgScopeError extends Error {
    constructor(public response: Response) {
      super("scope");
    }
  }
  return {
    OrgScopeError,
    requireOrgScoped: vi.fn(async () => ({ user: { id: "u1" } })),
  };
});
vi.mock("@/lib/db", () => {
  const chain = (result: () => unknown) => {
    const c: Record<string, unknown> = {};
    for (const k of ["from", "where", "limit", "set", "values"]) c[k] = () => c;
    c.then = (res: (v: unknown) => unknown) => Promise.resolve(result()).then(res);
    c.returning = async () => {
      h.writes++;
      return [{ id: "w1" }];
    };
    return c;
  };
  return {
    db: {
      select: () => chain(() => [{ id: "d1", spaceId: "s1", max: 0 }]),
      insert: () => chain(() => []),
      update: () => {
        h.writes++;
        return chain(() => []);
      },
    },
  };
});

import { POST } from "@/app/api/dashboards/[id]/widgets/route";
import { PATCH } from "@/app/api/dashboards/[id]/widgets/[widgetId]/route";

const DBID = "11111111-1111-4111-8111-111111111111";
const isMeFilter = {
  type: "group",
  logic: "and",
  children: [{ type: "condition", columnId: "c", operator: "is_me", value: "" }],
};
const cfg = (filter: unknown) => ({ filter, aggregate: { fn: "count" } });
const req = (body: unknown) => new NextRequest("http://x", { method: "POST", body: JSON.stringify(body) });

beforeEach(() => {
  h.writes = 0;
});

describe("filterUsesIsMe", () => {
  it("détecte is_me en profondeur, pas ailleurs", () => {
    expect(filterUsesIsMe(isMeFilter)).toBe(true);
    expect(filterUsesIsMe({ children: [{ children: [{ operator: "is_me" }] }] })).toBe(true);
    expect(filterUsesIsMe({ children: [{ operator: "is" }] })).toBe(false);
    expect(filterUsesIsMe(null)).toBe(false);
  });
});

describe("widgets de tableau de bord : is_me refusé", () => {
  it("POST widget avec is_me : 400 et rien d'écrit", async () => {
    const res = await POST(
      req({ databaseId: DBID, type: "kpi", title: "T", config: cfg(isMeFilter) }),
      { params: Promise.resolve({ id: "d1" }) },
    );
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe(DASHBOARD_IS_ME_REJECTED_MESSAGE);
    expect(h.writes).toBe(0);
  });

  it("POST widget sans is_me : 201", async () => {
    const res = await POST(
      req({ databaseId: DBID, type: "kpi", title: "T", config: cfg(null) }),
      { params: Promise.resolve({ id: "d1" }) },
    );
    expect(res.status).toBe(201);
  });

  it("PATCH widget avec is_me : 400 et rien d'écrit", async () => {
    const res = await PATCH(req({ config: cfg(isMeFilter) }), {
      params: Promise.resolve({ id: "d1", widgetId: "w1" }),
    });
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe(DASHBOARD_IS_ME_REJECTED_MESSAGE);
    expect(h.writes).toBe(0);
  });
});
