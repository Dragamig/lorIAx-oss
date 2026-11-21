import { describe, it, expect } from "vitest";
import { generateTempPassword } from "./temp-password";

describe("generateTempPassword", () => {
  it("génère un mot de passe d'au moins 12 caractères", () => {
    expect(generateTempPassword().length).toBeGreaterThanOrEqual(12);
  });
  it("génère des mots de passe distincts", () => {
    expect(generateTempPassword()).not.toBe(generateTempPassword());
  });
  it("ne contient que des caractères du jeu autorisé", () => {
    expect(generateTempPassword()).toMatch(/^[A-Za-z0-9]+$/);
  });
});
