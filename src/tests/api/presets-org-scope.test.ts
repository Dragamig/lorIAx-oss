/**
 * Cloisonnement — /api/presets
 *
 * GET listait tous les préréglages partagés de l'instance, avec le nom de leur
 * auteur, sans le moindre filtre d'organisation : une organisation isolée voyait
 * les préréglages (et les noms) des autres. DELETE laissait de plus un admin
 * global supprimer le préréglage d'une organisation étrangère.
 *
 * `shared_presets` n'ayant pas de colonne `organization_id`, le cloisonnement
 * passe par l'appartenance de l'auteur (même règle que `isOrgMember` :
 * l'organisation partagée par défaut reste le tenant mutualisé historique).
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

let results: unknown[][] = [];
let idx = 0;

const innerJoin = vi.fn();
const deleteWhere = vi.fn(() => Promise.resolve(undefined));

const makeChainableMock = () => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const self: any = {
    select: vi.fn(() => {
      idx += 1;
      return self;
    }),
    from: vi.fn().mockReturnThis(),
    innerJoin: vi.fn((...args: unknown[]) => {
      innerJoin(...args);
      return self;
    }),
    where: vi.fn().mockReturnThis(),
    orderBy: vi.fn().mockReturnThis(),
    limit: vi.fn(() => Promise.resolve(results[idx - 1] ?? [])),
    then: (resolve: (v: unknown[]) => void, reject?: (e: unknown) => void) =>
      Promise.resolve(results[idx - 1] ?? []).then(resolve, reject),
    insert: vi.fn().mockReturnThis(),
    values: vi.fn().mockReturnThis(),
    returning: vi.fn(() => Promise.resolve([{ id: "preset-1" }])),
    delete: vi.fn(() => ({ where: deleteWhere })),
  };
  return self;
};

vi.mock("@/lib/auth/get-user", () => ({
  getSessionUser: vi.fn().mockResolvedValue({
    id: "user-a",
    name: "User A",
    email: "a@org-a.com",
    globalRole: "admin",
  }),
}));

vi.mock("@/lib/org/get-request-org", () => ({
  getRequestOrgId: vi.fn(),
}));

vi.mock("@/lib/org/get-org-id", () => ({
  getDefaultOrgId: vi.fn().mockResolvedValue("org-default"),
}));

vi.mock("@/lib/db", () => ({ db: makeChainableMock() }));

import { getRequestOrgId } from "@/lib/org/get-request-org";

const mockOrgId = vi.mocked(getRequestOrgId);

beforeEach(() => {
  vi.clearAllMocks();
  results = [];
  idx = 0;
});

describe("GET /api/presets", () => {
  it("répond 403 quand aucune organisation n'est résolue (fail-closed)", async () => {
    mockOrgId.mockResolvedValue(null);
    const { GET } = await import("@/app/api/presets/route");
    const res = await GET();
    expect(res.status).toBe(403);
  });

  it("filtre sur l'appartenance de l'auteur dans une organisation isolée", async () => {
    mockOrgId.mockResolvedValue("org-b");
    results = [[]];
    const { GET } = await import("@/app/api/presets/route");
    const res = await GET();
    expect(res.status).toBe(200);
    // users + organization_members
    expect(innerJoin).toHaveBeenCalledTimes(2);
  });

  it("ne filtre pas dans l'organisation partagée par défaut", async () => {
    mockOrgId.mockResolvedValue("org-default");
    results = [[]];
    const { GET } = await import("@/app/api/presets/route");
    const res = await GET();
    expect(res.status).toBe(200);
    // users uniquement
    expect(innerJoin).toHaveBeenCalledTimes(1);
  });
});

const delReq = () =>
  new NextRequest("http://localhost/api/presets", {
    method: "DELETE",
    body: JSON.stringify({ id: "preset-1" }),
    headers: { "content-type": "application/json" },
  });

describe("DELETE /api/presets", () => {
  it("répond 404 quand l'auteur n'appartient pas à l'organisation courante", async () => {
    mockOrgId.mockResolvedValue("org-b");
    // 1: préréglage existant (auteur d'une autre org) ; 2: appartenance absente
    results = [[{ userId: "user-etranger" }], []];
    const { DELETE } = await import("@/app/api/presets/route");
    const res = await DELETE(delReq());
    expect(res.status).toBe(404);
    expect(deleteWhere).not.toHaveBeenCalled();
  });

  it("supprime le préréglage d'un auteur de l'organisation courante", async () => {
    mockOrgId.mockResolvedValue("org-b");
    results = [[{ userId: "user-b" }], [{ organizationId: "org-b" }]];
    const { DELETE } = await import("@/app/api/presets/route");
    const res = await DELETE(delReq());
    expect(res.status).toBe(200);
    expect(deleteWhere).toHaveBeenCalled();
  });
});
