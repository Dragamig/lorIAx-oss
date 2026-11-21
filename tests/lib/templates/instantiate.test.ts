import { describe, it, expect, vi, beforeEach } from "vitest";

// ─── Mock DB pour la branche « template en base » ────────────────────────────
const h = vi.hoisted(() => ({
  rows: [] as unknown[],
}));

vi.mock("@/lib/db", () => ({
  db: {
    select: vi.fn(() => ({
      from: vi.fn().mockReturnThis(),
      where: vi.fn().mockReturnThis(),
      limit: vi.fn().mockResolvedValue(h.rows),
    })),
  },
}));

import {
  instantiateTemplate,
  TemplateNotFoundError,
} from "@/lib/templates/instantiate";

beforeEach(() => {
  h.rows = [];
  vi.clearAllMocks();
});

describe("instantiateTemplate — builtins", () => {
  it("instancie un builtin connu et renvoie nom + markdown", async () => {
    const out = await instantiateTemplate("builtin_compte-rendu-reunion", {});
    expect(out.name).toBe("Compte-rendu de réunion");
    expect(out.markdown).toContain("Compte-rendu");
  });

  it("lève TemplateNotFoundError pour un builtin inconnu", async () => {
    await expect(instantiateTemplate("builtin_inexistant", {})).rejects.toBeInstanceOf(
      TemplateNotFoundError
    );
  });
});

describe("instantiateTemplate — base de données", () => {
  it("interpole le markdown du template avec le contexte", async () => {
    h.rows = [
      {
        id: "tpl-1",
        name: "Note perso",
        isGlobal: true,
        spaceId: null,
        content: { markdown: "# Note de {{user.name}}" },
      },
    ];
    const out = await instantiateTemplate("tpl-1", {
      user: { name: "Carla" },
    });
    expect(out.name).toBe("Note perso");
    expect(out.markdown).toBe("# Note de Carla");
  });

  it("lève TemplateNotFoundError si le template est absent en base", async () => {
    h.rows = [];
    await expect(instantiateTemplate("tpl-absent", {})).rejects.toBeInstanceOf(
      TemplateNotFoundError
    );
  });

  it("siloing : refuse un template non-global hors de son espace", async () => {
    h.rows = [
      {
        id: "tpl-2",
        name: "Privé",
        isGlobal: false,
        spaceId: "space-A",
        content: { markdown: "x" },
      },
    ];
    await expect(
      instantiateTemplate("tpl-2", {}, { spaceId: "space-B" })
    ).rejects.toBeInstanceOf(TemplateNotFoundError);
  });

  it("siloing : autorise un template non-global depuis son propre espace", async () => {
    h.rows = [
      {
        id: "tpl-3",
        name: "Privé OK",
        isGlobal: false,
        spaceId: "space-A",
        content: { markdown: "ok" },
      },
    ];
    const out = await instantiateTemplate("tpl-3", {}, { spaceId: "space-A" });
    expect(out.name).toBe("Privé OK");
  });
});
