import { describe, it, expect, vi, beforeEach } from "vitest";

const h = vi.hoisted(() => ({
  forMedia: vi.fn(),
  resolve: vi.fn(),
  existing: vi.fn(),
  insert: vi.fn(),
  del: vi.fn(),
  touch: vi.fn(),
}));
vi.mock("@/lib/db", () => ({
  db: {
    select: () => ({ from: () => ({ where: () => Promise.resolve(h.existing()) }) }),
    insert: () => ({
      values: (v: unknown) => ({ onConflictDoNothing: () => Promise.resolve(h.insert(v)) }),
    }),
    delete: () => ({ where: () => Promise.resolve(h.del()) }),
    update: () => ({ set: () => ({ where: () => Promise.resolve(h.touch()) }) }),
  },
}));
vi.mock("@/lib/media/access", () => ({
  getMediaForAccess: h.forMedia,
  resolveMediaAccess: h.resolve,
}));

import { setExplicitUsages } from "./explicit-usages";

const U = { id: "u1" } as never;
const ORG = "org1";
const M1 = "11111111-1111-4111-8111-111111111111";
const M2 = "22222222-2222-4222-8222-222222222222";
const M3 = "33333333-3333-4333-8333-333333333333";
const input = (mediaIds: string[]) => ({
  user: U,
  orgId: ORG,
  targetType: "design" as const,
  targetId: "44444444-4444-4444-8444-444444444444",
  context: null,
  spaceId: "s1",
  mediaIds,
});

beforeEach(() => {
  vi.clearAllMocks();
  h.existing.mockReturnValue([]);
  h.forMedia.mockImplementation((id: string) => Promise.resolve({ id, organizationId: ORG }));
  h.resolve.mockResolvedValue({ allowed: true });
});

describe("setExplicitUsages", () => {
  it("ajoute les nouveaux et retire les absents (lignes explicit seulement)", async () => {
    h.existing.mockReturnValue([{ id: "row-m2", mediaId: M2 }]);
    const r = await setExplicitUsages(input([M1]));
    expect(r).toEqual({ added: 1, removed: 1, ignored: 0 });
    expect(h.insert).toHaveBeenCalledTimes(1);
    const values = h.insert.mock.calls[0][0] as { mediaId: string; source: string; targetType: string }[];
    expect(values).toEqual([expect.objectContaining({ mediaId: M1, source: "explicit", targetType: "design" })]);
    expect(h.del).toHaveBeenCalledTimes(1);
  });

  it("ignore un média d'une autre organisation", async () => {
    h.forMedia.mockResolvedValue({ id: M1, organizationId: "autre" });
    const r = await setExplicitUsages(input([M1]));
    expect(r).toEqual({ added: 0, removed: 0, ignored: 1 });
    expect(h.insert).not.toHaveBeenCalled();
  });

  it("ignore un média inexistant ou que l'utilisateur ne peut pas lire", async () => {
    h.forMedia.mockImplementation((id: string) =>
      Promise.resolve(id === M3 ? null : { id, organizationId: ORG }));
    h.resolve.mockImplementation((_u, row: { id: string }) =>
      Promise.resolve({ allowed: row.id !== M2 }));
    const r = await setExplicitUsages(input([M1, M2, M3]));
    expect(r).toEqual({ added: 1, removed: 0, ignored: 2 });
  });

  it("idempotent : second appel identique sans écriture", async () => {
    h.existing.mockReturnValue([{ id: "row-m1", mediaId: M1 }]);
    const r = await setExplicitUsages(input([M1, M1.toUpperCase()]));
    expect(r).toEqual({ added: 0, removed: 0, ignored: 0 });
    expect(h.insert).not.toHaveBeenCalled();
    expect(h.del).not.toHaveBeenCalled();
  });

  it("ensemble vide : retire tout", async () => {
    h.existing.mockReturnValue([{ id: "a", mediaId: M1 }, { id: "b", mediaId: M2 }]);
    expect(await setExplicitUsages(input([]))).toEqual({ added: 0, removed: 2, ignored: 0 });
  });
});
