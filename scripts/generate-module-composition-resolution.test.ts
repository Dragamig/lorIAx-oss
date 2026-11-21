import { describe, it, expect, vi } from "vitest";

// Etat genere simulant la sortie du profil oss : commercial et studiovideo absents.
vi.mock("../src/lib/modules/registry.generated", () => ({
  INCLUDED_MODULE_IDS: ["crm", "collab"],
}));

import { includedIds } from "./generate-module-composition";
import { getAllModuleManifests, getModuleManifests } from "../src/lib/modules/registry";

describe("resolution de la composition", () => {
  it("all_resolves_from_full_registry_even_when_generated_state_lacks_modules", () => {
    expect(getModuleManifests().map((m) => m.id)).not.toContain("commercial");
    const ids = includedIds(["--all"]);
    expect(ids).toEqual(getAllModuleManifests().map((m) => m.id));
    expect(ids).toContain("commercial");
    expect(ids).toContain("studiovideo");
  });
});
