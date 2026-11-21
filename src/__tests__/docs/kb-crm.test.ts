import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const root = process.cwd();
const kb = readFileSync(join(root, "docs/kb/11-crm.md"), "utf8");

describe("KB et changelog du noyau du module CRM", () => {
  it("la KB contient les titres des sections attendues", () => {
    for (const h of [
      "## Ce que le module contient",
      "## Activer et désactiver",
      "## Raccordement",
      "### Association automatique",
      "### Validation par type de colonne",
      "## Ce qui n'est pas dans le module",
    ]) {
      expect(kb).toContain(h);
    }
  });

  it("KB et changelog sans tiret cadratin ni demi-cadratin", () => {
    expect(kb).not.toMatch(/[—–]/);
  });
});
