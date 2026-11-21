import { describe, it, expect } from "vitest";
import {
  unionIds,
  planPairBackfill,
  findCandidates,
  splitRef,
  parsePairArg,
  type ColLite,
  type BaseLite,
} from "./relation-backfill";

describe("unionIds", () => {
  it("conserve l'ordre existant puis ajoute le nouveau sans doublon", () => {
    expect(unionIds(["a", "b"], ["b", "c", "c"])).toEqual(["a", "b", "c"]);
  });
  it("tolère les valeurs non tableau", () => {
    expect(unionIds(null, ["x"])).toEqual(["x"]);
    expect(unionIds("n", undefined)).toEqual([]);
  });
});

describe("planPairBackfill", () => {
  const rowsA: Array<{ id: string; cells: Record<string, unknown> }> = [
    { id: "a1", cells: { cA: ["b1", "b2"] } },
    { id: "a2", cells: {} },
  ];
  const rowsB: Array<{ id: string; cells: Record<string, unknown> }> = [
    { id: "b1", cells: {} },
    { id: "b2", cells: { cB: ["a2"] } },
    { id: "b3", cells: { cB: ["a1"] } },
  ];
  it("complète les deux sens en union", () => {
    const p = planPairBackfill({ colA: "cA", colB: "cB", rowsA, rowsB });
    expect(p.updatesB.get("b1")).toEqual(["a1"]);
    expect(p.updatesB.get("b2")).toEqual(["a2", "a1"]);
    expect(p.updatesA.get("a1")).toEqual(["b1", "b2", "b3"]);
    expect(p.updatesA.get("a2")).toEqual(["b2"]);
    expect(p.addedToA).toBe(2);
    expect(p.addedToB).toBe(2);
  });
  it("est idempotent", () => {
    const p = planPairBackfill({ colA: "cA", colB: "cB", rowsA, rowsB });
    const apply = (rows: typeof rowsA, col: string, up: Map<string, string[]>) =>
      rows.map((r) => (up.has(r.id) ? { id: r.id, cells: { ...r.cells, [col]: up.get(r.id) } } : r));
    const p2 = planPairBackfill({
      colA: "cA",
      colB: "cB",
      rowsA: apply(rowsA, "cA", p.updatesA),
      rowsB: apply(rowsB, "cB", p.updatesB),
    });
    expect(p2.updatesA.size + p2.updatesB.size).toBe(0);
  });
  it("compte les orphelins sans les propager", () => {
    const p = planPairBackfill({
      colA: "cA",
      colB: "cB",
      rowsA: [{ id: "a1", cells: { cA: ["ghost"] } }],
      rowsB: [{ id: "b1", cells: { cB: ["ghostA"] } }],
    });
    expect(p.orphansA).toBe(1);
    expect(p.orphansB).toBe(1);
    expect(p.updatesA.size + p.updatesB.size).toBe(0);
  });
});

const base = (id: string, name: string, org = "o1"): BaseLite => ({ id, name, organizationId: org });
const rel = (id: string, databaseId: string, name: string, target: string, inverse?: string): ColLite => ({
  id,
  databaseId,
  name,
  type: "relation",
  config: { targetDatabaseId: target, ...(inverse ? { inverseColumnId: inverse } : {}) },
});

describe("findCandidates", () => {
  const bases = [base("A", "Contacts"), base("B", "Interactions"), base("C", "Demandes")];
  it("propose la paire quand un seul A->B et un seul B->A non jumelés", () => {
    const cols = [rel("c1", "A", "Interactions", "B"), rel("c2", "B", "Contact", "A")];
    const r = findCandidates(cols, bases);
    expect(r.candidates).toHaveLength(1);
    expect(r.ambiguous).toHaveLength(0);
    expect(r.unmatched).toHaveLength(0);
  });
  it("ignore les colonnes déjà jumelées réciproquement", () => {
    const cols = [rel("c1", "A", "x", "B", "c2"), rel("c2", "B", "y", "A", "c1")];
    const r = findCandidates(cols, bases);
    expect(r.candidates).toHaveLength(0);
    expect(r.alreadyPaired).toBe(1);
  });
  it("liste en ambiguïté plusieurs colonnes d'un même côté", () => {
    const cols = [
      rel("c1", "A", "x", "B"),
      rel("c3", "A", "x2", "B"),
      rel("c2", "B", "y", "A"),
    ];
    const r = findCandidates(cols, bases);
    expect(r.candidates).toHaveLength(0);
    expect(r.ambiguous).toHaveLength(1);
  });
  it("liste en sens unique une relation sans contrepartie", () => {
    const r = findCandidates([rel("c1", "A", "x", "C")], bases);
    expect(r.unmatched.map((c) => c.id)).toEqual(["c1"]);
  });
  it("écarte les organisations différentes et les auto-relations", () => {
    const b2 = [base("A", "A"), base("B", "B", "o2")];
    const r = findCandidates([rel("c1", "A", "x", "B"), rel("c2", "B", "y", "A")], b2);
    expect(r.candidates).toHaveLength(0);
    expect(r.ambiguous.length + r.unmatched.length).toBeGreaterThan(0);
    const s = findCandidates([rel("s1", "A", "self", "A")], bases);
    expect(s.candidates).toHaveLength(0);
  });
});

describe("références texte", () => {
  it("splitRef propose chaque découpage possible", () => {
    expect(splitRef("Base A.Col B")).toEqual([{ base: "Base A", column: "Col B" }]);
    expect(splitRef("v1.2.Col")).toEqual([
      { base: "v1", column: "2.Col" },
      { base: "v1.2", column: "Col" },
    ]);
    expect(splitRef("sansPoint")).toEqual([]);
  });
  it("parsePairArg", () => {
    expect(parsePairArg("A.x=B.y")).toEqual({ left: "A.x", right: "B.y" });
    expect(() => parsePairArg("A.x")).toThrow();
  });
});
