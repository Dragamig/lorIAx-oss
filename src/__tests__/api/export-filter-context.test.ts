import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

const h = vi.hoisted(() => ({
  call: 0,
  view: null as Record<string, unknown> | null,
}));

vi.mock("@/lib/auth/require-org-scoped", () => {
  class OrgScopeError extends Error {
    constructor(public response: Response) {
      super("scope");
    }
  }
  return {
    OrgScopeError,
    requireOrgScoped: vi.fn(async () => ({ user: { id: "me" } })),
  };
});
vi.mock("@/lib/databases/view-access", () => ({
  getVisibleView: vi.fn(async () => h.view),
}));
vi.mock("@/lib/db", () => {
  const results = () => [
    [{ id: "d1", name: "Base" }],
    [
      { id: "col-t", databaseId: "d1", name: "Titre", type: "text", position: 0, config: {} },
      { id: "col-p", databaseId: "d1", name: "Resp", type: "person", position: 1, config: {} },
    ],
    [
      { id: "r1", databaseId: "d1", cells: { "col-t": "Mien", "col-p": ["me"] }, position: 0 },
      { id: "r2", databaseId: "d1", cells: { "col-t": "Autre", "col-p": ["other"] }, position: 1 },
    ],
  ];
  return {
    db: {
      select: () => {
        const r = results()[h.call++ % 3];
        const c: Record<string, unknown> = {};
        for (const k of ["from", "where", "orderBy"]) c[k] = () => c;
        c.limit = () => Promise.resolve(r);
        c.then = (res: (v: unknown) => unknown) => Promise.resolve(r).then(res);
        return c;
      },
    },
  };
});

import { GET } from "@/app/api/databases/[databaseId]/export/route";

const call = (qs: string) =>
  GET(new NextRequest(`http://localhost/api/databases/d1/export?format=csv${qs}`), {
    params: Promise.resolve({ databaseId: "d1" }),
  });

const isMeView = {
  id: "v1",
  config: {
    filters: { type: "group", logic: "and", children: [{ type: "condition", columnId: "col-p", operator: "is_me", value: "" }] },
  },
};

describe("export : contexte d'évaluation des filtres", () => {
  beforeEach(() => {
    h.call = 0;
    h.view = isMeView;
  });

  it("vue is_me : seules les lignes de l'exportateur", async () => {
    const res = await call("&viewId=v1");
    expect(res.status).toBe(200);
    const csv = await res.text();
    expect(csv).toContain("Mien");
    expect(csv).not.toContain("Autre");
  });

  it("?tz=Mars/Inconnu : replié sur Europe/Paris, 200", async () => {
    const res = await call("&viewId=v1&tz=Mars/Inconnu");
    expect(res.status).toBe(200);
    expect(await res.text()).toContain("Mien");
  });

  it("export sans vue : inchangé (toutes les lignes)", async () => {
    const csv = await (await call("")).text();
    expect(csv).toContain("Mien");
    expect(csv).toContain("Autre");
  });
});
