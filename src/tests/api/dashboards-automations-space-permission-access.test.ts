/**
 * Non-régression P0-4 / AZ-01 (audit du 2026-08-19), sur le modèle de
 * `databases-space-permission-access.test.ts`.
 *
 * Seuls l'export et la liste des bases avaient un test de permission d'espace
 * dédié pour `requireOrgScoped`. `GET/POST /api/dashboards` et
 * `GET/POST /api/automations` résolvent aussi leur ressource via
 * `{ resource: { type: "space", id: spaceId }, minPermission: ... }`, sans
 * couverture propre : un simple membre de l'organisation pourrait lister ou
 * créer des tableaux de bord / automatismes sur un espace où il n'a aucun
 * droit si ce contrôle régressait.
 *
 * Motif de vérification : « répond 403 (ou 404) et ne fait rien ». L'absence
 * d'effet de bord est prouvée par le nombre d'accès à la base : le refus doit
 * intervenir après les seules requêtes du helper (organisation, appartenance,
 * résolution de l'espace), et avant toute lecture/écriture métier.
 *
 * `getSpacePermission` (mock ci-dessous) a été corrigé récemment : il gère
 * désormais des replis implicites pour les espaces d'organisation et les
 * espaces d'équipe (voir `src/lib/auth/check-access.ts`,
 * `resolveImplicitSpacePermission`). Ce fichier ne rejoue pas cette logique :
 * il mocke `getSpacePermission` comme un point d'entrée opaque (ainsi que le
 * fait `requireOrgScoped`, qui l'appelle sans connaître son implémentation),
 * ce qui reste valide quel que soit l'état interne de cette fonction.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

const h = vi.hoisted(() => ({
  getSessionUser: vi.fn(),
  getSpacePermission: vi.fn(),
  selectQueue: [] as unknown[][],
  selectCalls: { count: 0 },
  insertCalls: { count: 0 },
}));

function chain(rows: unknown[]) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const self: any = {
    then: (resolve: (v: unknown[]) => void, reject?: (e: unknown) => void) =>
      Promise.resolve(rows).then(resolve, reject),
    from: vi.fn().mockReturnThis(),
    innerJoin: vi.fn().mockReturnThis(),
    where: vi.fn().mockReturnThis(),
    orderBy: vi.fn().mockResolvedValue(rows),
    limit: vi.fn().mockResolvedValue(rows),
    values: vi.fn().mockReturnThis(),
    returning: vi.fn().mockResolvedValue(rows),
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
      h.insertCalls.count += 1;
      return chain([]);
    }),
  },
}));
vi.mock("next/headers", () => ({
  headers: vi.fn().mockResolvedValue({
    get: (k: string) => (k === "x-org-slug" ? "acme" : null),
  }),
}));
vi.mock("@/lib/settings/system-settings", () => ({
  getSetting: vi.fn().mockResolvedValue(null),
}));

import { GET as dashboardsGet, POST as dashboardsPost } from "@/app/api/dashboards/route";
import { GET as automationsGet, POST as automationsPost } from "@/app/api/automations/route";

/** Alice est membre de l'org `acme` mais n'a aucune permission sur l'espace RH. */
const ALICE = { id: "alice", email: "alice@acme.tld", globalRole: "user" };

/** Réponses du helper pour une ressource `space` : organisation, appartenance, espace. */
function queueHelperRows(space: unknown) {
  h.selectQueue.length = 0;
  h.selectQueue.push([{ id: "org-1", slug: "acme", isActive: true }]);
  h.selectQueue.push([{ organizationId: "org-1" }]);
  h.selectQueue.push([space]);
  h.selectCalls.count = 0;
}

const HELPER_QUERIES = 3;

beforeEach(() => {
  vi.clearAllMocks();
  h.getSessionUser.mockResolvedValue(ALICE);
  h.insertCalls.count = 0;
});

describe("GET /api/dashboards — permission d'espace", () => {
  it("répond 403 et ne liste aucun tableau de bord d'un espace non autorisé", async () => {
    queueHelperRows({ id: "space-rh", organizationId: "org-1" });
    h.getSpacePermission.mockResolvedValue(null);

    const res = await dashboardsGet(
      new NextRequest("http://acme.example.com/api/dashboards?spaceId=space-rh")
    );

    expect(res.status).toBe(403);
    // Seules les requêtes du helper : la table des tableaux de bord n'est pas lue.
    expect(h.selectCalls.count).toBe(HELPER_QUERIES);
  });

  it("répond 404 sans interroger la permission quand l'espace est d'une autre organisation", async () => {
    queueHelperRows({ id: "space-x", organizationId: "org-autre" });

    const res = await dashboardsGet(
      new NextRequest("http://acme.example.com/api/dashboards?spaceId=space-x")
    );

    expect(res.status).toBe(404);
    expect(h.getSpacePermission).not.toHaveBeenCalled();
    expect(h.selectCalls.count).toBe(HELPER_QUERIES);
  });

  it("laisse passer un viewer légitime", async () => {
    queueHelperRows({ id: "space-com", organizationId: "org-1" });
    h.getSpacePermission.mockResolvedValue("viewer");

    const res = await dashboardsGet(
      new NextRequest("http://acme.example.com/api/dashboards?spaceId=space-com")
    );

    expect(res.status).toBe(200);
  });
});

// Zod exige un UUID pour `spaceId` en écriture (POST) : les routes GET, elles,
// lisent le paramètre tel quel.
const SPACE_RH_UUID = "9a1b28f4-99e3-4387-bcef-c4bf67847dab";

describe("POST /api/dashboards — permission d'espace", () => {
  it("répond 403 et ne crée aucun tableau de bord quand l'utilisateur n'est pas éditeur", async () => {
    queueHelperRows({ id: SPACE_RH_UUID, organizationId: "org-1" });
    h.getSpacePermission.mockResolvedValue("viewer");

    const res = await dashboardsPost(
      new Request("http://acme.example.com/api/dashboards", {
        method: "POST",
        body: JSON.stringify({ name: "Tableau RH", spaceId: SPACE_RH_UUID }),
        headers: { "Content-Type": "application/json" },
      })
    );

    expect(res.status).toBe(403);
    expect(h.insertCalls.count).toBe(0);
  });
});

describe("GET /api/automations — permission d'espace", () => {
  it("répond 403 et ne liste aucun automatisme d'un espace non autorisé", async () => {
    queueHelperRows({ id: "space-rh", organizationId: "org-1" });
    h.getSpacePermission.mockResolvedValue(null);

    const res = await automationsGet(
      new Request("http://acme.example.com/api/automations?spaceId=space-rh")
    );

    expect(res.status).toBe(403);
    expect(h.selectCalls.count).toBe(HELPER_QUERIES);
  });

  it("répond 404 sans interroger la permission quand l'espace est d'une autre organisation", async () => {
    queueHelperRows({ id: "space-x", organizationId: "org-autre" });

    const res = await automationsGet(
      new Request("http://acme.example.com/api/automations?spaceId=space-x")
    );

    expect(res.status).toBe(404);
    expect(h.getSpacePermission).not.toHaveBeenCalled();
    expect(h.selectCalls.count).toBe(HELPER_QUERIES);
  });

  it("laisse passer un viewer légitime", async () => {
    queueHelperRows({ id: "space-com", organizationId: "org-1" });
    h.getSpacePermission.mockResolvedValue("viewer");

    const res = await automationsGet(
      new Request("http://acme.example.com/api/automations?spaceId=space-com")
    );

    expect(res.status).toBe(200);
  });
});

describe("POST /api/automations — permission d'espace", () => {
  it("répond 403 et ne crée aucun automatisme quand l'utilisateur n'est pas éditeur de l'espace", async () => {
    queueHelperRows({ id: SPACE_RH_UUID, organizationId: "org-1" });
    h.getSpacePermission.mockResolvedValue("viewer");

    const res = await automationsPost(
      new Request("http://acme.example.com/api/automations", {
        method: "POST",
        body: JSON.stringify({
          spaceId: SPACE_RH_UUID,
          name: "Automatisme RH",
          actionType: "send_email",
        }),
        headers: { "Content-Type": "application/json" },
      })
    );

    expect(res.status).toBe(403);
    expect(h.insertCalls.count).toBe(0);
    // Refusé par requireOrgScoped, avant même le garde de rôle canManageAutomations.
    expect(h.selectCalls.count).toBe(HELPER_QUERIES);
  });
});
