import { describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  enforce: vi.fn(),
  transaction: vi.fn(),
  history: [] as { rowId: string; changes: { columnId: string; before: unknown }[] }[],
}));
vi.mock("@/lib/db", () => ({
  db: {
    transaction: h.transaction,
    select: () => ({ from: () => ({ where: () => ({ orderBy: async () => h.history }) }) }),
  },
}));
vi.mock("../row-writes", () => ({ enforceMediaGuard: h.enforce }));

import { restoreDatabaseRows } from "../row-batch";

const ID1 = "11111111-1111-4111-8111-111111111111";
const ID2 = "22222222-2222-4222-8222-222222222222";

describe("restoreDatabaseRows : garde de médias", () => {
  it("contrôle les cellules de chaque ligne avant toute transaction", async () => {
    h.enforce.mockImplementation(async (_d: string, cells: Record<string, unknown>) => {
      if (cells.bad) throw new Error("refus");
    });
    const ctx = { source: "restore" as const, mediaGuard: { user: null, orgId: "o" } };
    await expect(
      restoreDatabaseRows(
        "d",
        [
          { id: ID1, cells: { ok: 1 }, position: 0 },
          { id: ID2, cells: { bad: "/api/media/x" }, position: 1 },
        ],
        undefined,
        {},
        ctx
      )
    ).rejects.toThrow("refus");
    expect(h.enforce).toHaveBeenCalledTimes(2);
    expect(h.transaction).not.toHaveBeenCalled();
  });

  it("transmet en référence les cellules de la ligne supprimée (historique)", async () => {
    h.enforce.mockReset();
    h.history = [{ rowId: ID1, changes: [{ columnId: "col", before: [{ mediaId: "m" }] }] }];
    const ctx = { source: "restore" as const, mediaGuard: { user: null, orgId: "o" } };
    await restoreDatabaseRows("d", [{ id: ID1, cells: { col: [{ mediaId: "m" }] }, position: 0 }], undefined, {}, ctx).catch(
      () => undefined
    );
    expect(h.enforce).toHaveBeenCalledWith("d", { col: [{ mediaId: "m" }] }, ctx, { col: [{ mediaId: "m" }] });
  });
});
