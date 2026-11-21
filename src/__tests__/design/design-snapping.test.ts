import { describe, it, expect } from "vitest";
import { snapToPage } from "@/components/editor/extensions/design-snapping";

const page = { width: 1000, height: 800 };

describe("snapToPage", () => {
  it("aimante le centre de l'objet au centre vertical de la page", () => {
    // objet 100 de large, left 452 → centre 502, centre page 500 → dx = -2
    const r = snapToPage({ left: 452, top: 300, width: 100, height: 50 }, page, 6);
    expect(r.dx).toBe(-2);
    expect(r.vLines).toContain(500);
  });

  it("aimante le bord gauche au bord de page", () => {
    const r = snapToPage({ left: 4, top: 300, width: 100, height: 50 }, page, 6);
    expect(r.dx).toBe(-4);
    expect(r.vLines).toContain(0);
  });

  it("aimante le bord droit au bord droit de page", () => {
    const r = snapToPage({ left: 897, top: 300, width: 100, height: 50 }, page, 6);
    expect(r.dx).toBe(3); // 897+100=997 → 1000
    expect(r.vLines).toContain(1000);
  });

  it("aimante verticalement (haut, centre, bas)", () => {
    expect(snapToPage({ left: 300, top: 3, width: 50, height: 50 }, page, 6).dy).toBe(-3);
    expect(snapToPage({ left: 300, top: 377, width: 50, height: 50 }, page, 6).dy).toBe(-2); // centre 402 → 400
    expect(snapToPage({ left: 300, top: 753, width: 50, height: 50 }, page, 6).dy).toBe(-3); // bas 803 → 800
  });

  it("ne snappe pas hors seuil", () => {
    const r = snapToPage({ left: 200, top: 200, width: 50, height: 50 }, page, 6);
    expect(r.dx).toBe(0);
    expect(r.dy).toBe(0);
    expect(r.vLines).toEqual([]);
    expect(r.hLines).toEqual([]);
  });

  it("snappe simultanément sur x et y", () => {
    // left 4 → bord gauche page (target 0) → dx -4 ; top 3 → bord haut page (target 0) → dy -3
    const r = snapToPage({ left: 4, top: 3, width: 100, height: 50 }, { width: 1000, height: 800 }, 6);
    expect(r.dx).toBe(-4);
    expect(r.dy).toBe(-3);
    expect(r.vLines).toContain(0);
    expect(r.hLines).toContain(0);
  });

  it("snappe exactement au seuil mais pas au-delà", () => {
    // left exactement égal au seuil → doit snapper (delta = -6)
    const atThreshold = snapToPage({ left: 6, top: 300, width: 50, height: 50 }, page, 6);
    expect(atThreshold.dx).toBe(-6);
    expect(atThreshold.vLines).toContain(0);

    // left juste au-delà du seuil → ne snappe pas
    const beyondThreshold = snapToPage({ left: 7, top: 300, width: 50, height: 50 }, page, 6);
    expect(beyondThreshold.dx).toBe(0);
    expect(beyondThreshold.vLines).toEqual([]);
  });
});
