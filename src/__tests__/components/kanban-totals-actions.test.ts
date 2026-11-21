import { describe, it, expect } from "vitest";
import { KANBAN_TOTALS_ACTIONS } from "@/components/bases/kanban-totals-menu";

describe("registre d'actions des totaux", () => {
  it("chaque action a un id unique, un libellé et une icône", () => {
    const ids = KANBAN_TOTALS_ACTIONS.map((a) => a.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const a of KANBAN_TOTALS_ACTIONS) {
      expect(a.label.length).toBeGreaterThan(0);
      expect(a.icon).toBeTruthy();
    }
    expect(ids).toEqual(
      expect.arrayContaining(["chooseAmount", "currency", "toggleWeighted", "toggleClosed", "setWeight", "disable"]),
    );
  });
});
