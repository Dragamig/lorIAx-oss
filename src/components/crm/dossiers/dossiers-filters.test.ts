import { describe, expect, it } from "vitest";
import {
  EMPTY_STATE,
  applyDossiersFilters,
  matchViewTab,
  sameState,
  stateToViewConfig,
  viewConfigToState,
  type DossiersFilterState,
  type FilterColumnIds,
} from "./dossiers-filters";

const COLS: FilterColumnIds = { titre: "c-titre", statut: "c-statut", responsable: "c-resp", relance: "c-rel", contact: "c-contact" };
const TODAY = "2026-11-18";
const CLOSED = ["Gagné", "Perdu"];
const st = (over: Partial<DossiersFilterState> = {}): DossiersFilterState => ({ ...EMPTY_STATE, ...over });
const cfg = (s: DossiersFilterState) => stateToViewConfig(s, COLS, TODAY, CLOSED);

describe("stateToViewConfig / viewConfigToState", () => {
  it("aller-retour sur un état complet", () => {
    const s = st({ q: "devis", status: "Nouveau", owner: "u1", contactId: "k1" });
    const back = viewConfigToState(cfg(s), COLS);
    expect(back.state).toEqual(s);
    expect(back.ignored).toBe(0);
  });

  it("mine s'exprime par is_me sur la colonne Responsable", () => {
    const tree = cfg(st({ owner: "mine" })).filters as { children: { columnId: string; operator: string }[] };
    expect(tree.children).toEqual([expect.objectContaining({ columnId: "c-resp", operator: "is_me" })]);
    expect(viewConfigToState(cfg(st({ owner: "mine" })), COLS).state.owner).toBe("mine");
  });

  it("En retard : relance avant aujourd'hui ET statut hors clos", () => {
    const tree = cfg(st({ late: true })).filters as { children: { columnId: string; operator: string; value: string }[] };
    expect(tree.children).toEqual([
      expect.objectContaining({ columnId: "c-rel", operator: "is_before", value: TODAY }),
      expect.objectContaining({ columnId: "c-statut", operator: "is_not", value: "Gagné" }),
      expect.objectContaining({ columnId: "c-statut", operator: "is_not", value: "Perdu" }),
    ]);
    expect(viewConfigToState(cfg(st({ late: true })), COLS).state.late).toBe(true);
  });

  it("envoie toutes les clés d'affichage explicitement", () => {
    expect(cfg(EMPTY_STATE)).toMatchObject({ visibleColumns: "*", columnOrder: null, rowHeight: "normal", sorts: [] });
  });

  it("filtre sur une colonne disparue : ignoré et compté", () => {
    const config = {
      filters: {
        type: "group",
        conjunction: "and",
        children: [
          { id: "a", columnId: "c-disparue", operator: "contains", value: "x" },
          { id: "b", columnId: "c-statut", operator: "is", value: "Nouveau" },
        ],
      },
    };
    const r = viewConfigToState(config, COLS);
    expect(r.state).toEqual(st({ status: "Nouveau" }));
    expect(r.ignored).toBe(1);
  });

  it("config sans filtre : état vide", () => {
    expect(viewConfigToState({}, COLS)).toEqual({ state: EMPTY_STATE, ignored: 0 });
  });
});

describe("matchViewTab", () => {
  const views = [
    { id: "v-all", config: cfg(EMPTY_STATE) },
    { id: "v-new", config: cfg(st({ status: "Nouveau" })) },
  ];
  it("rend l'id de la vue dont les filtres égalent l'état", () => {
    expect(matchViewTab(views, st({ status: "Nouveau" }), COLS)).toBe("v-new");
    expect(matchViewTab(views, EMPTY_STATE, COLS)).toBe("v-all");
  });
  it("rend null pour un état modifié", () => {
    expect(matchViewTab(views, st({ status: "Nouveau", q: "x" }), COLS)).toBeNull();
  });
  it("sameState compare tous les champs", () => {
    expect(sameState(st({ late: true }), st())).toBe(false);
  });
});

describe("applyDossiersFilters", () => {
  const columns = [
    { id: "c-titre", name: "Titre", type: "text", config: {} },
    { id: "c-statut", name: "Statut", type: "select", config: {} },
    { id: "c-resp", name: "Responsable", type: "person", config: {} },
    { id: "c-rel", name: "Relance", type: "date", config: {} },
    { id: "c-contact", name: "Contact", type: "relation", config: {} },
  ];
  const deal = (id: string, title: string, contactName: string | null) => ({ id, title, contactName });
  const rows = [
    { id: "1", cells: { "c-titre": "Devis alpha", "c-statut": "Nouveau", "c-resp": ["u1"], "c-rel": "2026-11-10", "c-contact": ["k1"] } },
    { id: "2", cells: { "c-titre": "Contrat beta", "c-statut": "Gagné", "c-resp": ["u2"], "c-rel": "2026-11-10", "c-contact": ["k2"] } },
    { id: "3", cells: { "c-titre": "Autre", "c-statut": "Nouveau", "c-resp": [], "c-rel": null, "c-contact": [] } },
  ];
  const deals = [deal("1", "Devis alpha", "Camille"), deal("2", "Contrat beta", "Louis"), deal("3", "Autre", null)];
  const run = (s: DossiersFilterState) =>
    applyDossiersFilters({ deals, rows, columns, cols: COLS, state: s, closed: CLOSED, userId: "u1", now: new Date("2026-11-18T10:00:00Z"), tz: "Europe/Paris" }).map((d) => d.id);

  it("mine, statut, recherche sur titre ou contact, contact", () => {
    expect(run(st({ owner: "mine" }))).toEqual(["1"]);
    expect(run(st({ status: "Nouveau" }))).toEqual(["1", "3"]);
    expect(run(st({ q: "louis" }))).toEqual(["2"]);
    expect(run(st({ q: "ALPHA" }))).toEqual(["1"]);
    expect(run(st({ contactId: "k2" }))).toEqual(["2"]);
  });
  it("En retard exclut les dossiers clos et sans relance", () => {
    expect(run(st({ late: true }))).toEqual(["1"]);
  });
  it("état vide : tout", () => {
    expect(run(EMPTY_STATE)).toEqual(["1", "2", "3"]);
  });
});

describe("vue En retard rechargée plus tard", () => {
  it("la date du jour est recalculée, aucune date figée", () => {
    const saved = stateToViewConfig(st({ late: true }), COLS, "2026-11-18", CLOSED);
    const { state } = viewConfigToState(saved, COLS);
    const columns = [
      { id: "c-titre", name: "Titre", type: "text", config: {} },
      { id: "c-statut", name: "Statut", type: "select", config: {} },
      { id: "c-resp", name: "Responsable", type: "person", config: {} },
      { id: "c-rel", name: "Relance", type: "date", config: {} },
      { id: "c-contact", name: "Contact", type: "relation", config: {} },
    ];
    const rows = [{ id: "1", cells: { "c-statut": "Nouveau", "c-rel": "2026-11-25" } }];
    const deals = [{ id: "1", title: "A", contactName: null }];
    const run = (iso: string) =>
      applyDossiersFilters({ deals, rows, columns, cols: COLS, state, closed: CLOSED, userId: "u", now: new Date(iso), tz: "Europe/Paris" }).length;
    expect(run("2026-11-18T10:00:00Z")).toBe(0);
    expect(run("2026-12-01T10:00:00Z")).toBe(1);
  });
});
