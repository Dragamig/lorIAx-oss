/**
 * Page `presentations/[id]` face à un modèle (lot 3bis, T11) : mêmes règles que
 * la branche modèle du GET de l'API.
 *
 * Preuves par mutation (retrait temporaire, test rouge, restauration, vert) :
 *   - `row.organizationId !== orgId` retiré de la page : « autre organisation »
 *     échoue (le modèle est rendu) ;
 *   - `row.templateHiddenAt && !isAdmin` retiré : « modèle masqué, membre »
 *     échoue ;
 *   - `row.isTemplate && !isAdmin` retiré de la page : « membre : aperçu sans moteur » échoue
 *     (le moteur serait servi à un membre).
 */
import { describe, it, expect, beforeEach, vi } from "vitest";

const h = vi.hoisted(() => {
  class OrgScopeError extends Error {
    constructor(
      public readonly response: unknown,
      public readonly reason: string
    ) {
      super(reason);
    }
  }
  return {
    OrgScopeError,
    row: vi.fn(),
    spaces: vi.fn(),
    user: vi.fn(),
    requireOrgScoped: vi.fn(),
    readTemplateDeck: vi.fn(),
    getFileJson: vi.fn(),
    getAccessibleSpaceIds: vi.fn(),
    rights: vi.fn(),
  };
});

vi.mock("next/navigation", () => ({
  notFound: () => {
    throw new Error("NEXT_NOT_FOUND");
  },
  redirect: (to: string) => {
    throw new Error(`NEXT_REDIRECT:${to}`);
  },
}));
vi.mock("@/lib/presentations/template-access", async () => {
  const actual = await vi.importActual<typeof import("@/lib/presentations/template-access")>(
    "@/lib/presentations/template-access"
  );
  return { ...actual, resolveTemplateRights: async () => h.rights() };
});
vi.mock("@/lib/presentations/guards", () => ({ isPresentationsModuleActive: async () => true }));
vi.mock("@/lib/db", () => ({
  db: {
    select: () => ({
      from: () => ({
        where: () => Object.assign(Promise.resolve(h.row()), { orderBy: async () => h.spaces() }),
      }),
    }),
  },
}));
vi.mock("@/lib/db/schema", () => ({ presentations: { id: "id" }, spaces: { id: "id", name: "name" } }));
vi.mock("drizzle-orm", async () => ({
  ...(await vi.importActual<typeof import("drizzle-orm")>("drizzle-orm")),
  eq: () => ({}),
  asc: () => ({}),
  inArray: () => ({}),
}));
vi.mock("@/lib/auth/get-user", () => ({ getSessionUser: async () => h.user() }));
vi.mock("@/lib/auth/check-access", () => ({ getAccessibleSpaceIds: h.getAccessibleSpaceIds }));
vi.mock("@/lib/auth/require-org-scoped", () => ({
  requireOrgScoped: h.requireOrgScoped,
  OrgScopeError: h.OrgScopeError,
}));
vi.mock("@/lib/storage/s3", () => ({ getFileJson: h.getFileJson }));
vi.mock("@/lib/presentations/templates", () => ({ readTemplateDeck: h.readTemplateDeck }));
vi.mock("@/components/presentations/presentation-editor", () => ({
  PresentationEditor: () => null,
}));
vi.mock("@/components/presentations/presentation-readonly-view", () => ({
  PresentationReadOnlyView: () => null,
}));
vi.mock("@/components/presentations/templates/template-readonly-view", () => ({
  TemplateReadOnlyView: () => null,
}));

import PresentationPage from "@/app/[locale]/(app)/presentations/[id]/page";

const ID = "0b1f6e0e-3c1c-4d6e-9a3a-5b8f2a1c7d10";
const DECK = { format: "bento/slides", version: 1, slides: [{ id: "s" }] };
const TEMPLATE = {
  id: "t1",
  title: "Modèle",
  version: 5,
  spaceId: null,
  isTemplate: true,
  organizationId: "org-1",
  templateHiddenAt: null,
  templateOrigin: null,
  templateSeedKey: null,
  templateDescription: null,
  slideCount: 1,
  updatedAt: new Date("2026-11-01T00:00:00Z"),
};
const ORDINARY = { ...TEMPLATE, id: "p1", spaceId: "s-1", isTemplate: false, organizationId: null };

const MEMBER = { id: "u1", globalRole: "member" };
const ADMIN = { id: "u2", globalRole: "admin" };

async function render(): Promise<{ props: Record<string, unknown>; view: string }> {
  const out = (await PresentationPage({ params: Promise.resolve({ id: ID, locale: "fr" }) })) as {
    props: { children: { props: Record<string, unknown>; type: { name: string } } };
  };
  return { props: out.props.children.props, view: out.props.children.type.name };
}

beforeEach(() => {
  vi.clearAllMocks();
  h.user.mockReturnValue(MEMBER);
  h.rights.mockReturnValue({ isMember: true, canManage: false });
  h.requireOrgScoped.mockResolvedValue({ user: MEMBER, orgId: "org-1", orgSlug: "o" });
  h.readTemplateDeck.mockResolvedValue(DECK);
  h.getFileJson.mockResolvedValue(DECK);
  h.getAccessibleSpaceIds.mockResolvedValue(["s-1"]);
  h.row.mockReturnValue([TEMPLATE]);
  h.spaces.mockResolvedValue([{ id: "s-1", name: "Général" }]);
});

describe("modèle", () => {
  it("membre de l'organisation : aperçu sans moteur, espaces proposés, charge utile par readTemplateDeck", async () => {
    const { props, view } = await render();
    expect(view).toBe("TemplateReadOnlyView");
    expect(props).toMatchObject({ spaces: [{ id: "s-1", name: "Général" }] });
    expect((props.template as { id: string }).id).toBe("t1");
    expect(h.readTemplateDeck).toHaveBeenCalledOnce();
  });

  it("admin : éditeur avec isAdmin vrai", async () => {
    h.user.mockReturnValue(ADMIN);
    h.rights.mockReturnValue({ isMember: true, canManage: true });
    const { props, view } = await render();
    expect(view).toBe("PresentationEditor");
    expect(props).toMatchObject({ isAdmin: true, isTemplate: true, templateHidden: false });
  });

  it("autre organisation : 404, aucune lecture de la charge utile", async () => {
    h.row.mockReturnValue([{ ...TEMPLATE, organizationId: "org-2" }]);
    h.user.mockReturnValue(ADMIN);
    await expect(render()).rejects.toThrow("NEXT_NOT_FOUND");
    expect(h.readTemplateDeck).not.toHaveBeenCalled();
  });

  it("modèle masqué : 404 pour un membre", async () => {
    h.row.mockReturnValue([{ ...TEMPLATE, templateHiddenAt: new Date() }]);
    await expect(render()).rejects.toThrow("NEXT_NOT_FOUND");
    expect(h.readTemplateDeck).not.toHaveBeenCalled();
  });

  it("modèle masqué : visible de l'admin", async () => {
    h.row.mockReturnValue([{ ...TEMPLATE, templateHiddenAt: new Date() }]);
    h.user.mockReturnValue(ADMIN);
    h.rights.mockReturnValue({ isMember: true, canManage: true });
    const { props } = await render();
    expect(props).toMatchObject({ isTemplate: true, templateHidden: true });
  });

  it("non-membre : modèle d'organisation en 404, modèle LorIAx semé visible", async () => {
    h.rights.mockReturnValue({ isMember: false, canManage: false });
    await expect(render()).rejects.toThrow("NEXT_NOT_FOUND");
    h.row.mockReturnValue([{ ...TEMPLATE, templateSeedKey: "pitch" }]);
    const { view } = await render();
    expect(view).toBe("TemplateReadOnlyView");
  });

  it("admin global non membre : pas d'éditeur sur un modèle d'organisation", async () => {
    h.user.mockReturnValue(ADMIN);
    h.rights.mockReturnValue({ isMember: false, canManage: false });
    await expect(render()).rejects.toThrow("NEXT_NOT_FOUND");
  });

  it("identifiant non UUID : 404 sans requête", async () => {
    await expect(
      PresentationPage({ params: Promise.resolve({ id: "x", locale: "fr" }) })
    ).rejects.toThrow("NEXT_NOT_FOUND");
    expect(h.row).not.toHaveBeenCalled();
  });

  it("sans organisation courante : 404", async () => {
    h.requireOrgScoped.mockRejectedValue(new h.OrgScopeError({}, "no-org"));
    await expect(render()).rejects.toThrow("NEXT_NOT_FOUND");
  });
});

describe("présentation ordinaire", () => {
  beforeEach(() => h.row.mockReturnValue([ORDINARY]));

  it("espace accessible : rendue, charge utile lue sous sa clé", async () => {
    const { props } = await render();
    expect(props).toMatchObject({ isTemplate: false, spaceId: "s-1" });
    expect(h.getFileJson).toHaveBeenCalledWith("presentations/p1.json");
    expect(h.readTemplateDeck).not.toHaveBeenCalled();
  });

  it("espace non accessible : 404", async () => {
    h.getAccessibleSpaceIds.mockResolvedValue(["autre"]);
    await expect(render()).rejects.toThrow("NEXT_NOT_FOUND");
  });

  it("sans espace et sans modèle : 404", async () => {
    h.row.mockReturnValue([{ ...ORDINARY, spaceId: null }]);
    await expect(render()).rejects.toThrow("NEXT_NOT_FOUND");
  });

  it("lecteur de l'espace (pas de droit d'écriture) : vue en lecture seule, pas d'éditeur", async () => {
    h.requireOrgScoped.mockImplementation(async (opts?: { minPermission?: string }) => {
      if (opts?.minPermission === "editor") throw new h.OrgScopeError({}, "forbidden");
      return { user: MEMBER, orgId: "org-1", orgSlug: "o" };
    });
    const { props, view } = await render();
    expect(view).toBe("PresentationReadOnlyView");
    expect(props).toMatchObject({ title: "Modèle" });
    expect(h.requireOrgScoped).toHaveBeenCalledWith({
      resource: { type: "space", id: "s-1" },
      minPermission: "editor",
    });
  });

  it("éditeur de l'espace : éditeur complet", async () => {
    const { view } = await render();
    expect(view).toBe("PresentationEditor");
  });
});
