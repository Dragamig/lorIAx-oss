import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const root = process.cwd();
const kb = readFileSync(join(root, "docs/kb/11-crm.md"), "utf8");

describe("KB du noyau du module CRM", () => {
  it("la KB contient les titres des sections attendues", () => {
    for (const h of [
      "## Ce que le module contient",
      "## Activer et désactiver",
      "## Raccordement",
      "### Association automatique",
      "### Validation par type de colonne",
      "## Pipeline",
      "## À relancer",
      "## Dossiers et vues enregistrées",
      "## Contacts",
      "## Fiche dossier",
      "## Menu et badge",
      "## Automatismes d'exemple",
      "### Réception Tally",
      "## Ce qui n'est pas dans le module",
    ]) {
      expect(kb).toContain(h);
    }
  });

  it("KB sans tiret cadratin ni demi-cadratin", () => {
    expect(kb).not.toMatch(/[\u2014\u2013]/);
  });

  it("la KB décrit les automatismes d'exemple", () => {
    expect(kb).toContain("Réception Tally");
    expect(kb).toContain("`X-Webhook-Secret`");
    expect(kb).toContain("désactivés");
    expect(kb).not.toContain("Les automatismes d'exemple ne sont pas disponibles");
  });
});
