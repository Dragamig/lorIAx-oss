import { describe, it, expect, vi, beforeEach } from "vitest";

const h = vi.hoisted(() => ({
  types: {} as Record<string, string>,
  rows: [] as { id: string; cells: Record<string, unknown>; position: number }[],
  ts: {} as Record<string, number>,
  repoint: { repoints: [], holderRows: [] } as unknown,
}));

vi.mock("@/lib/databases/row-writes", () => ({ loadColumnTypes: async () => h.types }));
vi.mock("@/lib/ai/chat-tools/rows-loader", () => ({
  loadRowsWithGuard: async () => h.rows,
  loadRowTimestamps: async () => new Map(Object.entries(h.ts)),
}));
vi.mock("../merge-repoint", () => ({
  RepointLimitError: class extends Error {},
  scanUnidirectionalRepoints: async () => h.repoint,
}));

import { buildMergeWrites, planMergeDuplicates, resolveMergeChoices } from "../plan-merge";
import { findDuplicateGroups } from "@/lib/ai/chat-tools/duplicates";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type G = Record<string, any>;
type MP = Extract<import("../types").ProposalPayload, { type: "merge_duplicates" }>;
const KEY = ["k"];
function groupIdOf(rows: typeof h.rows): string {
  return findDuplicateGroups(rows, KEY)[0].groupId;
}

beforeEach(() => {
  h.types = { k: "text", t: "text", n: "number", att: "attachment", rel: "relation", f: "formula" };
  h.rows = [
    { id: "old", cells: { k: "Dupont", t: "ancien", n: 1 }, position: 0 },
    { id: "new", cells: { k: "dupont", t: "récent" }, position: 1 },
    { id: "solo", cells: { k: "autre" }, position: 2 },
  ];
  h.ts = { old: 1000, new: 2000, solo: 500 };
  h.repoint = { repoints: [], holderRows: [] };
});

describe("planMergeDuplicates", () => {
  it("parité avec find_duplicates : mêmes colonnes en conflit (ni autonumber, formule, relation, pièce jointe, supprimée)", async () => {
    h.types = { k: "text", t: "text", a: "autonumber", f: "formula", rel: "relation", att: "attachment" };
    h.rows = [
      { id: "r1", cells: { k: "x", t: "1", a: 1, f: "p", rel: ["u"], att: [{ mediaId: "m1" }], gone: "u" }, position: 0 },
      { id: "r2", cells: { k: "X", t: "2", a: 2, f: "q", rel: ["v"], att: [{ mediaId: "m2" }], gone: "v" }, position: 1 },
    ];
    h.ts = { r1: 1000, r2: 2000 };
    const plan = await planMergeDuplicates("db", KEY);
    const p = plan.payload as Extract<typeof plan.payload, { type: "merge_duplicates" }>;
    const found = findDuplicateGroups(h.rows, KEY, undefined, h.types);
    expect(p.groups[0].conflicts.map((c) => c.columnId)).toEqual(found[0].conflictColumnIds);
    expect(found[0].conflictColumnIds).toEqual(["t"]);
  });

  it("conserve la ligne la plus récente, complète les cellules vides, pré-tranche les conflits", async () => {
    const plan = await planMergeDuplicates("db", KEY);
    const p = plan.payload as Extract<typeof plan.payload, { type: "merge_duplicates" }>;
    const g = p.groups[0];
    expect(g.keepRowId).toBe("new");
    expect(g.removeRowIds).toEqual(["old"]);
    expect(g.mergedCells).toEqual({ n: 1 });
    expect(g.keepBefore).toEqual({ n: null });
    expect(g.conflicts).toEqual([
      {
        columnId: "t",
        chosenFrom: "new",
        candidates: [
          { rowId: "new", value: "récent" },
          { rowId: "old", value: "ancien" },
        ],
      },
    ]);
    expect(g.removedRows).toEqual([{ id: "old", cells: { k: "Dupont", t: "ancien", n: 1 }, position: 0 }]);
    expect(plan.rowCount).toBe(1);
    expect(plan.freshness.databaseRowCountForKey).toBe(2);
    expect(plan.freshness.rows.map((r) => r.id).sort()).toEqual(["new", "old"]);
  });

  it("départage une égalité d'updatedAt par la position la plus basse", async () => {
    h.ts = { old: 1000, new: 1000 };
    const p = (await planMergeDuplicates("db", KEY)).payload as { groups: { keepRowId: string }[] };
    expect(p.groups[0].keepRowId).toBe("old");
  });

  it("réunit les pièces jointes sans doublon de mediaId, plafonnées à 20", async () => {
    const mk = (i: number) => ({ mediaId: `m${i}`, filename: "f", mimeType: "x", size: 1 });
    h.rows = [
      { id: "old", cells: { k: "a", att: [mk(1), mk(2), mk(3)] }, position: 0 },
      { id: "new", cells: { k: "a", att: [mk(2), mk(4)] }, position: 1 },
    ];
    const g = ((await planMergeDuplicates("db", KEY)).payload as { groups: G[] }).groups[0];
    expect(g.mergedCells.att.map((a: { mediaId: string }) => a.mediaId)).toEqual(["m2", "m4", "m1", "m3"]);
    expect(g.repatriation.attachments).toBe(2);

    const many = Array.from({ length: 25 }, (_, i) => mk(100 + i));
    h.rows = [
      { id: "old", cells: { k: "a", att: many }, position: 0 },
      { id: "new", cells: { k: "a", att: [mk(1)] }, position: 1 },
    ];
    const g2 = ((await planMergeDuplicates("db", KEY)).payload as { groups: G[] }).groups[0];
    expect(g2.mergedCells.att).toHaveLength(20);
    expect(g2.repatriation.attachments).toBe(19);
  });

  it("réunit les relations vers la conservée et compte les cellules des lignes retirées", async () => {
    h.rows = [
      { id: "old", cells: { k: "a", rel: ["x", "new"] }, position: 0 },
      { id: "new", cells: { k: "a", rel: ["y"] }, position: 1 },
    ];
    const plan = await planMergeDuplicates("db", KEY);
    const g = (plan.payload as { groups: G[] }).groups[0];
    expect(g.mergedCells.rel).toBeUndefined();
    const w = buildMergeWrites(plan.payload as MP);
    expect(w.keeps[0].after.rel).toEqual(["y", "x", "new"]);
    expect(g.repatriation.relationCells).toBe(1);
    expect(g.conflicts).toEqual([]);
  });

  it("liste les relations unidirectionnelles repointées dans le groupe concerné", async () => {
    const r = { rowId: "ext", databaseId: "other", columnId: "c", before: ["old"] };
    h.repoint = { repoints: [r], holderRows: [{ id: "ext", cells: { c: ["old"] } }] };
    const plan = await planMergeDuplicates("db", KEY);
    const g = (plan.payload as { groups: G[] }).groups[0];
    expect(g.repatriation.repointed).toEqual([r]);
    expect(plan.freshness.rows.map((x) => x.id)).toContain("ext");
  });

  it("groupIds inconnu : unknown_row ; connu : accepté", async () => {
    await expect(planMergeDuplicates("db", KEY, ["deadbeef0000"])).rejects.toMatchObject({ code: "unknown_row" });
    const plan = await planMergeDuplicates("db", KEY, [groupIdOf(h.rows)]);
    expect(plan.rowCount).toBe(1);
  });

  it("colonne clé inconnue : unknown_column ; aucun doublon : empty", async () => {
    await expect(planMergeDuplicates("db", ["zzz"])).rejects.toMatchObject({ code: "unknown_column" });
    h.rows = [{ id: "a", cells: { k: "1" }, position: 0 }];
    await expect(planMergeDuplicates("db", KEY)).rejects.toMatchObject({ code: "empty" });
  });

  it("plus de 100 lignes touchées : too_many_rows", async () => {
    h.rows = Array.from({ length: 101 }, (_, i) => ({ id: `r${i}`, cells: { k: "same" }, position: i }));
    h.ts = {};
    await expect(planMergeDuplicates("db", KEY)).rejects.toMatchObject({ code: "too_many_rows" });
  });
});

describe("buildMergeWrites : groupes exclus", () => {
  // Deux groupes : g1 (a1 retirée, b1 conservée) et g2 (a2 retirée, b2 conservée) ; types : rel = relation.
  async function twoGroups() {
    h.types = { k: "text", rel: "relation" };
    h.rows = [
      { id: "a1", cells: { k: "one", rel: ["a2", "z"] }, position: 0 },
      { id: "b1", cells: { k: "one", rel: ["b2"] }, position: 1 },
      { id: "a2", cells: { k: "two" }, position: 2 },
      { id: "b2", cells: { k: "two" }, position: 3 },
      { id: "z", cells: { k: "zed" }, position: 4 },
    ];
    h.ts = { a1: 1, b1: 2, a2: 1, b2: 2 };
    h.repoint = {
      repoints: [
        { rowId: "ext", databaseId: "o", columnId: "c", before: ["a1", "a2"] },
        { rowId: "a2", databaseId: "db", columnId: "rel", before: ["a1"] },
      ],
      holderRows: [],
    };
    return (await planMergeDuplicates("db", KEY)).payload as MP;
  }

  it("tous retenus : relations réunies et repointées vers les conservées", async () => {
    const w = buildMergeWrites(await twoGroups());
    expect(w.keeps.find((k) => k.rowId === "b1")!.after.rel).toEqual(["b2", "z"]);
    expect(w.removeRowIds.sort()).toEqual(["a1", "a2"]);
    expect(w.repoints).toEqual([{ rowId: "ext", databaseId: "o", columnId: "c", before: ["a1", "a2"], after: ["b1", "b2"] }]);
  });

  it("groupe exclu : ses lignes et toute relation qui les vise restent intactes", async () => {
    const payload = await twoGroups();
    const g2 = payload.groups.find((g) => g.keepRowId === "b2")!;
    g2.excluded = true;
    const w = buildMergeWrites(payload);
    // a2 (groupe exclu) n'est ni retirée ni visée : la relation de a1 (groupe retenu) vers a2 reste telle quelle.
    expect(w.removeRowIds).toEqual(["a1"]);
    expect(w.keeps.map((k) => k.rowId)).toEqual(["b1"]);
    expect(w.keeps[0].after.rel).toEqual(["b2", "a2", "z"]);
    // Relation externe : a1 repointée vers b1, a2 laissée. Ligne du groupe exclu (a2) pointant vers a1 : repointée vers b1.
    expect(w.repoints).toEqual([
      { rowId: "ext", databaseId: "o", columnId: "c", before: ["a1", "a2"], after: ["b1", "a2"] },
      { rowId: "a2", databaseId: "db", columnId: "rel", before: ["a1"], after: ["b1"] },
    ]);
  });

  it("tous exclus : aucune écriture", async () => {
    const payload = await twoGroups();
    for (const g of payload.groups) g.excluded = true;
    expect(buildMergeWrites(payload)).toEqual({ keeps: [], removeRowIds: [], repoints: [] });
  });
});

describe("resolveMergeChoices", () => {
  const group = {
    groupId: "g",
    keepRowId: "new",
    removeRowIds: ["old"],
    mergedCells: { n: 1 },
    keepBefore: {},
    keepRow: { id: "new", cells: {}, position: 1 },
    removedRows: [],
    conflicts: [
      {
        columnId: "t",
        chosenFrom: "new",
        candidates: [
          { rowId: "new", value: "récent" },
          { rowId: "old", value: "ancien" },
        ],
      },
    ],
    repatriation: { relationCells: 0, attachments: 0, repointed: [] },
  };
  it("sans override, garde la valeur de la conservée", () => {
    expect(resolveMergeChoices(group)).toEqual({ n: 1 });
  });
  it("override valide : retient la valeur de l'autre ligne", () => {
    expect(resolveMergeChoices(group, { t: "old" })).toEqual({ n: 1, t: "ancien" });
  });
  it("override hors candidats : ignoré", () => {
    expect(resolveMergeChoices(group, { t: "inconnue" })).toEqual({ n: 1 });
  });
});
