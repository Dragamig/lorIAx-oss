/**
 * Documents des modèles LorIAx livrés avec l'application (lot 3bis, T3).
 *
 * Les 4 decks vivent dans le dépôt et sont copiés dans chaque organisation au
 * premier semis. Un document invalide casserait donc toutes les organisations
 * d'un coup : ce fichier vérifie que chacun passe `deckSchema`, compte au moins
 * 5 diapositives, n'emploie que des types d'éléments connus du moteur
 * vendorisé, et que ni les JSON ni le loader ne contiennent de tiret cadratin
 * (U+2014) ou demi-cadratin (U+2013).
 */
import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { deckSchema } from "@/lib/presentations/deck";
import { LORIAX_TEMPLATES } from "@/lib/presentations/templates";

const TEMPLATES_DIR = path.join(
  process.cwd(),
  "src/lib/presentations/templates"
);

const EXPECTED_SEED_KEYS = [
  "pitch",
  "meeting-notes",
  "training",
  "status-update",
];

/** Types que le moteur 1.0.19 sait rendre et que les modèles s'autorisent. */
const ALLOWED_ELEMENT_TYPES = new Set(["text", "shape", "table"]);

type Slide = { id?: unknown; elements?: { id?: unknown; type?: unknown }[] };

describe("modèles LorIAx : liste", () => {
  it("expose les 4 clés de semis attendues, sans doublon", () => {
    const keys = LORIAX_TEMPLATES.map((t) => t.seedKey);
    expect(new Set(keys).size).toBe(keys.length);
    expect([...keys].sort()).toEqual([...EXPECTED_SEED_KEYS].sort());
  });

  it("référence des clés i18n propres à chaque modèle", () => {
    for (const t of LORIAX_TEMPLATES) {
      expect(t.fileTitleKey).toBe(
        `presentations.templates.lorIAx.${t.seedKey}.name`
      );
      expect(t.fileDescriptionKey).toBe(
        `presentations.templates.lorIAx.${t.seedKey}.description`
      );
    }
  });

  it("a un fichier JSON par clé de semis, et aucun autre", () => {
    const files = readdirSync(TEMPLATES_DIR)
      .filter((f) => f.endsWith(".json"))
      .sort();
    expect(files).toEqual(EXPECTED_SEED_KEYS.map((k) => `${k}.json`).sort());
  });
});

describe.each(LORIAX_TEMPLATES.map((t) => [t.seedKey, t] as const))(
  "modèle LorIAx : %s",
  (_seedKey, template) => {
    const slides = template.deck.slides as Slide[];

    it("passe deckSchema", () => {
      expect(deckSchema.safeParse(template.deck).success).toBe(true);
    });

    it("compte entre 5 et 8 diapositives", () => {
      expect(slides.length).toBeGreaterThanOrEqual(5);
      expect(slides.length).toBeLessThanOrEqual(8);
    });

    it("porte un titre non vide", () => {
      expect(typeof template.deck.title).toBe("string");
      expect((template.deck.title as string).trim()).not.toBe("");
    });

    it("n'emploie que des types d'éléments connus du moteur", () => {
      for (const slide of slides) {
        expect(Array.isArray(slide.elements)).toBe(true);
        for (const el of slide.elements ?? []) {
          expect(ALLOWED_ELEMENT_TYPES.has(el.type as string)).toBe(true);
        }
      }
    });

    it("a des identifiants de diapositive et d'élément uniques", () => {
      const slideIds = slides.map((s) => s.id);
      expect(new Set(slideIds).size).toBe(slideIds.length);
      const elementIds = slides.flatMap((s) =>
        (s.elements ?? []).map((e) => e.id)
      );
      expect(elementIds.every((id) => typeof id === "string" && id)).toBe(true);
      expect(new Set(elementIds).size).toBe(elementIds.length);
    });
  }
);

describe("modèles LorIAx : typographie", () => {
  const files = readdirSync(TEMPLATES_DIR).filter(
    (f) => f.endsWith(".json") || f.endsWith(".ts")
  );

  it.each(files)("%s ne contient ni U+2014 ni U+2013", (file) => {
    const raw = readFileSync(path.join(TEMPLATES_DIR, file), "utf8");
    expect(raw.includes("—")).toBe(false);
    expect(raw.includes("–")).toBe(false);
  });
});
