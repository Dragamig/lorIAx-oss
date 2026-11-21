import { describe, it, expect } from "vitest";
import {
  detectCycleFromEdges,
  buildEventTree,
  dateToX,
} from "@/components/gantt/gantt-utils";
import { createZoomConfigs } from "@/components/gantt/types";

// Default zoom configs for tests (locale-agnostic English)
const ZOOM_CONFIGS = createZoomConfigs("en", "W");

describe("detectCycleFromEdges", () => {
  it("retourne false pour un graphe sans cycle", () => {
    const deps = [
      { sourceEventId: "a", targetEventId: "b" },
      { sourceEventId: "b", targetEventId: "c" },
    ];
    expect(detectCycleFromEdges(deps, "c", "d")).toBe(false);
  });

  it("retourne true pour un cycle direct", () => {
    const deps = [
      { sourceEventId: "a", targetEventId: "b" },
    ];
    expect(detectCycleFromEdges(deps, "b", "a")).toBe(true);
  });

  it("retourne true pour un cycle indirect", () => {
    const deps = [
      { sourceEventId: "a", targetEventId: "b" },
      { sourceEventId: "b", targetEventId: "c" },
    ];
    expect(detectCycleFromEdges(deps, "c", "a")).toBe(true);
  });
});

describe("buildEventTree", () => {
  it("construit un arbre à partir d'événements plats", () => {
    const events = [
      { id: "1", parentEventId: null, title: "Parent" },
      { id: "2", parentEventId: "1", title: "Enfant" },
    ];
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const tree = buildEventTree(events as any);
    expect(tree).toHaveLength(1);
    expect(tree[0].children).toHaveLength(1);
  });
});

describe("dateToX", () => {
  it("convertit une date en position X selon le zoom semaine", () => {
    const start = new Date("2026-03-10");
    const date = new Date("2026-03-12");
    const x = dateToX(date, start, ZOOM_CONFIGS.week);
    // 2 jours × columnWidth(36) = 72
    expect(x).toBe(72);
  });
});
