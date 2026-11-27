import { describe, it, expect, vi, beforeEach } from "vitest";

const h = vi.hoisted(() => ({ results: [] as unknown[][] }));
const requireOrgScoped = vi.fn();
const { OrgScopeError } = vi.hoisted(() => ({
  OrgScopeError: class extends Error {},
}));

vi.mock("drizzle-orm", () => ({
  and: (...c: unknown[]) => c,
  eq: (...c: unknown[]) => c,
  inArray: (...c: unknown[]) => c,
}));
vi.mock("@/lib/db/schema", () => ({
  documents: { id: "id", spaceId: "spaceId" },
  spaces: { id: "id", name: "name", slug: "slug", organizationId: "organizationId" },
}));
vi.mock("@/lib/db", () => {
  const chain = () => {
    const p = () => Promise.resolve(h.results.shift() ?? []);
    const c: Record<string, unknown> = {};
    c.from = () => c;
    c.orderBy = () => c;
    c.limit = p;
    c.where = () => ({
      orderBy: () => c,
      limit: p,
      then: (res: (v: unknown) => unknown, rej?: (e: unknown) => unknown) => p().then(res, rej),
    });
    return c;
  };
  return { db: { select: () => chain() } };
});
vi.mock("@/lib/auth/require-org-scoped", () => ({
  requireOrgScoped: (...a: unknown[]) => requireOrgScoped(...a),
  OrgScopeError,
}));

import { buildCreationViews } from "../creation-view";

const S1 = "11111111-1111-4111-8111-111111111111";
const S2 = "22222222-2222-4222-8222-222222222222";
const user = { id: "u1" } as never;

const base = {
  id: "p1",
  kind: "document" as const,
  status: "pending" as const,
  spaceId: S1,
  payload: { spaceId: S1, title: "Doc", outline: [{ heading: "H", level: 1 }], bodyMarkdown: "secret" },
  resultId: null,
  createdAt: new Date("2026-11-26T10:00:00Z"),
  expiresAt: new Date("2026-11-27T10:00:00Z"),
};

beforeEach(() => {
  vi.clearAllMocks();
  h.results = [];
  requireOrgScoped.mockImplementation(async (opts: { resource: { id: string } }) => ({
    orgId: "org1",
    spaceId: opts.resource.id,
    permission: opts.resource.id === S1 ? "editor" : "viewer",
  }));
});

describe("buildCreationViews", () => {
  it("liste vide : aucune requête", async () => {
    expect(await buildCreationViews([], user, "org1")).toEqual([]);
  });

  it("DTO sans clé de stockage ni identité, espaces éditeurs de l'org seulement", async () => {
    h.results = [[
      { id: S1, name: "Achats", slug: "achats" },
      { id: S2, name: "Lecture", slug: "lecture" },
    ]];
    const [v] = await buildCreationViews([base], user, "org1");
    expect(v.editableSpaces).toEqual([{ id: S1, name: "Achats" }]);
    expect(v.canApply).toBe(true);
    const json = JSON.stringify(v);
    for (const bad of ["payload", "bodyMarkdown", "userId", "orgId", "resultKey", "storage", "s3"]) {
      expect(json).not.toContain(bad);
    }
    // Le corps réellement écrit à l'application doit être présenté à la validation (M4)
    expect(v.preview).toEqual({
      kind: "document",
      outline: [{ heading: "H", level: 1 }],
      visibility: "private",
      body: "secret",
    });
  });

  it("canApply faux si l'utilisateur n'est pas éditeur de l'espace cible", async () => {
    h.results = [[
      { id: S1, name: "Achats", slug: "achats" },
      { id: S2, name: "Lecture", slug: "lecture" },
    ]];
    const [v] = await buildCreationViews([{ ...base, spaceId: S2 }], user, "org1");
    expect(v.canApply).toBe(false);
    expect(v.spaceName).toBe("Lecture");
  });

  it("canApply faux si l'espace cible est hors de l'org", async () => {
    h.results = [[{ id: S1, name: "Achats", slug: "achats" }]];
    const [v] = await buildCreationViews([{ ...base, spaceId: S2 }], user, "org1");
    expect(v.canApply).toBe(false);
    expect(v.spaceName).toBe("");
  });

  it("proposition annulée : aucun lien de résultat", async () => {
    h.results = [[{ id: S1, name: "Achats", slug: "achats" }]];
    const [v] = await buildCreationViews([{ ...base, status: "undone" as never, resultId: "doc9" }], user, "org1");
    expect(v.status).toBe("undone");
    expect(v.result).toBeNull();
  });
});
