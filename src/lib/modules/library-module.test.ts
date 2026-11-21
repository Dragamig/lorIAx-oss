import { describe, it, expect } from "vitest";
import { getModuleManifest } from "./registry";
import { INCLUDED_MODULE_IDS } from "./registry.generated";

describe("module library", () => {
  it("est déclaré avec sa navigation et son interrupteur", () => {
    const m = getModuleManifest("library");
    expect(m).toBeDefined();
    expect(m?.nav[0].href).toBe("/mediatheque");
    expect(m?.toggleKey).toBe("library_enabled");
  });

  it("est inclus dans la composition", () => {
    expect(INCLUDED_MODULE_IDS).toContain("library");
  });
});
