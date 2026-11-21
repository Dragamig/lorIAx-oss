/**
 * Contrôle d'accès — GET /api/spaces/[slug]/documents
 *
 * L'espace était bien confiné à l'organisation courante, mais aucune
 * permission d'espace n'était exigée : tout membre de l'organisation pouvait
 * lister l'arborescence complète de n'importe quel espace, y compris privé.
 * La route exige désormais au moins un droit de lecture (getSpacePermission,
 * qui couvre le propriétaire de l'espace et l'admin global).
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

let docRows: unknown[] = [];

const makeChainableMock = () => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const self: any = {
    then: (resolve: (v: unknown[]) => void, reject?: (e: unknown) => void) =>
      Promise.resolve([]).then(resolve, reject),
    select: vi.fn().mockReturnThis(),
    from: vi.fn().mockReturnThis(),
    innerJoin: vi.fn().mockReturnThis(),
    where: vi.fn().mockReturnThis(),
    orderBy: vi.fn(() => Promise.resolve(docRows)),
    limit: vi.fn(() => Promise.resolve(docRows)),
  };
  return self;
};

vi.mock("@/lib/auth/get-user", () => ({
  getSessionUser: vi.fn().mockResolvedValue({
    id: "user-a",
    name: "User A",
    email: "a@org-a.com",
    globalRole: "user",
  }),
}));

vi.mock("@/lib/org/scoped-space", () => ({
  getSpaceBySlugForRequest: vi.fn(),
}));

vi.mock("@/lib/auth/check-access", () => ({
  getSpacePermission: vi.fn(),
}));

vi.mock("@/lib/db", () => ({ db: makeChainableMock() }));

import { getSpaceBySlugForRequest } from "@/lib/org/scoped-space";
import { getSpacePermission } from "@/lib/auth/check-access";

const mockSpace = vi.mocked(getSpaceBySlugForRequest);
const mockPerm = vi.mocked(getSpacePermission);

const ctx = { params: Promise.resolve({ slug: "espace-prive" }) };
const req = () => new NextRequest("http://localhost/api/spaces/espace-prive/documents");

beforeEach(() => {
  vi.clearAllMocks();
  docRows = [];
  mockSpace.mockResolvedValue({ id: "space-1", slug: "espace-prive" } as never);
});

describe("GET /api/spaces/[slug]/documents — contrôle d'accès", () => {
  it("répond 403 quand l'utilisateur n'a aucune permission sur l'espace", async () => {
    mockPerm.mockResolvedValue(null);
    const { GET } = await import("@/app/api/spaces/[slug]/documents/route");
    const res = await GET(req(), ctx);
    expect(res.status).toBe(403);
    await expect(res.json()).resolves.toEqual({ error: "Accès refusé" });
  });

  it("répond 404 quand l'espace n'existe pas dans l'organisation courante", async () => {
    mockSpace.mockResolvedValue(null as never);
    const { GET } = await import("@/app/api/spaces/[slug]/documents/route");
    const res = await GET(req(), ctx);
    expect(res.status).toBe(404);
    expect(mockPerm).not.toHaveBeenCalled();
  });

  it("répond 200 avec l'arborescence pour un simple lecteur de l'espace", async () => {
    mockPerm.mockResolvedValue("viewer");
    const { GET } = await import("@/app/api/spaces/[slug]/documents/route");
    const res = await GET(req(), ctx);
    expect(res.status).toBe(200);
    expect(mockPerm).toHaveBeenCalledWith("user-a", "space-1");
  });

  it("répond 200 pour le propriétaire de l'espace (permission implicite admin)", async () => {
    // getSpacePermission renvoie "admin" au propriétaire sans entrée explicite
    mockPerm.mockResolvedValue("admin");
    const { GET } = await import("@/app/api/spaces/[slug]/documents/route");
    const res = await GET(req(), ctx);
    expect(res.status).toBe(200);
  });
});
