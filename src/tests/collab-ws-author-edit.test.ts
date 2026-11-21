/**
 * Écriture Yjs : la permission d'espace prime sur la qualité d'auteur.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const state = vi.hoisted(() => ({ rows: [] as unknown[][], call: 0 }));

vi.mock("@/lib/db", () => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const self: any = {
    select: vi.fn(() => {
      state.call += 1;
      return self;
    }),
    from: vi.fn(() => self),
    innerJoin: vi.fn(() => self),
    where: vi.fn(() => self),
    limit: vi.fn(() => Promise.resolve(state.rows[state.call - 1] ?? [])),
  };
  return { db: self };
});
vi.mock("jose", () => ({ jwtVerify: vi.fn() }));

import { checkCollabDocumentEditAccess } from "@/lib/collab/auth-ws";

// Séquence de requêtes : utilisateur, document, permission d'espace
const setup = (level: string | null) => {
  state.call = 0;
  state.rows = [
    [{ globalRole: "member" }],
    [{ spaceId: "s1", createdBy: "author", organizationId: "org-a" }],
    level ? [{ level }] : [],
  ];
};

beforeEach(() => {
  state.rows = [];
  state.call = 0;
});

describe("checkCollabDocumentEditAccess : auteur et permission d'espace", () => {
  it("refuse l'écriture à l'auteur rétrogradé viewer", async () => {
    setup("viewer");
    await expect(checkCollabDocumentEditAccess("author", "d1", "org-a")).resolves.toBe(false);
  });

  it("refuse l'écriture à l'auteur sans permission d'espace", async () => {
    setup(null);
    await expect(checkCollabDocumentEditAccess("author", "d1", "org-a")).resolves.toBe(false);
  });

  it("accepte l'auteur editor", async () => {
    setup("editor");
    await expect(checkCollabDocumentEditAccess("author", "d1", "org-a")).resolves.toBe(true);
  });
});
