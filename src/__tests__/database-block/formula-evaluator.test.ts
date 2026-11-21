import { describe, it, expect } from "vitest";
import { evaluateFormula } from "@/components/editor/extensions/database-block/formula-evaluator";
import type {
  DbColumn,
  DbRow,
  CellValue,
} from "@/components/editor/extensions/database-block/types";

// ─── Fixtures ────────────────────────────────────────────────────────────────

function col(id: string, name: string, type: DbColumn["type"]): DbColumn {
  return {
    id,
    databaseId: "db1",
    name,
    type,
    position: 0,
    config: {},
    createdAt: "2026-01-01T00:00:00Z",
  };
}

const COLS: DbColumn[] = [
  col("c_date", "Date", "date"),
  col("c_fin", "Fin", "date"),
  col("c_n", "Montant", "number"),
];

function rowWith(cells: Record<string, CellValue>): DbRow {
  return {
    id: "r1",
    databaseId: "db1",
    cells,
    position: 0,
    createdAt: "2026-01-01T00:00:00Z",
    updatedAt: "2026-01-01T00:00:00Z",
  };
}

// now figé : vendredi 15 mai 2026, 10:00 (heure locale).
const NOW = new Date("2026-05-15T10:00:00");

function evalF(formula: string, cells: Record<string, CellValue> = {}): CellValue {
  return evaluateFormula(formula, rowWith(cells), COLS, { now: NOW });
}

// ─── Fonctions de date (parité Airtable, now injecté) ───────────────────────

describe("formula-evaluator — fonctions de date", () => {
  it("today() renvoie la date du jour figée", () => {
    expect(evalF("today()")).toBe("2026-05-15");
  });

  it("now() renvoie la date-heure figée", () => {
    expect(evalF("now()")).toBe("2026-05-15T10:00:00");
  });

  it("dateadd décale en jours et reste en date seule", () => {
    expect(evalF('dateadd(prop("Date"), 10, "days")', { c_date: "2026-05-15" })).toBe(
      "2026-05-25"
    );
  });

  it("dateadd en heures bascule en date-heure", () => {
    expect(evalF('dateadd("2026-05-15", 2, "hours")')).toBe("2026-05-15T02:00:00");
  });

  it("dateadd accepte l'unité mois (lettre M sensible à la casse)", () => {
    expect(evalF('dateadd("2026-01-15", 2, "M")')).toBe("2026-03-15");
  });

  it("datetime_diff renvoie d1 - d2 dans l'unité", () => {
    expect(evalF('datetime_diff("2026-05-20", "2026-05-15", "days")')).toBe(5);
    expect(evalF('datetime_diff("2026-05-15", "2026-05-20", "days")')).toBe(-5);
    expect(evalF('datetime_diff("2026-05-15", "2026-01-15", "months")')).toBe(4);
  });

  it("datetime_format applique le masque", () => {
    expect(evalF('datetime_format("2026-05-15T14:30:00", "DD/MM/YYYY")')).toBe(
      "15/05/2026"
    );
    expect(evalF('datetime_format("2026-05-15T14:30:00", "HH:mm")')).toBe("14:30");
  });

  it("year / month / day extraient les composants", () => {
    expect(evalF('year("2026-05-15")')).toBe(2026);
    expect(evalF('month("2026-05-15")')).toBe(5);
    expect(evalF('day("2026-05-15")')).toBe(15);
  });

  it("weekday : dimanche=0 par défaut, lundi=0 sur option", () => {
    expect(evalF('weekday("2026-05-15")')).toBe(5); // vendredi
    expect(evalF('weekday("2026-05-15", "Monday")')).toBe(4);
  });

  it("is_before / is_after comparent deux dates", () => {
    expect(evalF('is_before("2026-05-10", "2026-05-15")')).toBe(true);
    expect(evalF('is_after("2026-05-10", "2026-05-15")')).toBe(false);
    expect(evalF('is_after("2026-05-20", "2026-05-15")')).toBe(true);
  });

  it("is_same : granularité jour vs égalité exacte", () => {
    expect(evalF('is_same("2026-05-15T08:00:00", "2026-05-15T20:00:00", "day")')).toBe(
      true
    );
    expect(evalF('is_same("2026-05-15T08:00:00", "2026-05-16T08:00:00", "day")')).toBe(
      false
    );
    expect(evalF('is_same("2026-05-15T08:00:00", "2026-05-15T20:00:00")')).toBe(false);
  });

  it("renvoie une valeur sûre sur date invalide", () => {
    expect(evalF('year("pas une date")')).toBe(null);
    expect(evalF('is_before("x", "y")')).toBe(false);
    expect(evalF('datetime_diff("x", "y", "days")')).toBe(0);
  });

  it("compose avec prop() et les fonctions existantes", () => {
    // durée d'un séjour en jours
    expect(
      evalF('datetime_diff(prop("Fin"), prop("Date"), "days")', {
        c_date: "2026-05-15",
        c_fin: "2026-05-22",
      })
    ).toBe(7);
  });
});

// ─── Non-régression des fonctions préexistantes ─────────────────────────────

describe("formula-evaluator — back-compat", () => {
  it("maths et texte fonctionnent toujours", () => {
    expect(evalF("round(3.6)")).toBe(4);
    expect(evalF("abs(0 - 5)")).toBe(5);
    expect(evalF('concat("a", "b", "c")')).toBe("abc");
    expect(evalF('upper("loriax")')).toBe("LORIAX");
  });

  it("logique et accès colonne fonctionnent toujours", () => {
    expect(evalF('if(prop("Montant") > 100, "cher", "ok")', { c_n: 150 })).toBe("cher");
    expect(evalF('if(prop("Montant") > 100, "cher", "ok")', { c_n: 50 })).toBe("ok");
  });

  it("fonctions d'heure HH:MM fonctionnent toujours", () => {
    expect(evalF('timediff("08:00", "14:30")')).toBe(390);
    expect(evalF('addminutes("14:30", 90)')).toBe("16:00");
    expect(evalF('hour("14:30")')).toBe(14);
  });
});

// ─── Gestion des caractères échappés dans les chaînes ─────────────────────

describe("formula-evaluator — escaped quotes", () => {
  it("gère les guillemets échappés dans les chaînes", () => {
    expect(evalF('concat("hello\\"world", "!")')).toBe('hello"world!');
  });

  it("gère plusieurs guillemets échappés", () => {
    expect(evalF('upper("a\\"b\\"c")')).toBe('A"B"C');
  });

  it("compose avec d'autres fonctions", () => {
    expect(evalF('length("test\\"quote")')).toBe(10); // "test\"quote" → 10 chars (backslash consumed)
  });
});
