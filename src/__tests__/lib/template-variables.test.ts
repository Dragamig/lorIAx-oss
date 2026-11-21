import { describe, it, expect } from "vitest";
import { extractTemplateVariables, scanMarkdownPlaceholders } from "@/lib/automations/template-variables";

const doc = {
  type: "doc",
  content: [
    { type: "paragraph", content: [
      { type: "text", text: "Bonjour " },
      { type: "templateVariable", attrs: { key: "prenom", label: "Prénom" } },
      { type: "text", text: " — dossier " },
      { type: "templateVariable", attrs: { key: "dossier", label: "N° dossier" } },
    ]},
    { type: "paragraph", content: [
      { type: "templateVariable", attrs: { key: "prenom", label: "Prénom" } },
    ]},
  ],
};

describe("extraction des placeholders de template", () => {
  it("collecte les nœuds templateVariable, dédupliqués par clé", () => {
    expect(extractTemplateVariables(doc)).toEqual([
      { key: "prenom", label: "Prénom" },
      { key: "dossier", label: "N° dossier" },
    ]);
  });

  it("gère un contenu vide/absent", () => {
    expect(extractTemplateVariables(null)).toEqual([]);
    expect(extractTemplateVariables({})).toEqual([]);
  });

  it("repli markdown : extrait les {{clé}} hors préfixes réservés", () => {
    const md = "Bonjour {{prenom}}, cellule {{cells.abc}}, user {{user.id}}, {{prenom}}";
    expect(scanMarkdownPlaceholders(md)).toEqual([{ key: "prenom", label: "prenom" }]);
  });
});
