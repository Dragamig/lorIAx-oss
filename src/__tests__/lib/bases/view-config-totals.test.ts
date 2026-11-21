import { describe, it, expect } from "vitest";
import { viewConfigSchema } from "@/lib/bases/view-config";

const valid = {
  amountColumnId: "col-amount",
  closedLanes: ["won"],
  weights: { open: 40, won: 100 },
  currency: "EUR",
  showWeighted: true,
};
const parse = (kanbanTotals: unknown) => viewConfigSchema.safeParse({ kanbanTotals });

describe("viewConfigSchema.kanbanTotals", () => {
  it("config valide acceptée", () => {
    const r = parse(valid);
    expect(r.success).toBe(true);
  });
  it("poids 101 rejeté", () => {
    expect(parse({ ...valid, weights: { a: 101 } }).success).toBe(false);
  });
  it("poids -1 rejeté", () => {
    expect(parse({ ...valid, weights: { a: -1 } }).success).toBe(false);
  });
  it("poids 40.5 rejeté", () => {
    expect(parse({ ...valid, weights: { a: 40.5 } }).success).toBe(false);
  });
  it('poids "40" (chaîne) rejeté', () => {
    expect(parse({ ...valid, weights: { a: "40" } }).success).toBe(false);
  });
  it('devise "eur" ou "EURO" rejetée', () => {
    expect(parse({ ...valid, currency: "eur" }).success).toBe(false);
    expect(parse({ ...valid, currency: "EURO" }).success).toBe(false);
  });
  it("amountColumnId vide rejeté", () => {
    expect(parse({ ...valid, amountColumnId: "" }).success).toBe(false);
  });
  it("kanbanTotals null accepté", () => {
    expect(parse(null).success).toBe(true);
  });
  it("absence de kanbanTotals acceptée", () => {
    expect(viewConfigSchema.safeParse({}).success).toBe(true);
  });
  it("clés inconnues et clés historiques conservées (passthrough)", () => {
    const r = viewConfigSchema.safeParse({ kanbanTotals: valid, sorts: [1], foo: "bar" });
    expect(r.success).toBe(true);
    if (r.success) expect(r.data).toMatchObject({ sorts: [1], foo: "bar" });
  });
  it('closedLanes avec "" (voie Sans valeur) accepté', () => {
    expect(parse({ ...valid, closedLanes: [""] }).success).toBe(true);
  });
  it("défauts weights et closedLanes", () => {
    const r = parse({ amountColumnId: "c", showWeighted: false });
    expect(r.success).toBe(true);
    if (r.success) expect(r.data.kanbanTotals).toMatchObject({ weights: {}, closedLanes: [] });
  });
});
