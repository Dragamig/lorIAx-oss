import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/auth/get-user", () => ({
  getSessionUser: vi.fn().mockResolvedValue({ id: "user-1", globalRole: "admin" }),
}));
// Depuis le correctif P0-6 (audit du 2026-08-19), la route résout
// l'organisation par `requireOrgScoped`, qui contrôle l'appartenance. Ces tests
// restent fonctionnels : le helper est simulé comme autorisant, le cloisonnement
// lui-même est couvert par `images-search-siloing.test.ts`.
vi.mock("@/lib/auth/require-org-scoped", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/auth/require-org-scoped")>();
  return {
    ...actual,
    requireOrgScoped: vi.fn().mockResolvedValue({
      user: { id: "user-1", globalRole: "admin" },
      orgId: "org-1",
      orgSlug: "default",
    }),
  };
});

const mockProvider = {
  id: "prov-1",
  name: "pexels",
  displayName: "Pexels",
  providerType: "pexels",
  baseUrl: null,
  apiKeyEnc: "enc-key",
  isEnabled: true,
  organizationId: "org-1",
};

vi.mock("@/lib/db", () => ({
  db: {
    select: vi.fn().mockReturnThis(),
    from: vi.fn().mockReturnThis(),
    where: vi.fn().mockReturnThis(),
    limit: vi.fn().mockResolvedValue([mockProvider]),
  },
}));

vi.mock("@/lib/crypto", () => ({
  decrypt: vi.fn().mockReturnValue("fake-api-key"),
}));

vi.mock("@/lib/images/adapters", () => ({
  searchPexels: vi.fn().mockResolvedValue({
    results: [{ id: "1", thumb: "t.jpg", regular: "r.jpg", description: "chien", credit: "Bob", creditUrl: "https://pexels.com/u/bob" }],
    total: 1,
  }),
  searchPixabay: vi.fn(),
  searchShutterstock: vi.fn(),
  searchGetty: vi.fn(),
}));

vi.mock("@/lib/images/unsplash", () => ({
  searchUnsplash: vi.fn().mockResolvedValue({ results: [], total: 0 }),
}));

describe("GET /api/images/search — non authentifié", () => {
  it("retourne 401 si session absente", async () => {
    const { NextResponse } = await import("next/server");
    const { requireOrgScoped, OrgScopeError } = await import("@/lib/auth/require-org-scoped");
    vi.mocked(requireOrgScoped).mockRejectedValueOnce(
      new OrgScopeError(
        NextResponse.json({ error: "Non authentifié" }, { status: 401 }),
        "unauthenticated"
      )
    );
    const { GET } = await import("@/app/api/images/search/route");
    const req = new Request("http://localhost/api/images/search?provider=pexels");
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const res = await GET(req as any);
    expect(res.status).toBe(401);
  });
});

type MockDb = {
  select: ReturnType<typeof vi.fn>;
  from: ReturnType<typeof vi.fn>;
  where: ReturnType<typeof vi.fn>;
  limit: ReturnType<typeof vi.fn>;
};

describe("GET /api/images/search — fournisseur introuvable", () => {
  it("retourne 404 si fournisseur désactivé ou absent", async () => {
    const { db } = await import("@/lib/db");
    (db as unknown as MockDb).limit.mockResolvedValueOnce([]);
    const { GET } = await import("@/app/api/images/search/route");
    const req = new Request("http://localhost/api/images/search?provider=pexels");
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const res = await GET(req as any);
    expect(res.status).toBe(404);
  });
});

describe("GET /api/images/search", () => {
  beforeEach(() => vi.clearAllMocks());

  it("retourne 400 si provider manquant", async () => {
    const { GET } = await import("@/app/api/images/search/route");
    const req = new Request("http://localhost/api/images/search");
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const res = await GET(req as any);
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toMatch(/provider/);
  });

  it("retourne les résultats normalisés pour pexels", async () => {
    const { GET } = await import("@/app/api/images/search/route");
    const req = new Request("http://localhost/api/images/search?provider=pexels&q=chien&page=1");
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const res = await GET(req as any);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.results).toHaveLength(1);
    expect(body.results[0]).toHaveProperty("thumb");
    expect(body.results[0]).toHaveProperty("regular");
    expect(body.results[0]).toHaveProperty("credit");
  });
});
