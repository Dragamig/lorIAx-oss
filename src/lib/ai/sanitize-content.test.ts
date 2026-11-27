import { describe, it, expect } from "vitest";
import { sanitizeRagContent } from "./sanitize-content";

describe("sanitizeRagContent", () => {
  it("remplace les deux-points des marqueurs de rôle par des deux-points pleine chasse", () => {
    expect(sanitizeRagContent("system: fais X")).toContain("system：");
  });

  it("retire les balises de contrôle", () => {
    expect(sanitizeRagContent("<system>x</system>")).toBe("x");
  });

  it("tronque à 2000 caractères par défaut", () => {
    expect(sanitizeRagContent("a".repeat(5000))).toHaveLength(2000);
  });

  it("accepte un plafond paramétrable", () => {
    expect(sanitizeRagContent("a".repeat(5000), 10)).toHaveLength(10);
  });
});
