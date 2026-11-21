import { describe, it, expect } from "vitest";
import {
  MODULES_BY_PLAN,
  getEntitledModuleIds,
  getSellableCatalog,
} from "./catalog";

describe("MODULES_BY_PLAN", () => {
  it("enterprise inclut tout le socle growth (cumul)", () => {
    for (const id of MODULES_BY_PLAN.growth) {
      expect(MODULES_BY_PLAN.enterprise).toContain(id);
    }
  });

  it("toute dépendance d'un module de socle est dans le socle ou core", () => {
    const catalog = getSellableCatalog();
    const coreIds = new Set(
      catalog.filter((m) => m.class === "core").map((m) => m.id)
    );
    for (const plan of ["growth", "enterprise"] as const) {
      const socle = new Set<string>(MODULES_BY_PLAN[plan]);
      for (const id of MODULES_BY_PLAN[plan]) {
        const m = catalog.find((c) => c.id === id)!;
        for (const dep of m.dependencies) {
          expect(socle.has(dep) || coreIds.has(dep)).toBe(true);
        }
      }
    }
  });
});

describe("getEntitledModuleIds", () => {
  it("free seul = aucun module licensed", () => {
    expect(getEntitledModuleIds("free")).toEqual(new Set());
  });
  it("growth inclut son socle", () => {
    expect(getEntitledModuleIds("growth").has("ai")).toBe(true);
    expect(getEntitledModuleIds("growth").has("livekit")).toBe(true);
  });
  it("add-on ajoute par-dessus le socle", () => {
    const ids = getEntitledModuleIds("free", ["studio"]);
    expect(ids.has("studio")).toBe(true);
  });
});

describe("getSellableCatalog", () => {
  it("classe core/licensed alignée sur l'entitlement des manifestes", () => {
    const catalog = getSellableCatalog();
    const collab = catalog.find((m) => m.id === "collab")!;
    const studio = catalog.find((m) => m.id === "studio")!;
    const ldap = catalog.find((m) => m.id === "ldap")!;
    expect(collab.class).toBe("core");
    expect(studio.class).toBe("core"); // canvas design gratuit, comme le tableau blanc
    expect(studio.planFloor).toBeNull();
    expect(ldap.class).toBe("licensed");
    expect(ldap.planFloor).toBe("enterprise");
  });
});
