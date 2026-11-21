import { describe, it, expect } from "vitest";
import {
  hasCellChanged,
  shouldFireValueChanged,
} from "@/lib/automations/value-changed";

describe("hasCellChanged", () => {
  it("traite null / undefined / chaîne vide comme équivalents (pas de changement)", () => {
    expect(hasCellChanged(null, "")).toBe(false);
    expect(hasCellChanged(undefined, null)).toBe(false);
    expect(hasCellChanged("", undefined)).toBe(false);
  });

  it("détecte un changement de valeur scalaire", () => {
    expect(hasCellChanged("En cours", "Terminé")).toBe(true);
    expect(hasCellChanged(1, 2)).toBe(true);
  });

  it("ne détecte pas de changement pour des valeurs égales", () => {
    expect(hasCellChanged("Terminé", "Terminé")).toBe(false);
    expect(hasCellChanged(3, "3")).toBe(false); // normalisation via String()
  });

  it("compare les tableaux via leur forme JSON (ordre significatif)", () => {
    expect(hasCellChanged(["a", "b"], ["a", "b"])).toBe(false);
    expect(hasCellChanged(["a", "b"], ["b", "a"])).toBe(true);
    expect(hasCellChanged([], "")).toBe(false);
  });
});

describe("shouldFireValueChanged", () => {
  const before = { col1: "En cours", col2: "x" };

  it("renvoie false si columnId absent de la config", () => {
    expect(shouldFireValueChanged(before, { col1: "Terminé" }, {})).toBe(false);
  });

  it("renvoie false si la colonne surveillée n'a pas changé", () => {
    expect(
      shouldFireValueChanged(before, { col1: "En cours", col2: "y" }, { columnId: "col1" })
    ).toBe(false);
  });

  it("renvoie true sur tout changement de la colonne quand aucune condition", () => {
    expect(
      shouldFireValueChanged(before, { col1: "Terminé" }, { columnId: "col1" })
    ).toBe(true);
  });

  it("applique la condition sur la NOUVELLE valeur (déclenche si elle passe)", () => {
    expect(
      shouldFireValueChanged(
        before,
        { col1: "Terminé" },
        { columnId: "col1", operator: "is", value: "Terminé" }
      )
    ).toBe(true);
  });

  it("ne déclenche pas si la colonne change mais la condition échoue", () => {
    expect(
      shouldFireValueChanged(
        before,
        { col1: "Annulé" },
        { columnId: "col1", operator: "is", value: "Terminé" }
      )
    ).toBe(false);
  });
});
