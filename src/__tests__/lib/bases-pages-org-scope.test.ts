/**
 * Pages de l'espace Bases qui prennent un `spaceId` dans les paramètres de
 * requête (revue adversariale du lot 6, 2026-08-20).
 *
 * Elles autorisaient sur la seule permission d'espace, via `getSpacePermission`
 * qui n'applique aucun filtre d'organisation : viser un espace d'un autre
 * tenant passait le contrôle. Même motif que le banc de montage, impact
 * moindre. Le contrôle passe désormais par `requireOrgScoped`, qui confronte
 * l'espace à l'organisation de la requête avant de rendre la permission.
 *
 * Composants serveur : appelés comme les fonctions asynchrones qu'ils sont.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";

const h = vi.hoisted(() => ({
  // Déclarée dans le `vi.hoisted` : les factories de `vi.mock` sont remontées
  // en tête de fichier et ne voient rien du corps du module.
  OrgScopeError: class FauxOrgScopeError extends Error {
    constructor(public readonly reason: string) {
      super(reason);
    }
  },
  getSessionUser: vi.fn(),
  requireOrgScoped: vi.fn(),
  // Doublure de l'ancien contrôle, hors du chemin des pages depuis le
  // correctif : elle garantit que son annulation rougit sur une ASSERTION et
  // non sur un plantage de doublure.
  getSpacePermission: vi.fn(),
  getAccessibleSpaceIds: vi.fn(),
  redirect: vi.fn(() => {
    throw new Error("NEXT_REDIRECT");
  }),
  notFound: vi.fn(() => {
    throw new Error("NEXT_NOT_FOUND");
  }),
  rows: [] as unknown[],
  lastSpaceCookie: undefined as string | undefined,
}));

vi.mock("@/lib/auth/get-user", () => ({ getSessionUser: h.getSessionUser }));
vi.mock("@/lib/auth/require-org-scoped", () => ({
  requireOrgScoped: h.requireOrgScoped,
  OrgScopeError: h.OrgScopeError,
}));
vi.mock("next/navigation", () => ({
  redirect: h.redirect,
  notFound: h.notFound,
}));
vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: (name: string) =>
      name === "loriax-space" && h.lastSpaceCookie !== undefined
        ? { name, value: h.lastSpaceCookie }
        : undefined,
  }),
}));
vi.mock("@/lib/db", () => {
  // Chaîne « thenable » : chaque maillon rend la chaîne, et l'attente rend la
  // file de lignes courante. Permet d'exercer indifféremment les formes
  // `.orderBy(...).limit(1)` et `.where(...).orderBy(...)`.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const chain: any = {
    from: () => chain,
    innerJoin: () => chain,
    where: () => chain,
    orderBy: () => chain,
    limit: () => chain,
    then: (resolve: (v: unknown[]) => void, reject?: (e: unknown) => void) =>
      Promise.resolve(h.rows).then(resolve, reject),
  };
  return { db: { select: () => chain } };
});
vi.mock("@/lib/auth/check-access", () => ({
  getAccessibleSpaceIds: h.getAccessibleSpaceIds,
  getSpacePermission: h.getSpacePermission,
}));
vi.mock("@/lib/ai/provider", () => ({
  getDefaultProvider: () => ({ name: "claude", model: "test" }),
}));

import BasesIndexPage from "@/app/[locale]/(app)/bases/page";
import ArchivedBasesPage from "@/app/[locale]/(app)/bases/archived/page";
import TrashedBasesPage from "@/app/[locale]/(app)/bases/trash/page";
import BasesSettingsPage from "@/app/[locale]/(app)/bases/settings/page";
import BasesAiToolsPage from "@/app/[locale]/(app)/bases/ai-tools/page";
import BasesFormulaHelpPage from "@/app/[locale]/(app)/bases/aide-formules/page";

const PAGES: Array<[string, (p: { searchParams: Promise<{ spaceId?: string }> }) => unknown]> = [
  ["archived", ArchivedBasesPage],
  ["trash", TrashedBasesPage],
  ["settings", BasesSettingsPage],
  ["ai-tools", BasesAiToolsPage],
  ["aide-formules", BasesFormulaHelpPage],
];

const SPACE_VICTIME = "space-victime";

beforeEach(() => {
  vi.clearAllMocks();
  h.rows = [];
  h.lastSpaceCookie = undefined;
  h.getSessionUser.mockResolvedValue({ id: "admin-acme", globalRole: "admin" });
  // Ancien comportement : un `admin` global obtenait "admin" sur tout espace.
  h.getSpacePermission.mockResolvedValue("admin");
  h.getAccessibleSpaceIds.mockResolvedValue(["space-legitime"]);
  h.redirect.mockImplementation(() => {
    throw new Error("NEXT_REDIRECT");
  });
});

describe.each(PAGES)("page /bases/%s — cloisonnement d'organisation", (nom, Page) => {
  it("confronte le spaceId des paramètres de requête à l'organisation, au seuil viewer", async () => {
    h.requireOrgScoped.mockResolvedValue({ permission: "editor" });
    await Page({ searchParams: Promise.resolve({ spaceId: SPACE_VICTIME }) });
    expect(h.requireOrgScoped).toHaveBeenCalledWith({
      resource: { type: "space", id: SPACE_VICTIME },
      minPermission: "viewer",
    });
    expect(nom).toBeTruthy();
  });

  it("renvoie muettement vers /bases quand l'espace est d'une autre organisation", async () => {
    h.requireOrgScoped.mockRejectedValue(new h.OrgScopeError("resource-not-found"));
    await expect(
      Page({ searchParams: Promise.resolve({ spaceId: SPACE_VICTIME }) })
    ).rejects.toThrowError("NEXT_REDIRECT");
    expect(h.redirect).toHaveBeenCalledWith("/bases");
  });

  it("laisse remonter une erreur qui n'est pas un refus de portée", async () => {
    h.requireOrgScoped.mockRejectedValue(new Error("panne base de données"));
    await expect(
      Page({ searchParams: Promise.resolve({ spaceId: SPACE_VICTIME }) })
    ).rejects.toThrowError("panne base de données");
  });
});

describe("page /bases — spaceId des paramètres de requête", () => {
  beforeEach(() => {
    // Un espace accessible (celui rendu par la liste autoritative) et une
    // première base à cibler.
    h.rows = [{ id: "space-legitime" }];
  });

  it("confronte le spaceId demandé à l'organisation avant de s'en servir", async () => {
    h.requireOrgScoped.mockResolvedValue({ permission: "viewer" });
    await expect(
      BasesIndexPage({ searchParams: Promise.resolve({ spaceId: SPACE_VICTIME }) })
    ).rejects.toThrowError("NEXT_REDIRECT");
    expect(h.requireOrgScoped).toHaveBeenCalledWith({
      resource: { type: "space", id: SPACE_VICTIME },
      minPermission: "viewer",
    });
    expect(h.redirect).toHaveBeenCalledWith(
      "/bases/space-legitime?spaceId=space-victime"
    );
  });

  it("ignore silencieusement un spaceId d'une autre organisation et retombe sur un espace accessible", async () => {
    h.requireOrgScoped.mockRejectedValue(new h.OrgScopeError("resource-not-found"));
    await expect(
      BasesIndexPage({ searchParams: Promise.resolve({ spaceId: SPACE_VICTIME }) })
    ).rejects.toThrowError("NEXT_REDIRECT");
    // La redirection ne porte JAMAIS l'espace refusé : elle repart de la liste
    // autoritative des espaces accessibles.
    expect(h.redirect).toHaveBeenCalledWith(
      "/bases/space-legitime?spaceId=space-legitime"
    );
  });

  it("ignore un cookie du dernier espace hors des espaces accessibles", async () => {
    h.lastSpaceCookie = "space-victime";
    await expect(BasesIndexPage({ searchParams: Promise.resolve({}) })).rejects.toThrowError(
      "NEXT_REDIRECT"
    );
    expect(h.redirect).toHaveBeenCalledWith("/bases/space-legitime?spaceId=space-legitime");
  });

  it("suit le cookie du dernier espace quand il est accessible", async () => {
    h.getAccessibleSpaceIds.mockResolvedValue(["space-legitime", "space-autre"]);
    h.rows = [{ id: "space-legitime" }, { id: "space-autre" }];
    h.lastSpaceCookie = "space-autre";
    await expect(BasesIndexPage({ searchParams: Promise.resolve({}) })).rejects.toThrowError(
      "NEXT_REDIRECT"
    );
    expect(h.redirect).toHaveBeenCalledWith("/bases/space-legitime?spaceId=space-autre");
  });
});
