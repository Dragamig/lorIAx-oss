import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  results: [] as Array<Array<Record<string, unknown>>>,
  edit: vi.fn(async () => true),
}));
vi.mock("@/lib/db", () => ({
  db: {
    select: () => ({
      from: () => ({ where: () => ({ limit: () => Promise.resolve(h.results.shift() ?? []) }) }),
    }),
  },
}));
vi.mock("@/lib/auth/check-access", () => ({
  checkDocumentViewAccess: vi.fn(),
  checkDocumentEditAccess: h.edit,
}));

import { checkCanvasEditAccess } from "./canvas-access";

const user = { id: "u1" } as never;
const DOC = "44444444-4444-4444-8444-444444444444";
const RES = "22222222-2222-4222-8222-222222222222";

beforeEach(() => {
  h.results = [];
  h.edit.mockClear();
  h.edit.mockResolvedValue(true);
});

describe("checkCanvasEditAccess : création sans ligne", () => {
  it("sans requireMention, le document annoncé suffit (comportement historique des routes de sauvegarde)", async () => {
    h.results = [[{ spaceId: "s1" }]];
    const r = await checkCanvasEditAccess(user, RES, { rowExists: false, storedDocumentId: null, requestedDocumentId: DOC });
    expect(r).toEqual({ ok: true, documentId: DOC });
  });

  it("requireMention : refus fermé si le document ne mentionne pas la cible", async () => {
    h.results = [[{ spaceId: "s1" }], []];
    const r = await checkCanvasEditAccess(user, RES, {
      rowExists: false,
      storedDocumentId: null,
      requestedDocumentId: DOC,
      requireMention: true,
    });
    expect(r).toEqual({ ok: false, status: 403 });
  });

  it("requireMention : accepté si le document mentionne la cible", async () => {
    h.results = [[{ spaceId: "s1" }], [{ id: DOC }]];
    const r = await checkCanvasEditAccess(user, RES, {
      rowExists: false,
      storedDocumentId: null,
      requestedDocumentId: DOC,
      requireMention: true,
    });
    expect(r).toEqual({ ok: true, documentId: DOC });
  });
});
