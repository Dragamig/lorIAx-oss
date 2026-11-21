/**
 * Listes d'espaces et arborescences : rien au-dessus de l'habilitation.
 *
 * Un titre est souvent la donnée sensible elle-même : les espaces `secret` sont
 * masqués aux non-membres, et l'arborescence d'un espace n'expose pas les
 * documents que l'appelant ne peut pas lire d'après leur classification.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const h = vi.hoisted(() => ({
  selectQueue: [] as unknown[][],
  perm: vi.fn(),
}));

function chain(result: unknown[]) {
  const c: Record<string, unknown> = {};
  const self = () => c;
  c.from = self;
  c.where = self;
  c.innerJoin = self;
  c.orderBy = self;
  c.limit = () => Promise.resolve(result);
  c.then = (res: (v: unknown) => unknown) => Promise.resolve(result).then(res);
  return c;
}

vi.mock("@/lib/db", () => ({ db: { select: () => chain(h.selectQueue.shift() ?? []) } }));
vi.mock("@/lib/auth/get-user", () => ({
  getSessionUser: async () => ({ id: "u", name: "U", email: "u@x", globalRole: "editor" }),
}));
vi.mock("@/lib/org/get-request-org", () => ({ getRequestOrgId: async () => "org" }));
vi.mock("@/lib/org/scoped-space", () => ({
  getSpaceBySlugForRequest: async () => ({ id: "sp", slug: "s", organizationId: "org" }),
}));
vi.mock("@/lib/api/auth-api", () => ({
  authenticateApiRequest: async () => ({
    user: { id: "u", name: "U", email: "u@x", orgId: "org", globalRole: "editor", scopes: [] },
  }),
  requireScope: () => null,
}));
vi.mock("@/lib/auth/check-access", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/auth/check-access")>()),
  getSpacePermission: h.perm,
  checkSpaceReadAccess: async () => true,
}));
vi.mock("@/lib/logger", () => ({ default: { error: () => {}, warn: () => {}, info: () => {} } }));
vi.mock("@/lib/spaces/create-space", () => ({
  assertSpaceQuota: async () => ({}), insertSpace: async () => ({}), afterSpaceCreated: async () => {},
}));

import { GET as listSpaces } from "@/app/api/spaces/route";
import { GET as tree } from "@/app/api/spaces/[slug]/documents/route";
import { GET as v1Index } from "@/app/api/v1/spaces/[slug]/documents/route";
import { NextRequest } from "next/server";

const sp = (id: string, classification: string, extra = {}) => ({
  id, name: id, slug: id, type: "organization", classification, ownerUserId: "autre", ownerTeamId: null, ...extra,
});

beforeEach(() => {
  vi.clearAllMocks();
  h.selectQueue.length = 0;
  h.perm.mockResolvedValue("editor");
});

describe("space_list_hides_spaces_above_user_clearance", () => {
  it("GET /api/spaces masque l'espace secret sans permission explicite", async () => {
    // teamMembers, spacePermissions, spaces, owners
    h.selectQueue.push([], [], [sp("pub", "internal"), sp("sec", "secret")], []);
    const res = await listSpaces();
    const ids = ((await res.json()) as { id: string }[]).map((s) => s.id);
    expect(ids).toEqual(["pub"]);
  });

  it("GET /api/spaces garde l'espace secret dont l'appelant est membre explicite", async () => {
    h.selectQueue.push([], [{ spaceId: "sec" }], [sp("sec", "secret")], []);
    const res = await listSpaces();
    const ids = ((await res.json()) as { id: string }[]).map((s) => s.id);
    expect(ids).toEqual(["sec"]);
  });
});

describe("arborescence filtrée par classification", () => {
  const rows = [
    { id: "a", title: "Public", slug: "a", isFolder: false, icon: null, parentId: null, position: 0, classification: "internal", createdBy: "autre" },
    { id: "b", title: "Secret", slug: "b", isFolder: false, icon: null, parentId: null, position: 1, classification: "secret", createdBy: "autre" },
    { id: "c", title: "Confidentiel", slug: "c", isFolder: false, icon: null, parentId: null, position: 2, classification: "confidential", createdBy: "autre" },
  ];

  it("REST : un éditeur ne voit pas le titre d'un document secret dont il n'est pas auteur", async () => {
    h.selectQueue.push(rows, [] /* labels */);
    const res = await tree(new NextRequest("http://x/api/spaces/s/documents"), { params: Promise.resolve({ slug: "s" }) });
    const titles = ((await res.json()) as { title: string }[]).map((d) => d.title);
    expect(titles).toEqual(["Public", "Confidentiel"]);
  });

  it("REST : l'auteur et l'admin d'espace voient les documents secrets", async () => {
    h.perm.mockResolvedValue("admin");
    h.selectQueue.push(rows, []);
    const res = await tree(new NextRequest("http://x/api/spaces/s/documents"), { params: Promise.resolve({ slug: "s" }) });
    expect(((await res.json()) as unknown[]).length).toBe(3);
  });

  it("api/v1 : l'index n'expose pas le titre d'un document secret", async () => {
    h.selectQueue.push([{ id: "s", name: "S" }], rows);
    const res = await v1Index(new Request("http://x/api/v1/spaces/s/documents"), { params: Promise.resolve({ slug: "s" }) });
    const body = (await res.json()) as { data: { title: string }[] };
    expect(body.data.map((d) => d.title)).toEqual(["Public", "Confidentiel"]);
  });
});
