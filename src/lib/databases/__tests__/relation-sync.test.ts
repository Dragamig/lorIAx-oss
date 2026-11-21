import { describe, it, expect } from "vitest";
import { diffRelationIds, pairedRelationColumns, cloneColumnConfig } from "../relation-sync";

describe("diffRelationIds", () => {
  it("détecte les ajouts", () => {
    expect(diffRelationIds(["a"], ["a", "b"])).toEqual({ added: ["b"], removed: [] });
  });
  it("détecte les retraits", () => {
    expect(diffRelationIds(["a", "b"], ["a"])).toEqual({ added: [], removed: ["b"] });
  });
  it("détecte un remplacement", () => {
    expect(diffRelationIds(["a"], ["b"])).toEqual({ added: ["b"], removed: ["a"] });
  });
  it("ignore les doublons", () => {
    expect(diffRelationIds(["a", "a"], ["a", "b", "b"])).toEqual({ added: ["b"], removed: [] });
  });
  it("traite une valeur non tableau comme vide", () => {
    expect(diffRelationIds(undefined, ["a"])).toEqual({ added: ["a"], removed: [] });
    expect(diffRelationIds("a", null)).toEqual({ added: [], removed: [] });
    expect(diffRelationIds(["a"], "x")).toEqual({ added: [], removed: ["a"] });
  });
  it("ignore les éléments qui ne sont pas des textes non vides", () => {
    expect(diffRelationIds([1, null, ""], ["a", 2])).toEqual({ added: ["a"], removed: [] });
  });
  it("sans changement, rien", () => {
    expect(diffRelationIds(["a", "b"], ["b", "a"])).toEqual({ added: [], removed: [] });
  });
});

describe("pairedRelationColumns", () => {
  const col = (id: string, type: string, config: unknown) => ({ id, type, config });
  it("ne garde que les relations jumelées", () => {
    const out = pairedRelationColumns([
      col("c1", "relation", { targetDatabaseId: "d2", inverseColumnId: "c9" }),
      col("c2", "relation", { targetDatabaseId: "d2" }),
      col("c3", "text", { targetDatabaseId: "d2", inverseColumnId: "c9" }),
      col("c4", "relation", null),
      col("c5", "relation", { inverseColumnId: "c9" }),
    ]);
    expect(out).toEqual([{ columnId: "c1", targetDatabaseId: "d2", inverseColumnId: "c9" }]);
  });
});

describe("cloneColumnConfig", () => {
  it("retire inverseColumnId d'une relation et garde le reste", () => {
    const src = { targetDatabaseId: "d2", inverseColumnId: "c9", x: 1 };
    const out = cloneColumnConfig("relation", src);
    expect(out).toEqual({ targetDatabaseId: "d2", x: 1 });
    expect(src.inverseColumnId).toBe("c9");
  });
  it("laisse les autres types et configs nulles intactes", () => {
    expect(cloneColumnConfig("text", { inverseColumnId: "c9" })).toEqual({ inverseColumnId: "c9" });
    expect(cloneColumnConfig("relation", null)).toEqual({});
  });
});
