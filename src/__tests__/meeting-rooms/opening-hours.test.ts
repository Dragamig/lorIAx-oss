import { describe, it, expect } from "vitest";
import {
  isWithinOpeningHours,
  computeAvailability,
  isValidOpeningHours,
} from "@/lib/meeting-rooms/opening-hours";
import type { OpeningHours } from "@/types";

const STANDARD: OpeningHours = {
  mon: [{ from: "08:00", to: "19:00" }],
  tue: [{ from: "08:00", to: "19:00" }],
  wed: [{ from: "08:00", to: "12:00" }, { from: "13:30", to: "19:00" }],
  thu: [{ from: "08:00", to: "19:00" }],
  fri: [{ from: "08:00", to: "19:00" }],
  sat: [],
  sun: [],
};

function localDate(y: number, m: number, d: number, h: number, min = 0): Date {
  return new Date(y, m - 1, d, h, min, 0, 0);
}

describe("isWithinOpeningHours", () => {
  it("accepte un créneau dans les horaires", () => {
    // Mardi 5 mai 2026 — jour ouvré non férié
    const start = localDate(2026, 5, 5, 10, 0);
    const end = localDate(2026, 5, 5, 11, 30);
    expect(isWithinOpeningHours(start, end, STANDARD)).toEqual({ ok: true });
  });

  it("refuse si fin avant début", () => {
    const start = localDate(2026, 5, 5, 11, 0);
    const end = localDate(2026, 5, 5, 10, 0);
    const result = isWithinOpeningHours(start, end, STANDARD);
    expect(result.ok).toBe(false);
  });

  it("refuse si chevauche minuit (jours différents)", () => {
    const start = localDate(2026, 5, 5, 22, 0);
    const end = localDate(2026, 5, 6, 1, 0);
    const result = isWithinOpeningHours(start, end, STANDARD);
    expect(result.ok).toBe(false);
  });

  it("refuse les jours fermés (samedi)", () => {
    const start = localDate(2026, 5, 9, 10, 0); // samedi
    const end = localDate(2026, 5, 9, 11, 0);
    const result = isWithinOpeningHours(start, end, STANDARD);
    expect(result.ok).toBe(false);
  });

  it("refuse les créneaux hors plage (avant ouverture)", () => {
    const start = localDate(2026, 5, 5, 7, 0);
    const end = localDate(2026, 5, 5, 9, 0);
    const result = isWithinOpeningHours(start, end, STANDARD);
    expect(result.ok).toBe(false);
  });

  it("refuse pendant la pause déjeuner mercredi", () => {
    const start = localDate(2026, 5, 6, 12, 30);
    const end = localDate(2026, 5, 6, 13, 0);
    const result = isWithinOpeningHours(start, end, STANDARD);
    expect(result.ok).toBe(false);
  });

  it("accepte avant la pause déjeuner mercredi", () => {
    const start = localDate(2026, 5, 6, 9, 0);
    const end = localDate(2026, 5, 6, 12, 0);
    expect(isWithinOpeningHours(start, end, STANDARD)).toEqual({ ok: true });
  });

  it("refuse les jours fériés FR (1er mai 2026)", () => {
    const start = localDate(2026, 5, 1, 10, 0);
    const end = localDate(2026, 5, 1, 11, 0);
    const result = isWithinOpeningHours(start, end, STANDARD);
    expect(result.ok).toBe(false);
  });
});

describe("isValidOpeningHours", () => {
  it("accepte un objet bien formé", () => {
    expect(isValidOpeningHours(STANDARD)).toBe(true);
  });

  it("accepte un objet avec tous les jours fermés", () => {
    expect(
      isValidOpeningHours({
        mon: [],
        tue: [],
        wed: [],
        thu: [],
        fri: [],
        sat: [],
        sun: [],
      })
    ).toBe(true);
  });

  it("refuse un format heure invalide", () => {
    expect(
      isValidOpeningHours({
        mon: [{ from: "25:00", to: "30:00" }],
        tue: [],
        wed: [],
        thu: [],
        fri: [],
        sat: [],
        sun: [],
      })
    ).toBe(false);
  });

  it("refuse si un jour manque", () => {
    expect(
      isValidOpeningHours({
        mon: [{ from: "08:00", to: "19:00" }],
      })
    ).toBe(false);
  });

  it("refuse non-objet", () => {
    expect(isValidOpeningHours(null)).toBe(false);
    expect(isValidOpeningHours("foo")).toBe(false);
    expect(isValidOpeningHours(42)).toBe(false);
  });
});

describe("computeAvailability", () => {
  it("renvoie des slots libres quand aucun booking", () => {
    const from = localDate(2026, 5, 5, 0, 0);
    const to = localDate(2026, 5, 5, 23, 59);
    const slots = computeAvailability(from, to, STANDARD, []);
    expect(slots.length).toBe(1);
  });

  it("retire un booking existant en milieu de journée", () => {
    const from = localDate(2026, 5, 5, 0, 0);
    const to = localDate(2026, 5, 5, 23, 59);
    const slots = computeAvailability(from, to, STANDARD, [
      {
        startAt: localDate(2026, 5, 5, 10, 0),
        endAt: localDate(2026, 5, 5, 12, 0),
      },
    ]);
    // 8-10 + 12-19 → 2 slots
    expect(slots.length).toBe(2);
  });

  it("ne propose rien sur un samedi", () => {
    const from = localDate(2026, 5, 9, 0, 0);
    const to = localDate(2026, 5, 9, 23, 59);
    const slots = computeAvailability(from, to, STANDARD, []);
    expect(slots.length).toBe(0);
  });

  it("ne propose rien sur un jour férié", () => {
    const from = localDate(2026, 5, 1, 0, 0);
    const to = localDate(2026, 5, 1, 23, 59);
    const slots = computeAvailability(from, to, STANDARD, []);
    expect(slots.length).toBe(0);
  });

  it("gère plusieurs bookings consécutifs", () => {
    const from = localDate(2026, 5, 5, 0, 0);
    const to = localDate(2026, 5, 5, 23, 59);
    const slots = computeAvailability(from, to, STANDARD, [
      {
        startAt: localDate(2026, 5, 5, 9, 0),
        endAt: localDate(2026, 5, 5, 10, 30),
      },
      {
        startAt: localDate(2026, 5, 5, 11, 0),
        endAt: localDate(2026, 5, 5, 12, 0),
      },
    ]);
    // 8-9, 10:30-11, 12-19 → 3 slots
    expect(slots.length).toBe(3);
  });

  it("gère mercredi avec pause déjeuner et un booking", () => {
    const from = localDate(2026, 5, 6, 0, 0);
    const to = localDate(2026, 5, 6, 23, 59);
    const slots = computeAvailability(from, to, STANDARD, [
      {
        startAt: localDate(2026, 5, 6, 14, 0),
        endAt: localDate(2026, 5, 6, 15, 0),
      },
    ]);
    // matin: 8-12, après-midi: 13:30-14, 15-19 → 3 slots
    expect(slots.length).toBe(3);
  });
});
