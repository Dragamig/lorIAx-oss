import { describe, it, expect } from "vitest";
import { buildMonthGrid, ymd } from "@/components/bases/calendar-view";

describe("buildMonthGrid", () => {
  it("retourne toujours 42 cellules (6 semaines × 7 jours)", () => {
    expect(buildMonthGrid(2026, 0).length).toBe(42);
    expect(buildMonthGrid(2026, 1).length).toBe(42);
    expect(buildMonthGrid(2026, 11).length).toBe(42);
  });

  it("commence par un lundi", () => {
    const grid = buildMonthGrid(2026, 5);
    // (getDay() + 6) % 7 === 0 si lundi
    expect((grid[0].date.getDay() + 6) % 7).toBe(0);
  });

  it("contient le 1er du mois demandé", () => {
    const grid = buildMonthGrid(2026, 5);
    const first = grid.find((c) => c.date.getMonth() === 5 && c.date.getDate() === 1);
    expect(first).toBeDefined();
  });

  it("mai 2026 commence le vendredi 1er → 4 jours d'avril en tête (lundi-jeudi)", () => {
    const grid = buildMonthGrid(2026, 4); // mai
    // 1er mai 2026 = vendredi → position 4 dans la grille (lun=0, mar=1, mer=2, jeu=3, ven=4)
    expect(grid[4].date.getMonth()).toBe(4);
    expect(grid[4].date.getDate()).toBe(1);
    expect(grid[0].date.getMonth()).toBe(3); // avril
  });
});

describe("ymd", () => {
  it("formate yyyy-mm-dd avec zéros", () => {
    expect(ymd(new Date(2026, 0, 5))).toBe("2026-01-05");
    expect(ymd(new Date(2026, 11, 31))).toBe("2026-12-31");
  });
});
