import { describe, it, expect } from "vitest";
import {
  resolveVisibleColumns,
  resolveRowHeight,
  viewConfigSchema,
  toggleColumnVisibility,
  setAllColumnsVisible,
  shiftColumn,
  moveColumn,
  pickDisplayConfig,
  toDisplayPatch,
} from "./view-config";

const cols = ["a", "b", "c", "d"].map((id) => ({ id }));
const ids = (c: { id: string }[]) => c.map((x) => x.id);

describe("resolveVisibleColumns", () => {
  it("renvoie tout pour '*' ou config absente", () => {
    expect(ids(resolveVisibleColumns(cols, { visibleColumns: "*" }))).toEqual(["a", "b", "c", "d"]);
    expect(ids(resolveVisibleColumns(cols, undefined))).toEqual(["a", "b", "c", "d"]);
  });
  it("filtre selon la liste", () => {
    expect(ids(resolveVisibleColumns(cols, { visibleColumns: ["a", "c"] }))).toEqual(["a", "c"]);
  });
  it("force la colonne titre même absente de la liste", () => {
    expect(ids(resolveVisibleColumns(cols, { visibleColumns: ["c"] }))).toEqual(["a", "c"]);
    expect(ids(resolveVisibleColumns(cols, { visibleColumns: [] }))).toEqual(["a"]);
  });
  it("applique l'ordre, ajoute les inconnues à la fin", () => {
    expect(ids(resolveVisibleColumns(cols, { columnOrder: ["c", "a"] }))).toEqual(["a", "c", "b", "d"]);
  });
  it("ignore les ids obsolètes et les doublons", () => {
    expect(ids(resolveVisibleColumns(cols, { columnOrder: ["zz", "b", "b"], visibleColumns: ["b", "yy"] }))).toEqual(["a", "b"]);
  });
  it("gère une liste vide", () => {
    expect(resolveVisibleColumns([], { visibleColumns: ["a"] })).toEqual([]);
  });
});

describe("resolveRowHeight", () => {
  it("défaut normal", () => {
    expect(resolveRowHeight(undefined)).toBe("normal");
    expect(resolveRowHeight({})).toBe("normal");
  });
  it("accepte les valeurs valides", () => {
    expect(resolveRowHeight({ rowHeight: "tall" })).toBe("tall");
  });
  it("retombe sur normal si invalide", () => {
    expect(resolveRowHeight({ rowHeight: "huge" } as never)).toBe("normal");
  });
});

describe("viewConfigSchema", () => {
  it("tolère les clés historiques", () => {
    const r = viewConfigSchema.safeParse({ sorts: [], filters: [], groupByColumnId: "x", version: "v1" });
    expect(r.success).toBe(true);
    expect(r.success && r.data.groupByColumnId).toBe("x");
  });
  it("refuse visibleColumns ou rowHeight mal formés", () => {
    expect(viewConfigSchema.safeParse({ visibleColumns: "all" }).success).toBe(false);
    expect(viewConfigSchema.safeParse({ visibleColumns: [1] }).success).toBe(false);
    expect(viewConfigSchema.safeParse({ rowHeight: "huge" }).success).toBe(false);
    expect(viewConfigSchema.safeParse({ columnOrder: "a" }).success).toBe(false);
  });
});

describe("mutations du menu Colonnes", () => {
  const cols = [{ id: "t" }, { id: "a" }, { id: "b" }, { id: "c" }];

  it("toggle masque puis réaffiche, titre intouchable", () => {
    const hidden = toggleColumnVisibility(cols, {}, "b");
    expect(hidden.visibleColumns).toEqual(["t", "a", "c"]);
    expect(toggleColumnVisibility(cols, hidden, "b").visibleColumns).toBe("*");
    expect(toggleColumnVisibility(cols, {}, "t")).toEqual({});
  });
  it("tout afficher / tout masquer", () => {
    expect(setAllColumnsVisible(cols, {}, false).visibleColumns).toEqual(["t"]);
    expect(setAllColumnsVisible(cols, {}, true).visibleColumns).toBe("*");
  });
  it("shiftColumn respecte le titre et les bornes", () => {
    expect(shiftColumn(cols, {}, "b", -1)?.columnOrder).toEqual(["t", "b", "a", "c"]);
    expect(shiftColumn(cols, {}, "a", -1)).toBeNull();
    expect(shiftColumn(cols, {}, "c", 1)).toBeNull();
    expect(shiftColumn(cols, {}, "t", 1)).toBeNull();
  });
  it("moveColumn déplace avant une cible, jamais avant le titre", () => {
    expect(moveColumn(cols, {}, "c", "a").columnOrder).toEqual(["t", "c", "a", "b"]);
    expect(moveColumn(cols, {}, "a", null).columnOrder).toEqual(["t", "b", "c", "a"]);
    expect(moveColumn(cols, {}, "c", "t")).toEqual({});
  });
  it("le résultat est cohérent avec resolveVisibleColumns", () => {
    const cfg = moveColumn(cols, toggleColumnVisibility(cols, {}, "a"), "c", "b");
    expect(resolveVisibleColumns(cols, cfg).map((c) => c.id)).toEqual(["t", "c", "b"]);
  });
});

describe("pickDisplayConfig", () => {
  it("extrait les clés d'affichage et ignore le reste", () => {
    expect(pickDisplayConfig({ sorts: [], rowHeight: "tall", columnOrder: ["a"] })).toEqual({ rowHeight: "tall", columnOrder: ["a"] });
  });
  it("renvoie {} si invalide ou absent", () => {
    expect(pickDisplayConfig({ rowHeight: "huge" })).toEqual({});
    expect(pickDisplayConfig(null)).toEqual({});
  });
});

describe("toDisplayPatch", () => {
  it("rend les trois clés explicites avec leurs valeurs par défaut", () => {
    expect(toDisplayPatch({})).toEqual({ visibleColumns: "*", columnOrder: null, rowHeight: "normal" });
  });
  it("conserve les valeurs fournies", () => {
    expect(toDisplayPatch({ visibleColumns: ["a"], columnOrder: ["b", "a"], rowHeight: "tall" })).toEqual({
      visibleColumns: ["a"],
      columnOrder: ["b", "a"],
      rowHeight: "tall",
    });
  });
  it("accepte columnOrder null et pickDisplayConfig l'ignore", () => {
    expect(viewConfigSchema.safeParse({ columnOrder: null }).success).toBe(true);
    expect(pickDisplayConfig({ columnOrder: null })).toEqual({});
  });
});
