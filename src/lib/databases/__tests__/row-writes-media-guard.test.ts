import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  transaction: vi.fn(),
  assert: vi.fn(),
  serialized: [] as string[],
}));

vi.mock("@/lib/db", () => ({ db: { transaction: h.transaction } }));
vi.mock("../attachment-cell-guard", () => ({
  assertMediaCells: h.assert,
  MediaCellError: class extends Error {
    status = 400;
  },
}));

import { createDatabaseRow, mergeDatabaseRowCells, fillEmptyRowCells } from "../row-writes";
import { serializeRowChangeContext } from "../row-change-context";

const guard = { user: { id: "u1" } as never, orgId: "o1" };
const ctx = { source: "ui" as const, mediaGuard: guard };

beforeEach(() => {
  h.transaction.mockReset();
  h.assert.mockReset();
});

describe("garde de médias au niveau commun des écritures de lignes", () => {
  it("createDatabaseRow : le refus du garde empêche toute transaction", async () => {
    h.assert.mockRejectedValue(new Error("refus"));
    await expect(createDatabaseRow("d", { c: "/api/media/x" }, undefined, ctx)).rejects.toThrow("refus");
    expect(h.assert).toHaveBeenCalledWith("d", { c: "/api/media/x" }, guard, undefined);
    expect(h.transaction).not.toHaveBeenCalled();
  });

  it("mergeDatabaseRowCells : idem", async () => {
    h.assert.mockRejectedValue(new Error("refus"));
    await expect(mergeDatabaseRowCells("d", "r", { c: [] }, {}, undefined, ctx)).rejects.toThrow("refus");
    expect(h.transaction).not.toHaveBeenCalled();
  });

  it("fillEmptyRowCells : idem", async () => {
    h.assert.mockRejectedValue(new Error("refus"));
    await expect(fillEmptyRowCells("d", "r", { c: [] }, {}, undefined, ctx)).rejects.toThrow("refus");
    expect(h.transaction).not.toHaveBeenCalled();
  });

  it("sans garde dans le contexte : aucun contrôle", async () => {
    h.transaction.mockResolvedValue(undefined);
    await mergeDatabaseRowCells("d", "r", { c: 1 }, {}, undefined, { source: "ui" });
    expect(h.assert).not.toHaveBeenCalled();
  });

  it("le garde n'est jamais sérialisé dans le contexte d'historique", () => {
    const json = serializeRowChangeContext(ctx);
    expect(json).not.toContain("mediaGuard");
    expect(json).not.toContain("u1");
  });
});
