import { describe, it, expect } from "vitest";
import { getModuleManifest, getModuleManifests } from "./registry";
import { INCLUDED_MODULE_IDS } from "./registry.generated";
import { getSellableCatalog } from "./catalog";
import { resolveModuleState } from "./resolve";
import { collectCapabilities } from "./capabilities";
import type { EnablementContext } from "./types";

const manifests = getModuleManifests();
const crm = getModuleManifest("crm")!;

function ctx(toggles: Record<string, boolean>): EnablementContext {
  return {
    compiled: new Set(manifests.map((m) => m.id)),
    entitledModuleIds: new Set(),
    toggles,
  };
}

describe("module crm", () => {
  it("est dans le registre : core, inactif par défaut, super_admin, contenu, icône briefcase distincte", () => {
    expect(crm).toBeDefined();
    expect(crm.entitlement).toBe("core");
    expect(crm.defaultEnabled).toBe(false);
    expect(crm.manageRole).toBe("super_admin");
    expect(crm.category).toBe("contenu");
    expect(crm.icon).toBe("briefcase");
    expect(manifests.filter((m) => !m.internal && m.icon === "briefcase")).toHaveLength(1);
    expect(crm.nav[0].href).toBe("/crm");
  });

  it("getSellableCatalog le classe core sans planFloor", () => {
    const entry = getSellableCatalog().find((m) => m.id === "crm");
    expect(entry?.class).toBe("core");
    expect(entry?.planFloor).toBeNull();
  });

  it("est actif sans licence quand le toggle d'instance est vrai", () => {
    expect(resolveModuleState(crm, ctx({ crm: true }), manifests).status).toBe("active");
  });

  it("est inactif sans toggle", () => {
    expect(resolveModuleState(crm, ctx({}), manifests).status).toBe("disabled");
  });

  it("est inclus dans la composition", () => {
    expect(INCLUDED_MODULE_IDS).toContain("crm");
  });

  it("est listé par les capacités actives quand actif", () => {
    expect(collectCapabilities(["crm"], manifests).modules).toContain("crm");
  });
});
