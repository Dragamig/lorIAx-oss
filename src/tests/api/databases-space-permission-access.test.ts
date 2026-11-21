/**
 * Non-régression P0-4 / AZ-01 (audit du 2026-08-19).
 *
 * `requireOrgScoped` ne testait la permission d'espace que si `minPermission`
 * lui était fourni. Sans ce paramètre, 17 routes ne validaient que
 * l'appartenance à l'organisation : un simple membre pouvait lister les bases
 * d'un espace où il n'a aucun droit, puis en exporter jusqu'à 100 000 lignes.
 *
 * Motif de vérification : « répond 403 et ne fait rien ». L'absence d'effet de
 * bord est prouvée par le nombre d'accès à la base : le refus doit intervenir
 * après les seules requêtes du helper (organisation, appartenance, ressource),
 * et avant toute lecture de données métier.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

const h = vi.hoisted(() => ({
  getSessionUser: vi.fn(),
  getSpacePermission: vi.fn(),
  selectQueue: [] as unknown[][],
  selectCalls: { count: 0 },
}));

function chain(rows: unknown[]) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const self: any = {
    then: (resolve: (v: unknown[]) => void, reject?: (e: unknown) => void) =>
      Promise.resolve(rows).then(resolve, reject),
    from: vi.fn().mockReturnThis(),
    innerJoin: vi.fn().mockReturnThis(),
    leftJoin: vi.fn().mockReturnThis(),
    where: vi.fn().mockReturnThis(),
    orderBy: vi.fn().mockReturnThis(),
    limit: vi.fn().mockResolvedValue(rows),
  };
  return self;
}

vi.mock("@/lib/auth/get-user", () => ({ getSessionUser: h.getSessionUser }));
vi.mock("@/lib/auth/check-access", () => ({
  getSpacePermission: h.getSpacePermission,
  isGlobalAdmin: (u: { globalRole?: string }) =>
    u?.globalRole === "admin" || u?.globalRole === "super_admin",
}));
// `requireOrgScoped` ne recopie plus la règle de résolution d'organisation, il
// délègue à `resolveRequestOrg` (revue adversariale du lot 6, 2026-08-20).
// Celle-ci consulte l'organisation partagée par défaut pour la distinguer d'un
// tenant isolé : seule cette lecture-là est doublée ici, la règle de
// résolution reste exercée pour de vrai.
vi.mock("@/lib/org/get-org-id", () => ({
  getDefaultOrgId: async () => "org-par-defaut",
}));

vi.mock("@/lib/db", () => ({
  db: {
    select: vi.fn(() => {
      const rows = h.selectQueue[h.selectCalls.count] ?? [];
      h.selectCalls.count += 1;
      return chain(rows);
    }),
    insert: vi.fn(() => {
      throw new Error("écriture interdite dans ce test");
    }),
  },
}));
vi.mock("next/headers", () => ({
  headers: vi.fn().mockResolvedValue({
    get: (k: string) => (k === "x-org-slug" ? "acme" : null),
  }),
}));
vi.mock("@/lib/onboarding/progress", () => ({ recordIfRealSpace: vi.fn() }));

import { GET as exportGet } from "@/app/api/databases/[databaseId]/export/route";
import { GET as listGet } from "@/app/api/databases/route";

/** Alice est membre de l'org `acme` mais n'a aucune permission sur l'espace RH. */
const ALICE = { id: "alice", email: "alice@acme.tld", globalRole: "user" };

/** Réponses du helper : organisation, appartenance, puis résolution de la ressource. */
function queueHelperRows(resource: unknown) {
  h.selectQueue.length = 0;
  h.selectQueue.push([{ id: "org-1", slug: "acme", isActive: true }]);
  h.selectQueue.push([{ organizationId: "org-1" }]);
  h.selectQueue.push([resource]);
  h.selectCalls.count = 0;
}

const HELPER_QUERIES = 3;

beforeEach(() => {
  vi.clearAllMocks();
  h.getSessionUser.mockResolvedValue(ALICE);
});

describe("GET /api/databases/[databaseId]/export — permission d'espace", () => {
  it("répond 403 et n'exporte aucune ligne quand l'utilisateur n'a aucun droit sur l'espace", async () => {
    queueHelperRows({ spaceId: "space-rh", organizationId: "org-1" });
    h.getSpacePermission.mockResolvedValue(null);

    const res = await exportGet(
      new NextRequest("http://acme.example.com/api/databases/db-rh/export?format=xlsx"),
      { params: Promise.resolve({ databaseId: "db-rh" }) }
    );

    expect(res.status).toBe(403);
    expect(h.selectCalls.count).toBe(HELPER_QUERIES);
    expect(res.headers.get("content-type")).toContain("application/json");
  });

  it("répond 404 sans interroger la permission quand la base est d'une autre organisation", async () => {
    queueHelperRows({ spaceId: "space-x", organizationId: "org-autre" });

    const res = await exportGet(
      new NextRequest("http://acme.example.com/api/databases/db-x/export?format=csv"),
      { params: Promise.resolve({ databaseId: "db-x" }) }
    );

    expect(res.status).toBe(404);
    expect(h.getSpacePermission).not.toHaveBeenCalled();
    expect(h.selectCalls.count).toBe(HELPER_QUERIES);
  });

  it("laisse passer un viewer légitime", async () => {
    queueHelperRows({ spaceId: "space-rh", organizationId: "org-1" });
    h.getSpacePermission.mockResolvedValue("viewer");

    const res = await exportGet(
      new NextRequest("http://acme.example.com/api/databases/db-rh/export?format=ods"),
      { params: Promise.resolve({ databaseId: "db-rh" }) }
    );

    // 501 = le contrôle d'accès est passé, seul le format est refusé.
    expect(res.status).toBe(501);
  });
});

describe("GET /api/databases — permission d'espace", () => {
  it("répond 403 et ne liste aucune base d'un espace non autorisé", async () => {
    queueHelperRows({ id: "space-rh", organizationId: "org-1" });
    h.getSpacePermission.mockResolvedValue(null);

    const res = await listGet(
      new NextRequest("http://acme.example.com/api/databases?spaceId=space-rh")
    );

    expect(res.status).toBe(403);
    expect(h.selectCalls.count).toBe(HELPER_QUERIES);
  });
});
