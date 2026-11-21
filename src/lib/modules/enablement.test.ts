import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("./toggle", () => ({
  getModuleToggles: vi.fn(),
}));

import { isModuleActive } from "./enablement";
import { resetHooksForTests } from "./hooks";
import { getModuleToggles } from "./toggle";
import { getModuleManifests } from "./registry";

const mockToggles = getModuleToggles as unknown as ReturnType<typeof vi.fn>;

/** Tous les modules du registre activés : seul l'entitlement discrimine. */
function allTogglesOn(): Record<string, boolean> {
  return Object.fromEntries(getModuleManifests().map((m) => [m.id, true]));
}

beforeEach(() => {
  vi.clearAllMocks();
  resetHooksForTests();
  mockToggles.mockResolvedValue(allTogglesOn());
});

describe("enablement_treats_null_entitlements_as_all_authorized", () => {
  it("hook neutre : crm et un module sous licence (ldap) sont actifs sans licence", async () => {
    await expect(isModuleActive("crm")).resolves.toBe(true);
    await expect(isModuleActive("ldap", "org-1")).resolves.toBe(true);
  });

  it("hook neutre : un toggle desactive reste respecte", async () => {
    mockToggles.mockResolvedValue({ ...allTogglesOn(), ldap: false });
    await expect(isModuleActive("ldap")).resolves.toBe(false);
  });
});
