import { describe, it, expect, vi, afterEach } from "vitest";
import {
  matchesFilter,
  filterRows,
  applySortAndFilter,
  pruneFilterTree,
  NO_VALUE_OPS,
  operatorsExcludedFor,
} from "@/components/editor/extensions/database-block/filter-tree";
import {
  FILTER_OPERATORS_BY_TYPE,
  FILTER_OPERATOR_LABELS,
  FILTER_NO_VALUE_OPS,
} from "@/components/editor/extensions/database-block/constants";
import { isValidFilterOperator } from "@/components/editor/extensions/database-block/filter-builder";
import type {
  DbColumn,
  DbRow,
  FilterGroup,
} from "@/components/editor/extensions/database-block/types";

const cond = (columnId: string, operator: string, value = "") =>
  ({ id: `c_${columnId}_${operator}`, columnId, operator, value }) as never;
const group = (children: unknown[], conjunction: "and" | "or" = "and"): FilterGroup =>
  ({ id: "g", type: "group", conjunction, children }) as never;
const col = (id: string, type: string) => ({ id, name: id, type, position: 0 }) as unknown as DbColumn;
const row = (id: string, cells: Record<string, unknown>) => ({ id, cells }) as unknown as DbRow;

const ME = "user-1";
const q = (raw: unknown, now: string, tz?: string) =>
  matchesFilter(raw as never, "is_this_quarter", "", { colType: "date", now: new Date(now), tz });

afterEach(() => vi.useRealTimers());

describe("is_me", () => {
  const me = (raw: unknown, userId?: string) =>
    matchesFilter(raw as never, "is_me", "", { colType: "person", userId });
  it("vrai si userId dans le tableau", () => expect(me(["a", ME], ME)).toBe(true));
  it("faux sans userId", () => expect(me([ME])).toBe(false));
  it("faux pour vide, null, tableau vide", () => {
    expect(me("", ME)).toBe(false);
    expect(me(null, ME)).toBe(false);
    expect(me([], ME)).toBe(false);
  });
  it("vrai pour une chaîne scalaire héritée", () => expect(me(ME, ME)).toBe(true));
  it("faux pour une chaîne scalaire différente", () => expect(me("autre", ME)).toBe(false));
  it("vrai avec doublons", () => expect(me([ME, ME], ME)).toBe(true));
  it("indépendant de colType", () => {
    expect(matchesFilter([ME] as never, "is_me", "", { userId: ME })).toBe(true);
    expect(matchesFilter([ME] as never, "is_me", "", { colType: "text", userId: ME })).toBe(true);
  });
});

describe("is_this_quarter", () => {
  it("limites Europe/Paris", () => {
    expect(q("2026-03-31T21:59:00.000Z", "2026-02-15T12:00:00Z", "Europe/Paris")).toBe(true);
    expect(q("2026-03-31T22:00:00.000Z", "2026-02-15T12:00:00Z", "Europe/Paris")).toBe(false);
  });
  it("changement d'année", () => {
    const cell = "2026-12-31T23:30:00.000Z";
    expect(q(cell, "2027-01-15T12:00:00Z", "Europe/Paris")).toBe(true);
    expect(q(cell, "2027-01-15T12:00:00Z", "UTC")).toBe(false);
  });
  it("Auckland et Los Angeles diffèrent pour un même instant", () => {
    const cell = "2026-03-31T12:00:00.000Z";
    const now = "2026-01-10T12:00:00Z";
    expect(q(cell, now, "America/Los_Angeles")).toBe(true);
    expect(q(cell, now, "Pacific/Auckland")).toBe(false);
  });
  it("cellule invalide : faux, sans exception", () => {
    expect(q(null, "2026-02-15T12:00:00Z", "UTC")).toBe(false);
    expect(q("", "2026-02-15T12:00:00Z", "UTC")).toBe(false);
    expect(q("abc", "2026-02-15T12:00:00Z", "UTC")).toBe(false);
    expect(q("abc", "2026-02-15T12:00:00Z")).toBe(false);
    expect(q("2026-13-45", "2026-02-15T12:00:00Z", "UTC")).toBe(false);
    expect(q("2026-07-04T10:00:00", "2026-02-15T12:00:00Z", "UTC")).toBe(false);
  });
  it("date seule et ISO sans fuseau comparés en jour civil", () => {
    expect(q("2026-02-10", "2026-02-15T12:00:00Z", "Europe/Paris")).toBe(true);
    expect(q("2026-02-10T10:00:00", "2026-02-15T12:00:00Z", "Europe/Paris")).toBe(true);
  });
  it("sans tz : parties locales du processus", () => {
    const now = new Date(2026, 1, 15, 12);
    expect(matchesFilter(new Date(2026, 0, 1).toISOString(), "is_this_quarter", "", { colType: "date", now })).toBe(true);
    expect(matchesFilter(new Date(2026, 3, 1).toISOString(), "is_this_quarter", "", { colType: "date", now })).toBe(false);
  });
  it("tz invalide : retombe sur le comportement local, sans exception", () => {
    expect(() => q("2026-02-10", "2026-02-15T12:00:00Z", "Not/AZone")).not.toThrow();
  });
});

describe("opérateurs de date avec tz", () => {
  const now = "2026-03-31T22:30:00Z"; // 1er avril 00:30 à Paris, 31 mars en UTC
  const t = (op: string, raw: string, tz: string, value = "") =>
    matchesFilter(raw as never, op as never, value, { colType: "date", now: new Date(now), tz });
  it("is_today suit le jour civil du fuseau", () => {
    expect(t("is_today", "2026-04-01", "Europe/Paris")).toBe(true);
    expect(t("is_today", "2026-04-01", "UTC")).toBe(false);
    expect(t("is_today", "2026-03-31", "UTC")).toBe(true);
  });
  it("is_this_week / month / year", () => {
    expect(t("is_this_month", "2026-04-20", "Europe/Paris")).toBe(true);
    expect(t("is_this_month", "2026-04-20", "UTC")).toBe(false);
    expect(t("is_this_week", "2026-03-30", "Europe/Paris")).toBe(true);
    expect(t("is_this_week", "2026-04-06", "Europe/Paris")).toBe(false);
    expect(t("is_this_year", "2026-12-31", "Europe/Paris")).toBe(true);
  });
  it("is_within_days et comparaisons", () => {
    expect(t("is_within_days", "2026-04-03", "Europe/Paris", "2")).toBe(true);
    expect(t("is_within_days", "2026-04-04", "Europe/Paris", "2")).toBe(false);
    expect(t("is_before", "2026-04-01", "UTC", "2026-04-02")).toBe(true);
    expect(t("is", "2026-04-01T23:00:00.000Z", "Europe/Paris", "2026-04-02")).toBe(true);
  });
});

describe("propagation du contexte", () => {
  const columns = [col("p", "person"), col("d", "date")];
  const tree = group([group([group([cond("p", "is_me")])])]);
  const rows = [row("r1", { p: [ME] }), row("r2", { p: ["x"] }), row("r3", {})];

  it("userId propagé dans un arbre imbriqué", () => {
    expect(filterRows(rows, tree, columns, { userId: ME }).map((r) => r.id)).toEqual(["r1"]);
    expect(filterRows(rows, tree, columns).map((r) => r.id)).toEqual([]);
  });
  it("now propagé dans un arbre imbriqué", () => {
    const tr = group([group([cond("d", "is_today")])]);
    const rs = [row("a", { d: "2026-05-05" }), row("b", { d: "2026-05-06" })];
    const ctx = { now: new Date("2026-05-05T10:00:00Z"), tz: "UTC" };
    expect(filterRows(rs, tr, columns, ctx).map((r) => r.id)).toEqual(["a"]);
    expect(applySortAndFilter(rs, columns, [], tr, ctx).map((r) => r.id)).toEqual(["a"]);
  });
  it("sans contexte, is_today utilise new Date()", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 4, 5, 10));
    const tr = group([cond("d", "is_today")]);
    const rs = [row("a", { d: "2026-05-05" }), row("b", { d: "2026-05-06" })];
    expect(filterRows(rs, tr, columns).map((r) => r.id)).toEqual(["a"]);
  });
  it("les deux opérateurs ne sont pas élagués", () => {
    const tr = group([cond("p", "is_me"), cond("d", "is_this_quarter")]);
    const pruned = pruneFilterTree(tr) as FilterGroup;
    expect(pruned.children).toHaveLength(2);
    expect(NO_VALUE_OPS.has("is_me")).toBe(true);
    expect(FILTER_NO_VALUE_OPS.has("is_this_quarter")).toBe(true);
  });
});

describe("catalogue des opérateurs", () => {
  it("is_me réservé à person, is_this_quarter aux dates", () => {
    for (const [type, ops] of Object.entries(FILTER_OPERATORS_BY_TYPE)) {
      expect(ops.includes("is_me")).toBe(type === "person");
      expect(ops.includes("is_this_quarter")).toBe(type === "date" || type === "time");
    }
  });
  it("libellés", () => {
    expect(FILTER_OPERATOR_LABELS.is_me).toBe("est moi");
    expect(FILTER_OPERATOR_LABELS.is_this_quarter).toBe("ce trimestre");
  });
  it("isValidFilterOperator du constructeur accepte les deux", () => {
    expect(isValidFilterOperator("is_me")).toBe(true);
    expect(isValidFilterOperator("is_this_quarter")).toBe(true);
    expect(isValidFilterOperator("nope")).toBe(false);
  });
});

describe("operatorsExcludedFor", () => {
  it("sans utilisateur courant : is_me exclu (jamais de condition qui ne correspond à rien)", () => {
    expect(operatorsExcludedFor(undefined)).toEqual(["is_me"]);
    expect(operatorsExcludedFor({ now: new Date() })).toEqual(["is_me"]);
  });
  it("avec utilisateur courant : rien d'exclu", () => {
    expect(operatorsExcludedFor({ userId: "u1" })).toBeUndefined();
  });
});
