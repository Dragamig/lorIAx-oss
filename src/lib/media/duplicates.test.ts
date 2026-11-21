import { describe, expect, it, vi, beforeEach } from "vitest";

const h = vi.hoisted(() => ({
  rows: [] as unknown[],
  visible: vi.fn(),
  where: vi.fn(),
}));

vi.mock("@/lib/db", () => {
  const chain: Record<string, unknown> = {};
  chain.from = () => chain;
  chain.leftJoin = () => chain;
  chain.where = (c: unknown) => {
    h.where(c);
    return chain;
  };
  chain.orderBy = () => Promise.resolve(h.rows);
  return { db: { select: () => chain } };
});
vi.mock("@/lib/media/list", () => ({ visibleMediaCondition: h.visible }));

import { findDuplicates } from "./duplicates";

const user = { id: "u1" } as never;
const A = "a".repeat(64);
const B = "b".repeat(64);

beforeEach(() => {
  vi.clearAllMocks();
  h.visible.mockResolvedValue({ marker: "visible" });
  h.rows = [];
});

describe("findDuplicates", () => {
  it("n'interroge que les médias visibles hors corbeille (scope live)", async () => {
    await findDuplicates(user, "org1", [A]);
    expect(h.visible).toHaveBeenCalledWith(user, "org1", "live");
    expect(h.where).toHaveBeenCalledTimes(1);
  });

  it("aucune somme : liste vide sans requête", async () => {
    expect(await findDuplicates(user, "org1", [])).toEqual({});
    expect(h.visible).not.toHaveBeenCalled();
  });

  it("deux médias de même somme : le plus récent (premier de la liste triée)", async () => {
    h.rows = [
      { id: "new", filename: "n.png", checksum: A, thumbnailKey: "k", spaceName: "Marketing" },
      { id: "old", filename: "o.png", checksum: A, thumbnailKey: null, spaceName: null },
      { id: "b1", filename: "b.png", checksum: B, thumbnailKey: null, spaceName: null },
    ];
    const r = await findDuplicates(user, "org1", [A, B, A]);
    expect(r[A]).toEqual({
      id: "new",
      filename: "n.png",
      spaceName: "Marketing",
      thumbnailUrl: "/api/media/new/thumbnail",
    });
    expect(r[B].thumbnailUrl).toBeNull();
    expect(Object.keys(r)).toHaveLength(2);
  });

  it("somme sans média visible : absente de la réponse", async () => {
    h.rows = [];
    expect(await findDuplicates(user, "org1", [A])).toEqual({});
  });
});
