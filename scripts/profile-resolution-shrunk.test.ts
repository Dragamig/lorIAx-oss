import { describe, it, expect, vi } from "vitest";

// Etat genere simulant la sortie du profil oss : commercial et studiovideo absents.
vi.mock("../src/lib/modules/registry.generated", () => ({
  INCLUDED_MODULE_IDS: ["crm", "collab"],
}));

import { getModuleManifests } from "../src/lib/modules/registry";
import { registerProfileResolutionCases } from "./profile-resolution-shrunk.shared";

describe("resolution --profile depuis un etat genere reduit", () => {
  it("l'etat mocke est bien reduit", () => {
    expect(getModuleManifests().map((m) => m.id)).not.toContain("commercial");
  });

  registerProfileResolutionCases(["clients/oss.json"]);
});
