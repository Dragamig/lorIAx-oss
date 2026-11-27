import { describe, it, expect, vi, beforeEach } from "vitest";

const h = vi.hoisted(() => ({
  types: {} as Record<string, string>,
  rowsByDb: {} as Record<string, { id: string; cells: Record<string, unknown>; position: number }[]>,
}));

vi.mock("@/lib/databases/row-writes", () => ({ loadColumnTypes: async () => h.types }));
// Reproduit le filtre par base de la vraie requête : une ligne d'une autre base n'est jamais rendue.
vi.mock("@/lib/ai/chat-tools/rows-loader", () => ({
  loadRowsByIds: async (databaseId: string, ids: string[]) =>
    (h.rowsByDb[databaseId] ?? []).filter((r) => ids.includes(r.id)),
}));

import { planUpdateRows } from "../plan-update";
import { planDeleteRows } from "../plan-delete";
import { planCreateRows } from "../plan-create";
import { computeFingerprint } from "../freshness";

const DB = "db-1";

beforeEach(() => {
  h.types = { t: "text", n: "number", f: "formula", a: "autonumber", att: "attachment", img: "image", rel: "relation" };
  h.rowsByDb = {
    [DB]: [
      { id: "r1", cells: { t: "ancien", n: 1 }, position: 0 },
      { id: "r2", cells: { t: "autre" }, position: 1 },
    ],
    "db-other": [{ id: "foreign", cells: { t: "secret" }, position: 0 }],
  };
});

describe("planUpdateRows", () => {
  it("produit before/after exacts, résumé et empreinte", async () => {
    const plan = await planUpdateRows(DB, [{ rowId: "r1", cells: { t: "nouveau", n: 5 } }]);
    expect(plan.payload).toEqual({
      type: "update_rows",
      changes: [{ rowId: "r1", before: { t: "ancien", n: 1 }, after: { t: "nouveau", n: 5 } }],
    });
    expect(plan.rowCount).toBe(1);
    expect(plan.summary).toBe("Mettre à jour 1 ligne");
    expect(plan.freshness.rows).toEqual(computeFingerprint([h.rowsByDb[DB][0]]));
  });

  it("before vaut null pour une cellule absente", async () => {
    const plan = await planUpdateRows(DB, [{ rowId: "r2", cells: { n: 3 } }]);
    expect(plan.payload).toMatchObject({ changes: [{ before: { n: null } }] });
  });

  it("rowId d'une autre base : unknown_row, sans fuite", async () => {
    await expect(planUpdateRows(DB, [{ rowId: "foreign", cells: { t: "x" } }])).rejects.toMatchObject({
      name: "ProposalPlanError",
      code: "unknown_row",
      message: expect.not.stringContaining("secret"),
    });
  });

  it("rowId inexistant : même message que pour une autre base", async () => {
    const a = await planUpdateRows(DB, [{ rowId: "foreign", cells: { t: "x" } }]).catch((e) => e);
    const b = await planUpdateRows(DB, [{ rowId: "nope", cells: { t: "x" } }]).catch((e) => e);
    expect(a.message).toBe(b.message);
  });

  it("colonne inconnue : invalid_cells", async () => {
    await expect(planUpdateRows(DB, [{ rowId: "r1", cells: { zzz: 1 } }])).rejects.toMatchObject({ code: "invalid_cells" });
  });

  it.each(["f", "a", "att", "img", "rel"])("colonne de type non écrivable (%s) : invalid_cells", async (col) => {
    await expect(planUpdateRows(DB, [{ rowId: "r1", cells: { [col]: "x" } }])).rejects.toMatchObject({
      code: "invalid_cells",
    });
  });

  it("101 lignes : too_many_rows", async () => {
    const mods = Array.from({ length: 101 }, (_, i) => ({ rowId: `r${i}`, cells: { t: "x" } }));
    await expect(planUpdateRows(DB, mods)).rejects.toMatchObject({ code: "too_many_rows" });
  });

  it("liste vide : empty", async () => {
    await expect(planUpdateRows(DB, [])).rejects.toMatchObject({ code: "empty" });
  });
});

describe("planDeleteRows", () => {
  it("snapshotte cells et position", async () => {
    const plan = await planDeleteRows(DB, ["r2", "r1"]);
    expect(plan.payload).toEqual({
      type: "delete_rows",
      rows: [
        { id: "r2", cells: { t: "autre" }, position: 1 },
        { id: "r1", cells: { t: "ancien", n: 1 }, position: 0 },
      ],
    });
    expect(plan.rowCount).toBe(2);
    expect(plan.freshness.rows).toHaveLength(2);
  });

  it("rowId d'une autre base : unknown_row", async () => {
    await expect(planDeleteRows(DB, ["r1", "foreign"])).rejects.toMatchObject({ code: "unknown_row" });
  });

  it("vide et plafond", async () => {
    await expect(planDeleteRows(DB, [])).rejects.toMatchObject({ code: "empty" });
    await expect(planDeleteRows(DB, Array.from({ length: 101 }, (_, i) => `r${i}`))).rejects.toMatchObject({
      code: "too_many_rows",
    });
  });
});

describe("planCreateRows", () => {
  it("valide et renvoie freshness.rows vide", async () => {
    const plan = await planCreateRows(DB, [{ cells: { t: "a" } }, { cells: { n: 2 } }]);
    expect(plan.payload).toEqual({ type: "create_rows", rows: [{ cells: { t: "a" } }, { cells: { n: 2 } }] });
    expect(plan.freshness.rows).toEqual([]);
    expect(plan.summary).toBe("Créer 2 lignes");
  });

  it("colonne inconnue, formule, attachment, vide, plafond", async () => {
    await expect(planCreateRows(DB, [{ cells: { zzz: 1 } }])).rejects.toMatchObject({ code: "invalid_cells" });
    await expect(planCreateRows(DB, [{ cells: { f: 1 } }])).rejects.toMatchObject({ code: "invalid_cells" });
    await expect(planCreateRows(DB, [{ cells: { att: [] } }])).rejects.toMatchObject({ code: "invalid_cells" });
    await expect(planCreateRows(DB, [])).rejects.toMatchObject({ code: "empty" });
    await expect(planCreateRows(DB, Array.from({ length: 101 }, () => ({ cells: {} })))).rejects.toMatchObject({
      code: "too_many_rows",
    });
  });
});
