import { describe, it, expect } from "vitest";
import {
  rangeBetween,
  pruneSelection,
  headerCheckState,
  movingIdsFor,
  applyReorder,
  dropBeforeId,
  stepReorder,
  invertReorder,
  sameOrder,
} from "./row-selection";

const rows = (...ids: string[]) => ids.map((id) => ({ id }));
const ids = (r: { id: string }[]) => r.map((x) => x.id);
const order = ["a", "b", "c", "d", "e"];

describe("rangeBetween", () => {
  it("inclut les deux bornes, dans le sens inverse aussi", () => {
    expect(rangeBetween(order, "b", "d")).toEqual(["b", "c", "d"]);
    expect(rangeBetween(order, "d", "b")).toEqual(["b", "c", "d"]);
  });
  it("sans ancre ou ancre inconnue : la cible seule", () => {
    expect(rangeBetween(order, null, "c")).toEqual(["c"]);
    expect(rangeBetween(order, "zz", "c")).toEqual(["c"]);
  });
  it("cible inconnue : vide", () => {
    expect(rangeBetween(order, "a", "zz")).toEqual([]);
  });
});

describe("pruneSelection", () => {
  it("retire les lignes non visibles", () => {
    expect([...pruneSelection(new Set(["a", "x"]), order)]).toEqual(["a"]);
  });
  it("renvoie le même Set si rien ne change", () => {
    const s = new Set(["a", "b"]);
    expect(pruneSelection(s, order)).toBe(s);
  });
});

describe("headerCheckState", () => {
  it("none / some / all", () => {
    expect(headerCheckState(0, 5)).toBe("none");
    expect(headerCheckState(2, 5)).toBe("some");
    expect(headerCheckState(5, 5)).toBe("all");
    expect(headerCheckState(0, 0)).toBe("none");
  });
});

describe("movingIdsFor", () => {
  it("lot complet dans l'ordre affiché si la ligne saisie est sélectionnée", () => {
    expect(movingIdsFor("d", new Set(["d", "b"]), order)).toEqual(["b", "d"]);
  });
  it("ligne seule sinon, ou si la sélection est unique", () => {
    expect(movingIdsFor("c", new Set(["d", "b"]), order)).toEqual(["c"]);
    expect(movingIdsFor("c", new Set(["c"]), order)).toEqual(["c"]);
  });
});

describe("applyReorder", () => {
  it("insère avant la ligne visée", () => {
    expect(ids(applyReorder(rows(...order), ["d"], "b"))).toEqual(["a", "d", "b", "c", "e"]);
  });
  it("null = en fin de liste", () => {
    expect(ids(applyReorder(rows(...order), ["a", "c"], null))).toEqual(["b", "d", "e", "a", "c"]);
  });
  it("garde l'ordre relatif du lot et le rend contigu", () => {
    expect(ids(applyReorder(rows(...order), ["e", "b"], "d"))).toEqual(["a", "c", "b", "e", "d"]);
  });
  it("identifiants inconnus : liste inchangée", () => {
    const r = rows(...order);
    expect(applyReorder(r, ["zz"], null)).toBe(r);
  });
});

describe("dropBeforeId", () => {
  it("avant la cible", () => {
    expect(dropBeforeId(order, ["a"], "c", true)).toBe("c");
  });
  it("après la cible : la suivante non déplacée, ou null en fin", () => {
    expect(dropBeforeId(order, ["d"], "c", false)).toBe("e");
    expect(dropBeforeId(order, ["a"], "e", false)).toBeNull();
    expect(dropBeforeId(order, ["a"], "b", false)).toBe("c");
  });
  it("cible déplacée : undefined", () => {
    expect(dropBeforeId(order, ["a", "b"], "b", true)).toBeUndefined();
  });
});

describe("sameOrder", () => {
  it("compare les identifiants", () => {
    expect(sameOrder(rows("a", "b"), rows("a", "b"))).toBe(true);
    expect(sameOrder(rows("a", "b"), rows("b", "a"))).toBe(false);
  });
});

describe("stepReorder", () => {
  it("monte d'un cran", () => {
    expect(stepReorder(order, ["c"], -1)).toEqual({ rowIds: ["c"], beforeRowId: "b" });
  });
  it("descend d'un cran", () => {
    expect(stepReorder(order, ["c"], 1)).toEqual({ rowIds: ["c"], beforeRowId: "e" });
    expect(stepReorder(order, ["d"], 1)).toEqual({ rowIds: ["d"], beforeRowId: null });
  });
  it("null aux limites", () => {
    expect(stepReorder(order, ["a"], -1)).toBeNull();
    expect(stepReorder(order, ["e"], 1)).toBeNull();
    expect(stepReorder(order, ["a", "b"], -1)).toBeNull();
  });
  it("lot : saute les lignes déplacées", () => {
    expect(stepReorder(order, ["b", "c"], -1)).toEqual({ rowIds: ["b", "c"], beforeRowId: "a" });
    expect(stepReorder(order, ["b", "c"], 1)).toEqual({ rowIds: ["b", "c"], beforeRowId: "e" });
  });
});

describe("invertReorder", () => {
  function roundTrip(before: string[], moving: string[], op: { rowIds: string[]; beforeRowId: string | null }) {
    const after = applyReorder(rows(...before), op.rowIds, op.beforeRowId);
    let back = after;
    for (const o of invertReorder(before, moving)) back = applyReorder(back, o.rowIds, o.beforeRowId);
    return ids(back);
  }
  it("restitue l'ordre d'origine (ligne seule)", () => {
    expect(roundTrip(order, ["d"], { rowIds: ["d"], beforeRowId: "b" })).toEqual(order);
  });
  it("restitue l'ordre d'origine (lot non contigu)", () => {
    expect(roundTrip(order, ["b", "d"], { rowIds: ["b", "d"], beforeRowId: null })).toEqual(order);
    expect(roundTrip(order, ["a", "c", "e"], { rowIds: ["a", "c", "e"], beforeRowId: "d" })).toEqual(order);
  });
  it("une opération par séquence contiguë", () => {
    expect(invertReorder(order, ["b", "c", "e"])).toEqual([
      { rowIds: ["b", "c"], beforeRowId: "d" },
      { rowIds: ["e"], beforeRowId: null },
    ]);
  });
});

import { reinsertRows, revertMove, shouldIgnoreGridKey } from "./row-selection";
import { describe as d2, expect as e2, it as i2 } from "vitest";

d2("delta rollback", () => {
  const r = (id: string) => ({ id });
  i2("reinsertRows replace les lignes retirées sans écraser les autres", () => {
    const orig = ["a", "b", "c", "d"];
    const now = [r("a"), r("d"), r("z")];
    e2(reinsertRows(now, [r("b"), r("c")], orig).map((x) => x.id)).toEqual(["a", "b", "c", "d", "z"]);
  });
  i2("revertMove rétablit l'ordre des lignes déplacées", () => {
    const rows = [r("b"), r("c"), r("a")];
    e2(revertMove(rows, ["a", "b", "c"], ["a"]).map((x) => x.id)).toEqual(["a", "b", "c"]);
  });
  i2("shouldIgnoreGridKey", () => {
    const mk = (hit: string | null, ce = false) => ({ isContentEditable: ce, closest: (s: string) => (hit && s.includes(hit) ? {} : null) });
    const inside = { contains: () => true };
    e2(shouldIgnoreGridKey({ contains: () => false }, mk(null))).toBe(true);
    e2(shouldIgnoreGridKey(inside, mk(null, true))).toBe(true);
    e2(shouldIgnoreGridKey(inside, mk('role="listbox"'))).toBe(true);
    e2(shouldIgnoreGridKey(inside, mk(null))).toBe(false);
  });
});
