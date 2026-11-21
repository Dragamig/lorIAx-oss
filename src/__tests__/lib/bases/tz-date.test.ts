import { describe, it, expect, vi } from "vitest";
import {
  DEFAULT_SERVER_TZ,
  isValidTz,
  resolveServerTz,
  zonedParts,
  quarterOf,
  tzCacheSize,
  dayNumber,
} from "@/lib/bases/tz-date";

describe("tz-date", () => {
  it("zonedParts 2026-03-31T21:59:00Z en Europe/Paris : 31 mars", () => {
    const p = zonedParts(new Date("2026-03-31T21:59:00Z"), "Europe/Paris");
    expect([p.year, p.month, p.day]).toEqual([2026, 3, 31]);
  });
  it("zonedParts 2026-03-31T22:00:00Z en Europe/Paris : 1er avril", () => {
    const p = zonedParts(new Date("2026-03-31T22:00:00Z"), "Europe/Paris");
    expect([p.year, p.month, p.day]).toEqual([2026, 4, 1]);
  });
  it("trimestre : 31 mars 23:59 Paris est T1, 1er avril 00:00 Paris est T2", () => {
    expect(quarterOf(zonedParts(new Date("2026-03-31T21:59:00Z"), "Europe/Paris"))).toBe(1);
    expect(quarterOf(zonedParts(new Date("2026-03-31T22:00:00Z"), "Europe/Paris"))).toBe(2);
  });
  it("changement d'année : 2026-12-31T23:30:00Z vaut le 1er janvier 2027 à Paris", () => {
    const p = zonedParts(new Date("2026-12-31T23:30:00Z"), "Europe/Paris");
    expect([p.year, p.month, p.day]).toEqual([2027, 1, 1]);
  });
  it("même instant en Pacific/Auckland et en America/Los_Angeles : jours différents", () => {
    const d = new Date("2026-06-15T12:00:00Z");
    const a = zonedParts(d, "Pacific/Auckland");
    const l = zonedParts(d, "America/Los_Angeles");
    expect(a.day).toBe(16);
    expect(l.day).toBe(15);
  });
  it("resolveServerTz", () => {
    expect(resolveServerTz("Mars/Inconnu")).toBe("Europe/Paris");
    expect(resolveServerTz(undefined)).toBe("Europe/Paris");
    expect(resolveServerTz(null)).toBe(DEFAULT_SERVER_TZ);
    expect(resolveServerTz("America/New_York")).toBe("America/New_York");
  });
  it("isValidTz", () => {
    expect(isValidTz("")).toBe(false);
    expect(isValidTz(42)).toBe(false);
    expect(isValidTz("Europe/Paris")).toBe(true);
  });
  it("weekday correct pour un dimanche", () => {
    expect(zonedParts(new Date("2026-11-15T12:00:00Z"), "Europe/Paris").weekday).toBe(0);
    expect(zonedParts(new Date("2026-11-16T12:00:00Z"), "Europe/Paris").weekday).toBe(1);
  });
  it("dayNumber continu à travers le changement d'heure", () => {
    const a = dayNumber({ year: 2026, month: 3, day: 28 });
    const b = dayNumber({ year: 2026, month: 3, day: 29 });
    const c = dayNumber({ year: 2026, month: 3, day: 30 });
    expect(b - a).toBe(1);
    expect(c - b).toBe(1);
  });
});

describe("tz-date : cache borné", () => {
  it("chaîne de plus de 64 caractères : invalide, jamais mémorisée", () => {
    const before = tzCacheSize();
    expect(isValidTz("A".repeat(65))).toBe(false);
    expect(tzCacheSize()).toBe(before);
  });
  it("fuseaux invalides répétés : le cache ne grossit pas", () => {
    const before = tzCacheSize();
    for (let i = 0; i < 50; i++) expect(isValidTz(`Nope/Zone${i}`)).toBe(false);
    expect(tzCacheSize()).toBe(before);
  });
  it("fuseau valide mémorisé une fois", () => {
    expect(isValidTz("Asia/Tokyo")).toBe(true);
    const n = tzCacheSize();
    expect(isValidTz("Asia/Tokyo")).toBe(true);
    expect(tzCacheSize()).toBe(n);
  });
  it("variantes de casse d'un même fuseau : une seule entrée, nom canonique", async () => {
    vi.resetModules();
    const m = await import("@/lib/bases/tz-date");
    for (const v of ["europe/paris", "EUROPE/PARIS", "Europe/Paris", "eUrOpE/pArIs"]) {
      expect(m.isValidTz(v)).toBe(true);
      expect(m.resolveServerTz(v)).toBe("Europe/Paris");
    }
    expect(m.tzCacheSize()).toBe(1);
  });
  it("plafond dur : jamais plus de 100 entrées", async () => {
    vi.resetModules();
    const m = await import("@/lib/bases/tz-date");
    for (let h = 0; h < 24; h++) {
      for (let mi = 0; mi < 60; mi++) {
        m.isValidTz(`+${String(h).padStart(2, "0")}:${String(mi).padStart(2, "0")}`);
      }
    }
    expect(m.tzCacheSize()).toBeLessThanOrEqual(100);
    expect(m.isValidTz("Asia/Tokyo")).toBe(true);
    expect(m.tzCacheSize()).toBeLessThanOrEqual(100);
  });
});
