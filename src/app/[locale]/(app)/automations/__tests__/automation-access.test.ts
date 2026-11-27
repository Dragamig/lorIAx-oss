import { describe, expect, it } from "vitest";
import { canManageSpaceAutomations } from "../automation-access";

describe("canManageSpaceAutomations (mêmes gardes que l'API)", () => {
  it("refuse un éditeur de l'espace sans rôle de gestion", () => {
    expect(canManageSpaceAutomations({ globalRole: "editor", capabilities: [] }, "editor")).toBe(false);
    expect(canManageSpaceAutomations({ globalRole: "editor", capabilities: [] }, "admin")).toBe(false);
  });

  it("accepte admin, super admin et le badge gestionnaire d'automatisations", () => {
    expect(canManageSpaceAutomations({ globalRole: "admin", capabilities: [] }, "editor")).toBe(true);
    expect(canManageSpaceAutomations({ globalRole: "super_admin", capabilities: [] }, "editor")).toBe(true);
    expect(
      canManageSpaceAutomations({ globalRole: "editor", capabilities: ["automation_manager"] }, "editor")
    ).toBe(true);
  });

  it("refuse sans droit d'édition sur l'espace, même avec le rôle", () => {
    expect(canManageSpaceAutomations({ globalRole: "admin", capabilities: [] }, "viewer")).toBe(false);
    expect(canManageSpaceAutomations({ globalRole: "admin", capabilities: [] }, null)).toBe(false);
  });

  it("tolère des capacités absentes", () => {
    expect(canManageSpaceAutomations({ globalRole: "editor", capabilities: null }, "editor")).toBe(false);
  });
});
