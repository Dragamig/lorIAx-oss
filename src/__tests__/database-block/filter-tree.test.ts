import { describe, it, expect } from "vitest";
import {
  normalizeFilterTree,
  pruneFilterTree,
  filterRows,
  matchesFilter,
  countActiveConditions,
  isFilterGroup,
  newFilterId,
  applySortAndFilter,
} from "@/components/editor/extensions/database-block/filter-tree";
import type {
  DbColumn,
  DbRow,
  FilterGroup,
  SortConfig,
} from "@/components/editor/extensions/database-block/types";

// ─── Fixtures ────────────────────────────────────────────────────────────────

function col(id: string, type: DbColumn["type"]): DbColumn {
  return { id, databaseId: "db", name: id, type, position: 0, config: {}, createdAt: "" };
}

function row(id: string, cells: Record<string, unknown>): DbRow {
  return {
    id,
    databaseId: "db",
    cells: cells as DbRow["cells"],
    position: 0,
    createdAt: "",
    updatedAt: "",
  };
}

const ROWS: DbRow[] = [
  row("1", { name: "Alice", age: 30, done: true }),
  row("2", { name: "Bob", age: 25, done: false }),
  row("3", { name: "Carol", age: 40, done: true }),
  row("4", { name: "", age: null, done: false }),
];

// Construit un groupe racine ET avec des conditions plates.
function group(conjunction: "and" | "or", children: FilterGroup["children"]): FilterGroup {
  return { id: newFilterId(), type: "group", conjunction, children };
}

// ─── Migration / normalisation ──────────────────────────────────────────────

describe("normalizeFilterTree", () => {
  it("null → groupe racine vide en ET", () => {
    const t = normalizeFilterTree(null);
    expect(t.type).toBe("group");
    expect(t.conjunction).toBe("and");
    expect(t.children).toEqual([]);
  });

  it("ancien format plat (tableau) → conditions en ET, ids générés", () => {
    const t = normalizeFilterTree([
      { columnId: "name", operator: "contains", value: "a" },
      { columnId: "age", operator: "gt", value: "20" },
    ]);
    expect(t.conjunction).toBe("and");
    expect(t.children).toHaveLength(2);
    expect(t.children.every((c) => !isFilterGroup(c) && typeof c.id === "string")).toBe(true);
  });

  it("arbre déjà structuré → préservé (conjonction + imbrication)", () => {
    const src = group("or", [
      { id: "c1", columnId: "name", operator: "is", value: "Alice" },
      group("and", [{ id: "c2", columnId: "age", operator: "lt", value: "30" }]),
    ]);
    const t = normalizeFilterTree(JSON.parse(JSON.stringify(src)));
    expect(t.conjunction).toBe("or");
    expect(t.children).toHaveLength(2);
    expect(isFilterGroup(t.children[1])).toBe(true);
  });
});

// ─── Élagage ──────────────────────────────────────────────────────────────────

describe("pruneFilterTree", () => {
  it("retire les conditions sans valeur quand l'opérateur en exige une", () => {
    const t = group("and", [
      { id: "c1", columnId: "name", operator: "contains", value: "" },
      { id: "c2", columnId: "age", operator: "gt", value: "20" },
    ]);
    const pruned = pruneFilterTree(t) as FilterGroup;
    expect(pruned.children).toHaveLength(1);
  });

  it("conserve les opérateurs sans valeur (is_empty…)", () => {
    const t = group("and", [{ id: "c1", columnId: "name", operator: "is_empty", value: "" }]);
    expect(pruneFilterTree(t)).not.toBeNull();
  });

  it("supprime les groupes vidés → null si tout est vide", () => {
    const t = group("and", [
      group("and", [{ id: "c1", columnId: "name", operator: "contains", value: "" }]),
    ]);
    expect(pruneFilterTree(t)).toBeNull();
  });
});

// ─── Évaluation ────────────────────────────────────────────────────────────────

describe("filterRows", () => {
  it("sans filtre actif → toutes les lignes", () => {
    expect(filterRows(ROWS, group("and", []))).toHaveLength(4);
  });

  it("ET : combine deux conditions", () => {
    const t = group("and", [
      { id: "c1", columnId: "done", operator: "is_checked", value: "" },
      { id: "c2", columnId: "age", operator: "gt", value: "35" },
    ]);
    expect(filterRows(ROWS, t).map((r) => r.id)).toEqual(["3"]);
  });

  it("OU : union de deux conditions", () => {
    const t = group("or", [
      { id: "c1", columnId: "name", operator: "is", value: "Bob" },
      { id: "c2", columnId: "age", operator: "gte", value: "40" },
    ]);
    expect(filterRows(ROWS, t).map((r) => r.id).sort()).toEqual(["2", "3"]);
  });

  it("groupe imbriqué : A ET (B OU C)", () => {
    const t = group("and", [
      { id: "c1", columnId: "done", operator: "is_checked", value: "" },
      group("or", [
        { id: "c2", columnId: "name", operator: "is", value: "Alice" },
        { id: "c3", columnId: "age", operator: "gt", value: "100" },
      ]),
    ]);
    expect(filterRows(ROWS, t).map((r) => r.id)).toEqual(["1"]);
  });

  it("is_empty cible les cellules vides/null", () => {
    const t = group("and", [{ id: "c1", columnId: "name", operator: "is_empty", value: "" }]);
    expect(filterRows(ROWS, t).map((r) => r.id)).toEqual(["4"]);
  });

  it("contains est insensible à la casse", () => {
    const t = group("and", [{ id: "c1", columnId: "name", operator: "contains", value: "ar" }]);
    expect(filterRows(ROWS, t).map((r) => r.id)).toEqual(["3"]);
  });

  it("condition incomplète ignorée (aucun effet)", () => {
    const t = group("and", [{ id: "c1", columnId: "name", operator: "contains", value: "  " }]);
    expect(filterRows(ROWS, t)).toHaveLength(4);
  });
});

// ─── Filtres de date (sémantique calendaire, granularité jour) ──────────────

describe("filtres de date — comparaison à une date saisie", () => {
  const DATE_COLS: DbColumn[] = [col("d", "date")];
  const DATE_ROWS: DbRow[] = [
    row("1", { d: "2026-01-10" }),
    row("2", { d: "2026-05-15" }),
    row("3", { d: "2026-09-20" }),
    row("4", { d: "" }),
  ];
  const t = (operator: string, value: string): FilterGroup =>
    group("and", [{ id: "c", columnId: "d", operator: operator as never, value }]);

  it("is : jour exact (ignore l'heure)", () => {
    expect(filterRows(DATE_ROWS, t("is", "2026-05-15"), DATE_COLS).map((r) => r.id)).toEqual(["2"]);
  });
  it("is_not : tout sauf le jour (cellule vide exclue)", () => {
    expect(filterRows(DATE_ROWS, t("is_not", "2026-05-15"), DATE_COLS).map((r) => r.id)).toEqual(["1", "3"]);
  });
  it("is_before : strictement avant", () => {
    expect(filterRows(DATE_ROWS, t("is_before", "2026-05-15"), DATE_COLS).map((r) => r.id)).toEqual(["1"]);
  });
  it("is_after : strictement après", () => {
    expect(filterRows(DATE_ROWS, t("is_after", "2026-05-15"), DATE_COLS).map((r) => r.id)).toEqual(["3"]);
  });
  it("is_on_or_before : inclut le jour", () => {
    expect(filterRows(DATE_ROWS, t("is_on_or_before", "2026-05-15"), DATE_COLS).map((r) => r.id)).toEqual(["1", "2"]);
  });
  it("is_on_or_after : inclut le jour", () => {
    expect(filterRows(DATE_ROWS, t("is_on_or_after", "2026-05-15"), DATE_COLS).map((r) => r.id)).toEqual(["2", "3"]);
  });
});

describe("filtres de date relatifs (matchesFilter, now injecté)", () => {
  const now = new Date("2026-05-15"); // vendredi
  const opt = (op: string) => matchesFilter("2026-05-15", op as never, "", { colType: "date", now });

  it("is_today : vrai le jour même", () => {
    expect(opt("is_today")).toBe(true);
    expect(matchesFilter("2026-05-14", "is_today" as never, "", { colType: "date", now })).toBe(false);
  });
  it("is_this_week : lundi→dimanche de la semaine courante", () => {
    expect(matchesFilter("2026-05-11", "is_this_week" as never, "", { colType: "date", now })).toBe(true); // lundi
    expect(matchesFilter("2026-05-17", "is_this_week" as never, "", { colType: "date", now })).toBe(true); // dimanche
    expect(matchesFilter("2026-05-18", "is_this_week" as never, "", { colType: "date", now })).toBe(false);
  });
  it("is_this_month : même mois et année", () => {
    expect(matchesFilter("2026-05-01", "is_this_month" as never, "", { colType: "date", now })).toBe(true);
    expect(matchesFilter("2026-06-01", "is_this_month" as never, "", { colType: "date", now })).toBe(false);
  });
  it("is_this_year : même année", () => {
    expect(matchesFilter("2026-12-31", "is_this_year" as never, "", { colType: "date", now })).toBe(true);
    expect(matchesFilter("2025-12-31", "is_this_year" as never, "", { colType: "date", now })).toBe(false);
  });
  it("is_within_days : entre aujourd'hui et aujourd'hui + N", () => {
    expect(matchesFilter("2026-05-18", "is_within_days" as never, "5", { colType: "date", now })).toBe(true);
    expect(matchesFilter("2026-05-21", "is_within_days" as never, "5", { colType: "date", now })).toBe(false);
    expect(matchesFilter("2026-05-10", "is_within_days" as never, "5", { colType: "date", now })).toBe(false); // passé
  });
});

describe("countActiveConditions", () => {
  it("ne compte que les feuilles non élaguées", () => {
    const t = group("and", [
      { id: "c1", columnId: "name", operator: "contains", value: "a" },
      { id: "c2", columnId: "age", operator: "gt", value: "" },
      group("or", [{ id: "c3", columnId: "done", operator: "is_checked", value: "" }]),
    ]);
    expect(countActiveConditions(t)).toBe(2);
  });
});

describe("applySortAndFilter", () => {
  const columns = [col("name", "text"), col("age", "number"), col("done", "checkbox")];
  const rows = [
    row("r1", { name: "Charlie", age: 30, done: false }),
    row("r2", { name: "alice", age: 20, done: true }),
    row("r3", { name: "Bob", age: 25, done: false }),
  ];

  it("trie par nombre croissant", () => {
    const sorts: SortConfig[] = [{ columnId: "age", direction: "asc" }];
    const out = applySortAndFilter(rows, columns, sorts, normalizeFilterTree(null));
    expect(out.map((r) => r.id)).toEqual(["r2", "r3", "r1"]);
  });

  it("trie par nombre décroissant", () => {
    const sorts: SortConfig[] = [{ columnId: "age", direction: "desc" }];
    const out = applySortAndFilter(rows, columns, sorts, normalizeFilterTree(null));
    expect(out.map((r) => r.id)).toEqual(["r1", "r3", "r2"]);
  });

  it("trie le texte sans tenir compte de la casse (locale fr)", () => {
    const sorts: SortConfig[] = [{ columnId: "name", direction: "asc" }];
    const out = applySortAndFilter(rows, columns, sorts, normalizeFilterTree(null));
    expect(out.map((r) => r.id)).toEqual(["r2", "r3", "r1"]); // alice, Bob, Charlie
  });

  it("applique filtre puis tri (WYSIWYG export)", () => {
    const sorts: SortConfig[] = [{ columnId: "age", direction: "asc" }];
    const tree = group("and", [
      { id: "c1", columnId: "done", operator: "is_not_checked", value: "" },
    ]);
    const out = applySortAndFilter(rows, columns, sorts, tree);
    expect(out.map((r) => r.id)).toEqual(["r3", "r1"]); // exclut r2 (done), trié par âge
  });

  it("ne mute pas le tableau source", () => {
    const sorts: SortConfig[] = [{ columnId: "age", direction: "desc" }];
    applySortAndFilter(rows, columns, sorts, normalizeFilterTree(null));
    expect(rows.map((r) => r.id)).toEqual(["r1", "r2", "r3"]);
  });
});
