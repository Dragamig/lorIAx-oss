import { describe, it, expect } from "vitest";
import {
  boardTotals,
  isMultiValueGrouping,
  laneTotals,
  readAmount,
  resolveTotalsConfig,
  type ActiveTotalsConfig,
  type KanbanLane,
} from "@/lib/bases/kanban";

const AMT = "amt";
const cfg = (over: Partial<ActiveTotalsConfig> = {}): ActiveTotalsConfig => ({
  amountColumnId: AMT,
  closedLanes: [],
  weights: {},
  currency: "EUR",
  showWeighted: true,
  ...over,
});
const row = (id: string, amount: unknown) => ({ id, cells: { [AMT]: amount } });
const lane = (key: string, rows: ReturnType<typeof row>[]): KanbanLane => ({ key, rows });

describe("readAmount", () => {
  it("nombre fini seulement", () => {
    expect(readAmount(12.5)).toBe(12.5);
    expect(readAmount(0)).toBe(0);
    for (const v of ["", null, undefined, "abc", "12,5", "12", NaN, Infinity, -Infinity, {}, [], true]) {
      expect(readAmount(v)).toBeNull();
    }
  });
});

describe("laneTotals", () => {
  it("somme, compte et non chiffrées (vide, null, \"abc\", \"12,5\", NaN, Infinity)", () => {
    const l = lane("A", [row("1", 100), row("2", ""), row("3", null), row("4", "abc"), row("5", "12,5"), row("6", NaN), row("7", Infinity), row("8", 50)]);
    expect(laneTotals(l, cfg())).toEqual({ count: 8, sum: 150, weighted: 0, unpriced: 6 });
  });
  it("une carte non chiffrée compte dans count, vaut 0 dans sum", () => {
    const t = laneTotals(lane("A", [row("1", null)]), cfg());
    expect(t.count).toBe(1);
    expect(t.sum).toBe(0);
    expect(t.unpriced).toBe(1);
  });
  it("montant négatif sommé tel quel", () => {
    expect(laneTotals(lane("A", [row("1", -30), row("2", 100)]), cfg()).sum).toBe(70);
  });
  it("1e21 reste fini et ne produit pas NaN", () => {
    const t = laneTotals(lane("A", [row("1", 1e21)]), cfg({ weights: { A: 50 } }));
    expect(Number.isFinite(t.sum)).toBe(true);
    expect(Number.isNaN(t.weighted)).toBe(false);
  });
  it("poids absent donne weighted 0", () => {
    expect(laneTotals(lane("A", [row("1", 1000)]), cfg()).weighted).toBe(0);
  });
  it("poids 40 sur 1000 donne 400", () => {
    expect(laneTotals(lane("A", [row("1", 1000)]), cfg({ weights: { A: 40 } })).weighted).toBe(400);
  });
});

describe("boardTotals", () => {
  it("voie close exclue de openSum et weightedSum, ses propres count et sum conservés dans laneTotals", () => {
    const lanes = [lane("A", [row("1", 100)]), lane("Gagné", [row("2", 500)])];
    const c = cfg({ closedLanes: ["Gagné"], weights: { A: 50, Gagné: 100 } });
    expect(boardTotals(lanes, c)).toEqual({ count: 2, open: 1, openSum: 100, weightedSum: 50 });
    expect(laneTotals(lanes[1], c)).toMatchObject({ count: 1, sum: 500 });
  });
  it("clé de poids morte et closedLanes mort ignorés sans erreur", () => {
    const lanes = [lane("A", [row("1", 100)])];
    const c = cfg({ closedLanes: ["Disparue"], weights: { Disparue: 90, A: 10 } });
    expect(boardTotals(lanes, c)).toEqual({ count: 1, open: 1, openSum: 100, weightedSum: 10 });
  });
  it("voie Sans valeur jamais close, même listée dans closedLanes", () => {
    const lanes = [lane("", [row("1", 100)])];
    expect(boardTotals(lanes, cfg()).open).toBe(1);
    const t = boardTotals(lanes, cfg({ closedLanes: [""], weights: { "": 20 } }));
    expect(t).toEqual({ count: 1, open: 1, openSum: 100, weightedSum: 20 });
  });
  it("multi-select : une ligne dans deux voies compte une fois dans count, open et openSum", () => {
    const r = row("1", 100);
    const t = boardTotals([lane("A", [r]), lane("B", [r])], cfg());
    expect(t).toMatchObject({ count: 1, open: 1, openSum: 100 });
  });
  it("multi-select : ligne ouverte dans une voie et close dans l'autre compte comme ouverte", () => {
    const r = row("1", 100);
    const t = boardTotals([lane("A", [r]), lane("Perdu", [r])], cfg({ closedLanes: ["Perdu"] }));
    expect(t).toMatchObject({ count: 1, open: 1, openSum: 100 });
  });
  it("multi-select : weightedSum prend le poids maximal des voies ouvertes", () => {
    const r = row("1", 1000);
    const c = cfg({ weights: { A: 20, B: 70, Perdu: 100 }, closedLanes: ["Perdu"] });
    expect(boardTotals([lane("A", [r]), lane("B", [r]), lane("Perdu", [r])], c).weightedSum).toBe(700);
  });
  it("sans aucune carte : tout à 0", () => {
    expect(boardTotals([lane("A", []), lane("", [])], cfg())).toEqual({ count: 0, open: 0, openSum: 0, weightedSum: 0 });
    expect(boardTotals([], cfg())).toEqual({ count: 0, open: 0, openSum: 0, weightedSum: 0 });
  });
  it("carte non chiffrée comptée dans open, 0 dans les sommes", () => {
    expect(boardTotals([lane("A", [row("1", null)])], cfg({ weights: { A: 50 } }))).toEqual({ count: 1, open: 1, openSum: 0, weightedSum: 0 });
  });
});

describe("resolveTotalsConfig", () => {
  const cols = [
    { id: AMT, name: "Montant", type: "number" },
    { id: "f", name: "F", type: "formula" },
    { id: "t", name: "T", type: "text" },
  ];
  const base = { closedLanes: [], weights: {}, showWeighted: true };
  it("none", () => {
    expect(resolveTotalsConfig(cols, {})).toEqual({ active: null, reason: "none" });
    expect(resolveTotalsConfig(cols, { kanbanTotals: null })).toEqual({ active: null, reason: "none" });
    expect(resolveTotalsConfig(cols, undefined)).toEqual({ active: null, reason: "none" });
  });
  it("missing_column", () => {
    expect(resolveTotalsConfig(cols, { kanbanTotals: { ...base, amountColumnId: "zz" } })).toEqual({ active: null, reason: "missing_column" });
  });
  it("bad_type", () => {
    expect(resolveTotalsConfig(cols, { kanbanTotals: { ...base, amountColumnId: "t" } })).toEqual({ active: null, reason: "bad_type" });
  });
  it("formula acceptée, devise par défaut EUR", () => {
    const r = resolveTotalsConfig(cols, { kanbanTotals: { ...base, amountColumnId: "f" } });
    expect(r.active?.currency).toBe("EUR");
    expect(r.active?.amountColumnId).toBe("f");
  });
  it("devise explicite conservée", () => {
    const r = resolveTotalsConfig(cols, { kanbanTotals: { ...base, amountColumnId: AMT, currency: "CHF" } });
    expect(r.active?.currency).toBe("CHF");
  });
  it("showWeighted faux : conservé tel quel, weighted reste calculé", () => {
    const r = resolveTotalsConfig(cols, { kanbanTotals: { ...base, amountColumnId: AMT, showWeighted: false, weights: { A: 50 } } });
    expect(r.active?.showWeighted).toBe(false);
    expect(laneTotals(lane("A", [row("1", 100)]), r.active!).weighted).toBe(50);
  });
  it("config invalide : none", () => {
    expect(resolveTotalsConfig(cols, { kanbanTotals: "x" })).toEqual({ active: null, reason: "none" });
  });
});

describe("colonne de montant formule", () => {
  const cols = [
    { id: "q", name: "Qte", type: "number", config: {} },
    { id: "f", name: "Total", type: "formula", config: { formula: 'prop("Qte") * 10' } },
    { id: "n", name: "Nul", type: "formula", config: { formula: 'prop("Inconnue")' } },
    { id: "s", name: "Txt", type: "formula", config: { formula: '"abc"' } },
  ];
  const mk = (id: string, q: unknown) => ({ id, cells: { q } });
  const resolve = (col: string) =>
    resolveTotalsConfig(cols, { kanbanTotals: { amountColumnId: col, closedLanes: [], weights: { A: 50 }, showWeighted: true } }).active!;
  it("résultat numérique compté depuis la formule", () => {
    const l = lane("A", [mk("1", 5), mk("2", 3)] as never);
    const c = resolve("f");
    expect(laneTotals(l, c)).toMatchObject({ count: 2, sum: 80, unpriced: 0 });
    expect(boardTotals([l], c)).toMatchObject({ openSum: 80, weightedSum: 40 });
  });
  it("résultat texte, nul ou \"#ERREUR\" donne non chiffré", () => {
    const l = lane("A", [mk("1", 5)] as never);
    expect(laneTotals(l, resolve("s"))).toMatchObject({ sum: 0, unpriced: 1 });
    expect(laneTotals(l, resolve("n"))).toMatchObject({ sum: 0, unpriced: 1 });
    expect(laneTotals(l, { ...resolve("f"), amountOf: () => "#ERREUR" })).toMatchObject({ sum: 0, unpriced: 1 });
  });
});

describe("isMultiValueGrouping", () => {
  it("suit config.multiple", () => {
    expect(isMultiValueGrouping({ id: "s", name: "S", type: "select", config: { multiple: true } })).toBe(true);
    expect(isMultiValueGrouping({ id: "s", name: "S", type: "select" })).toBe(false);
  });
});
