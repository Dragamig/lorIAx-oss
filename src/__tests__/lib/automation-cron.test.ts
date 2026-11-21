import { describe, it, expect } from "vitest";
import { isValidCron, describeCron, nextCronOccurrence, isCronDue } from "@/lib/automations/cron";

describe("helpers cron", () => {
  it("valide une expression correcte et rejette une invalide", () => {
    expect(isValidCron("0 9 * * *")).toBe(true);
    expect(isValidCron("pas une expression")).toBe(false);
  });

  it("décrit une expression en français", () => {
    expect(describeCron("0 9 * * *").toLowerCase()).toContain("09:00");
  });

  it("calcule la prochaine occurrence après une date donnée", () => {
    const from = new Date("2026-07-04T08:00:00.000Z");
    const next = nextCronOccurrence("0 9 * * *", from);
    expect(next?.toISOString()).toBe("2026-07-04T09:00:00.000Z");
  });

  it("isCronDue : vrai quand une occurrence tombe dans (lastRunAt, now]", () => {
    const last = new Date("2026-07-04T08:59:00.000Z");
    const now = new Date("2026-07-04T09:00:30.000Z");
    expect(isCronDue("0 9 * * *", last, now)).toBe(true);
  });

  it("isCronDue : faux quand aucune occurrence dans la fenêtre", () => {
    const last = new Date("2026-07-04T09:00:30.000Z");
    const now = new Date("2026-07-04T09:01:00.000Z");
    expect(isCronDue("0 9 * * *", last, now)).toBe(false);
  });

  it("isCronDue : expression invalide → faux (pas d'exception)", () => {
    expect(isCronDue("nawak", null, new Date())).toBe(false);
  });
});
