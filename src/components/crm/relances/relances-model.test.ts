import { describe, expect, it } from "vitest";
import type { RelanceItem, RelancesDto } from "@/lib/crm/relances";
import { placeRelance, setLastInteraction, snoozeTarget } from "./relances-model";

const item = (id: string, relance: string): RelanceItem => ({
  dealId: id,
  title: `D${id}`,
  status: null,
  contactName: null,
  contactOrg: null,
  relance,
  lastInteraction: null,
});
const dto = (): RelancesDto => ({
  groups: { late: [item("1", "2026-11-10")], today: [item("2", "2026-11-18")], week: [item("3", "2026-11-20")] },
  tasks: [],
  interactionTypes: [],
  canLog: true,
  mineAvailable: true,
  missing: [],
  canEdit: true,
});
const today = "2026-11-18";

describe("placeRelance", () => {
  it("retire le dossier quand la date est vide ou hors horizon", () => {
    expect(placeRelance(dto(), item("1", "2026-11-10"), null, today).groups.late).toEqual([]);
    expect(placeRelance(dto(), item("3", "2026-11-20"), "2026-12-30", today).groups.week).toEqual([]);
  });
  it("change de groupe selon la nouvelle date, sans doublon", () => {
    const next = placeRelance(dto(), item("1", "2026-11-10"), "2026-11-19", today);
    expect(next.groups.late).toEqual([]);
    expect(next.groups.week.map((i) => i.dealId)).toEqual(["1", "3"]);
    expect(placeRelance(next, item("1", "2026-11-19"), "2026-11-10", today).groups.late[0].relance).toBe("2026-11-10");
  });
  it("snoozeTarget part d'aujourd'hui pour une relance passée", () => {
    expect(snoozeTarget("2026-11-10", 7, today)).toBe("2026-11-25");
    expect(snoozeTarget("2026-11-20", 7, today)).toBe("2026-11-27");
  });
  it("setLastInteraction ne touche que le dossier visé", () => {
    const next = setLastInteraction(dto(), "2", { date: today, type: "Appel", title: "x" });
    expect(next.groups.today[0].lastInteraction?.title).toBe("x");
    expect(next.groups.week[0].lastInteraction).toBeNull();
  });
});
