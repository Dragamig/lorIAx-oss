import { describe, expect, it } from "vitest";
import {
  addDaysIso,
  daysUntil,
  isPastDate,
  readIsoDate,
  relanceBucket,
  todayIn,
} from "../dates";

const NOW = new Date("2026-11-18T23:30:00Z");

describe("todayIn", () => {
  it("suit le fuseau demandé", () => {
    expect(todayIn(NOW, "Europe/Paris")).toBe("2026-11-19");
    expect(todayIn(NOW, "America/Los_Angeles")).toBe("2026-11-18");
  });
  it("replie un fuseau invalide ou absent sur Europe/Paris", () => {
    expect(todayIn(NOW, "Pas/Un_Fuseau")).toBe("2026-11-19");
    expect(todayIn(NOW, undefined)).toBe("2026-11-19");
  });
});

describe("addDaysIso", () => {
  it("passe les fins de mois et d'année", () => {
    expect(addDaysIso("2026-12-31", 1)).toBe("2027-01-01");
    expect(addDaysIso("2026-03-01", -1)).toBe("2026-02-28");
  });
});

describe("daysUntil / isPastDate", () => {
  it("compte les jours, négatif si passé", () => {
    expect(daysUntil("2026-11-20", "2026-11-18")).toBe(2);
    expect(daysUntil("2026-11-17", "2026-11-18")).toBe(-1);
    expect(daysUntil("2026-11-18", "2026-11-18")).toBe(0);
  });
  it("isPastDate est strict", () => {
    expect(isPastDate("2026-11-17", "2026-11-18")).toBe(true);
    expect(isPastDate("2026-11-18", "2026-11-18")).toBe(false);
  });
});

describe("relanceBucket", () => {
  const t = "2026-11-18";
  it("classe par échéance", () => {
    expect(relanceBucket("2026-11-17", t, 7)).toBe("late");
    expect(relanceBucket("2026-11-18", t, 7)).toBe("today");
    expect(relanceBucket("2026-11-25", t, 7)).toBe("week");
    expect(relanceBucket("2026-11-26", t, 7)).toBe("later");
  });
  it("renvoie null sans date valide", () => {
    expect(relanceBucket(null, t, 7)).toBeNull();
    expect(relanceBucket("pas une date", t, 7)).toBeNull();
  });
});

describe("readIsoDate", () => {
  it("accepte une date et un ISO complet", () => {
    expect(readIsoDate("2026-11-18")).toBe("2026-11-18");
    expect(readIsoDate("2026-11-18T23:30:00Z")).toBe("2026-11-18");
  });
  it("rejette le reste", () => {
    expect(readIsoDate(42)).toBeNull();
    expect(readIsoDate("2026-02-30")).toBeNull();
    expect(readIsoDate("")).toBeNull();
    expect(readIsoDate(["2026-11-18"])).toBeNull();
  });
});
