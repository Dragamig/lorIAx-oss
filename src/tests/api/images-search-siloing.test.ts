/**
 * Non-régression P0-6 / AZ-02 (audit du 2026-08-19).
 *
 * `/api/images/search` et `/api/studio/unsplash` résolvaient l'organisation par
 * `getOrgId(getOrgSlugFromHeaders(...))`, sans contrôle d'appartenance. Mallory,
 * membre du seul tenant `acme`, rejouait sa requête sur
 * `https://victime.example.com` et consommait les clés d'API tierces chiffrées du
 * tenant victime (quota, facturation, et déchiffrement de la clé côté serveur).
 *
 * Motif de vérification : « répond 404 ET ne fait rien ». L'absence d'effet de
 * bord est prouvée par le non-appel de `decrypt`, des adaptateurs de recherche
 * et de `fetch` : aucune clé n'est déchiffrée, aucun appel sortant n'est émis.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

const h = vi.hoisted(() => ({
  getSessionUser: vi.fn(),
  getSpacePermission: vi.fn(),
  decrypt: vi.fn(),
  searchPexels: vi.fn(),
  searchUnsplash: vi.fn(),
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
    where: vi.fn().mockReturnThis(),
    orderBy: vi.fn().mockResolvedValue(rows),
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
  },
}));
vi.mock("@/lib/crypto", () => ({ decrypt: h.decrypt }));
vi.mock("@/lib/images/adapters", () => ({
  searchPexels: h.searchPexels,
  searchPixabay: vi.fn(),
  searchShutterstock: vi.fn(),
  searchGetty: vi.fn(),
}));
vi.mock("@/lib/images/unsplash", () => ({ searchUnsplash: h.searchUnsplash }));
vi.mock("next/headers", () => ({
  headers: vi.fn().mockResolvedValue({
    // Mallory rejoue sa requête sur le sous-domaine du tenant victime.
    get: (k: string) => (k === "x-org-slug" ? "victime" : null),
  }),
}));

import { GET as searchGet } from "@/app/api/images/search/route";
import { GET as unsplashGet } from "@/app/api/studio/unsplash/route";

/** Mallory est membre du seul tenant `acme`, jamais du tenant `victime`. */
const MALLORY = { id: "mallory", email: "mallory@acme.tld", globalRole: "user" };

function queueNonMembre() {
  h.selectQueue.length = 0;
  h.selectQueue.push([{ id: "org-victime", slug: "victime", isActive: true }]);
  h.selectQueue.push([]);
  h.selectCalls.count = 0;
}

function queueMembre(...suite: unknown[][]) {
  h.selectQueue.length = 0;
  h.selectQueue.push([{ id: "org-victime", slug: "victime", isActive: true }]);
  h.selectQueue.push([{ organizationId: "org-victime" }]);
  for (const rows of suite) h.selectQueue.push(rows);
  h.selectCalls.count = 0;
}

/** Requêtes émises par `requireOrgScoped` avant tout accès métier. */
const REQUETES_HELPER = 2;

let fetchSpy: ReturnType<typeof vi.fn>;

beforeEach(() => {
  vi.clearAllMocks();
  h.getSessionUser.mockResolvedValue(MALLORY);
  fetchSpy = vi.fn();
  vi.stubGlobal("fetch", fetchSpy);
});

describe("GET /api/images/search : organisation étrangère (P0-6)", () => {
  it("répond 404, ne lit aucun fournisseur et ne déchiffre aucune clé", async () => {
    queueNonMembre();

    const res = await searchGet(
      new NextRequest("http://victime.example.com/api/images/search?provider=pexels&q=chien")
    );

    expect(res.status).toBe(404);
    // La table `image_providers` du tenant victime n'est jamais atteinte.
    expect(h.selectCalls.count).toBe(REQUETES_HELPER);
    expect(h.decrypt).not.toHaveBeenCalled();
    expect(h.searchPexels).not.toHaveBeenCalled();
    expect(h.searchUnsplash).not.toHaveBeenCalled();
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("refuse avant même de valider le paramètre `provider`", async () => {
    queueNonMembre();

    const res = await searchGet(
      new NextRequest("http://victime.example.com/api/images/search")
    );

    // 404 d'organisation, pas 400 : l'autorisation passe avant la validation.
    expect(res.status).toBe(404);
    expect(h.selectCalls.count).toBe(REQUETES_HELPER);
  });
});

describe("GET /api/studio/unsplash : organisation étrangère (P0-6)", () => {
  it("répond 404, ne déchiffre pas la clé du tenant victime et n'appelle pas Unsplash", async () => {
    queueNonMembre();

    const res = await unsplashGet(
      new NextRequest("http://victime.example.com/api/studio/unsplash?q=chien")
    );

    expect(res.status).toBe(404);
    expect(h.selectCalls.count).toBe(REQUETES_HELPER);
    expect(h.decrypt).not.toHaveBeenCalled();
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});

describe("Banques d'images : usages légitimes préservés", () => {
  it("recherche normalement pour un membre de l'organisation", async () => {
    queueMembre([
      {
        id: "prov-1",
        name: "pexels",
        providerType: "pexels",
        apiKeyEnc: "enc",
        isEnabled: true,
        organizationId: "org-victime",
      },
    ]);
    h.decrypt.mockReturnValue("cle-api");
    h.searchPexels.mockResolvedValue({ results: [{ id: "1" }], total: 1 });

    const res = await searchGet(
      new NextRequest("http://victime.example.com/api/images/search?provider=pexels&q=chien")
    );

    expect(res.status).toBe(200);
    // Contrat de réponse inchangé : { results, total }.
    const body = await res.json();
    expect(body.results).toHaveLength(1);
    expect(body.total).toBe(1);
    expect(h.searchPexels).toHaveBeenCalledWith("chien", 1, "cle-api");
  });
});
