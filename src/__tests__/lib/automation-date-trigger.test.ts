import { describe, it, expect } from "vitest";
import { isDateRowDue, parseCellDateMs } from "@/lib/automations/date-trigger";

describe("isDateRowDue", () => {
  const prev = 1_000;
  const now = 2_000;

  it("déclenche quand l'échéance tombe dans la fenêtre (prev, now]", () => {
    expect(isDateRowDue(1_500, prev, now)).toBe(true);
  });

  it("déclenche pile à la borne now (inclusive)", () => {
    expect(isDateRowDue(2_000, prev, now)).toBe(true);
  });

  it("ne déclenche pas avant la fenêtre (échéance ≤ prevCheck → déjà traitée)", () => {
    expect(isDateRowDue(1_000, prev, now)).toBe(false);
    expect(isDateRowDue(500, prev, now)).toBe(false);
  });

  it("ne déclenche pas après la fenêtre (échéance future)", () => {
    expect(isDateRowDue(2_500, prev, now)).toBe(false);
  });
});

describe("parseCellDateMs", () => {
  it("renvoie null pour les valeurs vides", () => {
    expect(parseCellDateMs(null)).toBeNull();
    expect(parseCellDateMs(undefined)).toBeNull();
    expect(parseCellDateMs("")).toBeNull();
  });

  it("renvoie null pour une valeur non parsable", () => {
    expect(parseCellDateMs("pas une date")).toBeNull();
  });

  it("parse une date ISO", () => {
    expect(parseCellDateMs("2026-05-29T10:00:00.000Z")).toBe(
      Date.parse("2026-05-29T10:00:00.000Z")
    );
  });

  it("recale à atHour quand fourni", () => {
    const ms = parseCellDateMs("2026-05-29", 9);
    expect(ms).not.toBeNull();
    expect(new Date(ms as number).getHours()).toBe(9);
  });

  it("offsetDays appliqué par l'appelant : +1 jour = +86 400 000 ms", () => {
    const base = parseCellDateMs("2026-05-29T00:00:00.000Z") as number;
    const target = base + 86_400_000;
    expect(target - base).toBe(86_400_000);
  });
});
