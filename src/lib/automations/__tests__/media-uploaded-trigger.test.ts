import { describe, it, expect } from "vitest";
import { interpolate } from "../interpolate";
import { extractTemplateVariables, scanMarkdownPlaceholders } from "../template-variables";

// Décision de rattachement : `media_uploaded` est un déclencheur AUTONOME
// (comme manual et webhook_inbound) : databaseId nul, spaceId d'ancrage, donc
// organisation = celle de l'espace d'ancrage (resolveAutomationAnchor).
describe("variables de gabarit du déclencheur média ajouté", () => {
  const ctx = {
    event: "media_uploaded",
    media: { id: "m1", filename: "logo.png", spaceId: "s1", url: "/api/media/m1" },
  };
  it("interpole media.filename, media.url, media.spaceId, media.id", () => {
    expect(interpolate("{{media.filename}} {{media.url}} {{media.spaceId}} {{media.id}}", ctx)).toBe(
      "logo.png /api/media/m1 s1 m1"
    );
  });
  it("média hors espace : spaceId vide, sans média : vide", () => {
    expect(interpolate("[{{media.spaceId}}]", { media: { id: "m", filename: "f", spaceId: "", url: "u" } })).toBe("[]");
    expect(interpolate("[{{media.filename}}]", {})).toBe("[]");
  });
  it("media.* est un préfixe réservé : pas pris pour un placeholder de gabarit", () => {
    expect(scanMarkdownPlaceholders("Bonjour {{media.filename}} {{titre}}").map((v) => v.key)).toEqual(["titre"]);
    expect(extractTemplateVariables(null)).toEqual([]);
  });
});
