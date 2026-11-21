import { describe, it, expect, vi, beforeEach } from "vitest";

type MockDb = {
  select: ReturnType<typeof vi.fn>;
  from: ReturnType<typeof vi.fn>;
  where: ReturnType<typeof vi.fn>;
  limit: ReturnType<typeof vi.fn>;
};

vi.mock("@/lib/db", () => ({
  db: {
    select: vi.fn().mockReturnThis(),
    from: vi.fn().mockReturnThis(),
    where: vi.fn().mockReturnThis(),
    limit: vi.fn(),
  },
}));

import {
  instantiateDesignTemplate,
  DesignTemplateNotFoundError,
} from "@/lib/studio/instantiate-design-template";
import { db } from "@/lib/db";

const mockDb = db as unknown as MockDb;

/** Fabrique une ligne `design_templates` de test. */
function makeRow(overrides: Record<string, unknown> = {}) {
  return {
    id: "tpl-1",
    name: "Affiche promo",
    content: {
      version: 2,
      title: "Affiche promo",
      pages: [
        {
          id: "p1",
          name: "Page 1",
          format: "A4",
          bgColor: "#ffffff",
          thumbnail: null,
          json: {
            background: "#ffffff",
            objects: [
              { type: "i-text", text: "Titre par défaut", layerId: "layer-title" },
              {
                type: "group",
                objects: [
                  { type: "Textbox", text: "Sous-titre par défaut", layerId: "layer-sub" },
                  { type: "rect" },
                ],
              },
              { type: "i-text", text: "Sans variable" },
            ],
          },
        },
      ],
    },
    variables: [
      { key: "title", label: "Titre", layerId: "layer-title" },
      { key: "subtitle", label: "Sous-titre", layerId: "layer-sub" },
    ],
    isGlobal: false,
    spaceId: "space-a",
    ...overrides,
  };
}

/** Configure la DB mock pour retourner `row` (ou rien si null). */
function resolveWith(row: unknown) {
  mockDb.limit.mockResolvedValueOnce(row == null ? [] : [row]);
}

describe("instantiateDesignTemplate", () => {
  beforeEach(() => vi.clearAllMocks());

  it("substitue un calque texte top-level par son layerId", async () => {
    resolveWith(makeRow());
    const { name, design } = await instantiateDesignTemplate(
      "tpl-1",
      { title: "Soldes d'été" },
      { spaceId: "space-a" }
    );
    expect(name).toBe("Affiche promo");
    const objects = (design.pages[0].json as { objects: { layerId?: string; text?: string }[] }).objects;
    const title = objects.find((o) => o.layerId === "layer-title");
    expect(title?.text).toBe("Soldes d'été");
  });

  it("substitue un calque texte imbriqué dans un groupe", async () => {
    resolveWith(makeRow());
    const { design } = await instantiateDesignTemplate(
      "tpl-1",
      { subtitle: "-50% ce week-end" },
      { spaceId: "space-a" }
    );
    const objects = (design.pages[0].json as { objects: { type?: string; objects?: { layerId?: string; text?: string }[] }[] }).objects;
    const group = objects.find((o) => o.type === "group");
    const sub = group?.objects?.find((o) => o.layerId === "layer-sub");
    expect(sub?.text).toBe("-50% ce week-end");
  });

  it("cloisonnement : un template non-global d'un autre espace est introuvable", async () => {
    resolveWith(makeRow({ isGlobal: false, spaceId: "space-a" }));
    await expect(
      instantiateDesignTemplate("tpl-1", { title: "X" }, { spaceId: "space-b" })
    ).rejects.toBeInstanceOf(DesignTemplateNotFoundError);
  });

  it("cloisonnement : un template non-global SANS spaceId fourni est introuvable", async () => {
    // Sans opts.spaceId, un template d'espace ne doit jamais être instancié
    // (undefined ≠ spaceId), même si son UUID est connu.
    resolveWith(makeRow({ isGlobal: false, spaceId: "space-a" }));
    await expect(
      instantiateDesignTemplate("tpl-1", { title: "X" })
    ).rejects.toBeInstanceOf(DesignTemplateNotFoundError);
  });

  it("un template global est instanciable depuis n'importe quel espace", async () => {
    resolveWith(makeRow({ isGlobal: true, spaceId: null }));
    const { design } = await instantiateDesignTemplate(
      "tpl-1",
      { title: "Depuis ailleurs" },
      { spaceId: "space-z" }
    );
    const objects = (design.pages[0].json as { objects: { layerId?: string; text?: string }[] }).objects;
    expect(objects.find((o) => o.layerId === "layer-title")?.text).toBe("Depuis ailleurs");
  });

  it("laisse le texte par défaut quand aucune valeur n'est fournie pour la clé", async () => {
    resolveWith(makeRow());
    const { design } = await instantiateDesignTemplate("tpl-1", {}, { spaceId: "space-a" });
    const objects = (design.pages[0].json as { objects: { layerId?: string; text?: string }[] }).objects;
    expect(objects.find((o) => o.layerId === "layer-title")?.text).toBe("Titre par défaut");
  });

  it("lève DesignTemplateNotFoundError quand le template n'existe pas", async () => {
    resolveWith(null);
    await expect(
      instantiateDesignTemplate("absent", { title: "X" })
    ).rejects.toBeInstanceOf(DesignTemplateNotFoundError);
  });

  it("ne mute pas l'objet content source (immutabilité)", async () => {
    const row = makeRow();
    resolveWith(row);
    await instantiateDesignTemplate("tpl-1", { title: "Muté ?" }, { spaceId: "space-a" });
    const sourceObjects = (
      row.content.pages[0].json as { objects: { layerId?: string; text?: string }[] }
    ).objects;
    expect(sourceObjects.find((o) => o.layerId === "layer-title")?.text).toBe("Titre par défaut");
  });

  it("ignore une page vide (json null) sans planter", async () => {
    const row = makeRow();
    row.content.pages.push({
      id: "p2",
      name: "Page vide",
      format: "A4",
      bgColor: "#fff",
      thumbnail: null,
      json: null,
    } as unknown as (typeof row.content.pages)[number]);
    resolveWith(row);
    const { design } = await instantiateDesignTemplate(
      "tpl-1",
      { title: "OK" },
      { spaceId: "space-a" }
    );
    expect(design.pages[1].json).toBeNull();
  });
});
