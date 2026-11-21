/**
 * Tests de cloisonnement multi-tenant (tenant siloing)
 *
 * Vérifie que les routes `/api/spaces/[slug]/documents` et
 * `/api/spaces/[slug]/activity` retournent 404 (jamais 200 ni 403) quand
 * le slug appartient à une autre organisation — grâce à
 * `getSpaceBySlugForRequest` qui renvoie `null` dans ce cas.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

// ── Thenable chainable DB mock ────────────────────────────────────────────────
// The DB query chain can end at various points (orderBy, where, limit, offset).
// Making the mock object itself a thenable lets `await db.select()...orderBy()`
// resolve to `[]` regardless of which method ends the chain.

const makeChainableMock = () => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const self: any = {
    then: (resolve: (v: never[]) => void, reject?: (e: unknown) => void) =>
      Promise.resolve([]).then(resolve, reject),
    select: vi.fn().mockReturnThis(),
    from: vi.fn().mockReturnThis(),
    where: vi.fn().mockReturnThis(),
    orderBy: vi.fn().mockReturnThis(),
    innerJoin: vi.fn().mockReturnThis(),
    leftJoin: vi.fn().mockReturnThis(),
    limit: vi.fn().mockReturnThis(),
    offset: vi.fn().mockResolvedValue([]),
    insert: vi.fn().mockReturnThis(),
    values: vi.fn().mockReturnThis(),
    onConflictDoNothing: vi.fn().mockReturnThis(),
    returning: vi.fn().mockResolvedValue([]),
    update: vi.fn().mockReturnThis(),
    set: vi.fn().mockReturnThis(),
    delete: vi.fn().mockReturnThis(),
  };
  return self;
};

// ── Mocks hoistés ─────────────────────────────────────────────────────────────

vi.mock("@/lib/auth/get-user", () => ({
  getSessionUser: vi.fn().mockResolvedValue({
    id: "user-a",
    name: "Alice",
    email: "alice@org-a.com",
    globalRole: "viewer",
  }),
}));

vi.mock("@/lib/org/scoped-space", () => ({
  getSpaceBySlugForRequest: vi.fn(),
}));

vi.mock("@/lib/db", () => ({
  db: makeChainableMock(),
}));

// Documents route additional deps
vi.mock("@/lib/storage/filesystem", () => ({
  writeDocument: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("@/lib/git/repository", () => ({
  commitFile: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("@/lib/activity", () => ({
  logActivity: vi.fn(),
}));

vi.mock("@/lib/auth/check-access", () => ({
  getSpacePermission: vi.fn().mockResolvedValue("editor"),
  getAccessibleSpaceIds: vi.fn().mockResolvedValue([]),
}));

vi.mock("@/lib/templates/builtin", () => ({
  getBuiltinTemplateById: vi.fn().mockReturnValue(null),
}));

vi.mock("@/lib/editor/template-to-yjs", () => ({
  templateContentToYjsState: vi.fn().mockReturnValue(null),
}));

// ── Imports ───────────────────────────────────────────────────────────────────

import { getSpaceBySlugForRequest } from "@/lib/org/scoped-space";
import { getSessionUser } from "@/lib/auth/get-user";

const mockGetSpace = vi.mocked(getSpaceBySlugForRequest);
const mockGetUser = vi.mocked(getSessionUser);

const SPACE_ORG_A = {
  id: "space-org-a",
  slug: "my-space",
  organizationId: "org-a",
  name: "Mon espace",
  gitRepoPath: "/tmp/repo",
  type: "team",
  classification: "internal",
  ownerUserId: "user-a",
};

// ── GET /api/spaces/[slug]/documents ─────────────────────────────────────────

describe("GET /api/spaces/[slug]/documents — cloisonnement multi-tenant", () => {
  beforeEach(() => vi.clearAllMocks());

  it("retourne 404 quand le slug appartient à une autre org (cross-org)", async () => {
    mockGetSpace.mockResolvedValueOnce(null);
    const { GET } = await import("@/app/api/spaces/[slug]/documents/route");
    const req = new Request("http://localhost/api/spaces/org-b-space/documents");
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const res = await GET(req as any, { params: Promise.resolve({ slug: "org-b-space" }) });
    expect(res.status).toBe(404);
    expect(mockGetSpace).toHaveBeenCalledWith("org-b-space", expect.objectContaining({ id: "user-a" }));
  });

  it("retourne 200 quand le slug appartient à l'org courante", async () => {
    mockGetSpace.mockResolvedValueOnce(SPACE_ORG_A as never);
    const { GET } = await import("@/app/api/spaces/[slug]/documents/route");
    const req = new Request("http://localhost/api/spaces/my-space/documents");
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const res = await GET(req as any, { params: Promise.resolve({ slug: "my-space" }) });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(Array.isArray(body)).toBe(true);
  });

  it("retourne 401 si non authentifié", async () => {
    mockGetUser.mockResolvedValueOnce(null);
    const { GET } = await import("@/app/api/spaces/[slug]/documents/route");
    const req = new Request("http://localhost/api/spaces/my-space/documents");
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const res = await GET(req as any, { params: Promise.resolve({ slug: "my-space" }) });
    expect(res.status).toBe(401);
  });
});

// ── GET /api/spaces/[slug]/activity ──────────────────────────────────────────

describe("GET /api/spaces/[slug]/activity — cloisonnement multi-tenant", () => {
  beforeEach(() => vi.clearAllMocks());

  it("retourne 404 quand le slug appartient à une autre org (cross-org)", async () => {
    mockGetSpace.mockResolvedValueOnce(null);
    const { GET } = await import("@/app/api/spaces/[slug]/activity/route");
    const req = new NextRequest("http://localhost/api/spaces/org-b-space/activity");
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const res = await GET(req as any, { params: Promise.resolve({ slug: "org-b-space" }) });
    expect(res.status).toBe(404);
    expect(mockGetSpace).toHaveBeenCalledWith("org-b-space", expect.objectContaining({ id: "user-a" }));
  });

  it("retourne 200 quand le slug appartient à l'org courante", async () => {
    mockGetSpace.mockResolvedValueOnce(SPACE_ORG_A as never);
    const { GET } = await import("@/app/api/spaces/[slug]/activity/route");
    const req = new NextRequest("http://localhost/api/spaces/my-space/activity");
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const res = await GET(req as any, { params: Promise.resolve({ slug: "my-space" }) });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(Array.isArray(body)).toBe(true);
  });

  it("retourne 401 si non authentifié", async () => {
    mockGetUser.mockResolvedValueOnce(null);
    const { GET } = await import("@/app/api/spaces/[slug]/activity/route");
    const req = new NextRequest("http://localhost/api/spaces/my-space/activity");
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const res = await GET(req as any, { params: Promise.resolve({ slug: "my-space" }) });
    expect(res.status).toBe(401);
  });
});
