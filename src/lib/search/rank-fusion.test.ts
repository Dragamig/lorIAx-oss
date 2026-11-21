import { describe, expect, it } from "vitest";
import { fuseByRank } from "./rank-fusion";

const id = (x: { id: string }) => x.id;

describe("fuseByRank", () => {
  it("fait remonter un element present dans plusieurs listes", () => {
    const a = [{ id: "x" }, { id: "y" }];
    const b = [{ id: "z" }, { id: "y" }];
    expect(fuseByRank([a, b], id).map(id)).toEqual([
      { id: "y" },
      { id: "x" },
      { id: "z" },
    ].map(id));
  });

  it("respecte l'ordre au sein d'une liste unique", () => {
    const a = [{ id: "x" }, { id: "y" }, { id: "z" }];
    expect(fuseByRank([a], id).map(id)).toEqual(["x", "y", "z"]);
  });

  it("dedoublonne sur l'identifiant", () => {
    const a = [{ id: "x" }];
    const b = [{ id: "x" }];
    expect(fuseByRank([a, b], id)).toHaveLength(1);
  });

  it("ignore les listes vides", () => {
    expect(fuseByRank([[], [{ id: "x" }], []], id).map(id)).toEqual(["x"]);
  });

  it("rend un tableau vide sans entree", () => {
    expect(fuseByRank([], id)).toEqual([]);
  });
});
