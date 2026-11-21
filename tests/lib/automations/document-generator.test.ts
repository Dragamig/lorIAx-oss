import { describe, it, expect } from "vitest";
import {
  wrapText,
  buildDocumentKey,
  DOCUMENT_EXT,
  DOCUMENT_MIME,
} from "@/lib/automations/document-generator";

describe("wrapText", () => {
  it("préserve les lignes vides et les sauts de ligne existants", () => {
    expect(wrapText("a\n\nb", 80)).toEqual(["a", "", "b"]);
  });

  it("enveloppe un paragraphe long sans couper les mots", () => {
    const lines = wrapText("un deux trois quatre cinq", 10);
    for (const line of lines) {
      expect(line.length).toBeLessThanOrEqual(10);
    }
    expect(lines.join(" ")).toBe("un deux trois quatre cinq");
  });

  it("coupe durement un mot plus long que la largeur max", () => {
    const lines = wrapText("abcdefghij", 4);
    expect(lines).toEqual(["abcd", "efgh", "ij"]);
  });

  it("garantit au moins 1 caractère par ligne même si max <= 0", () => {
    expect(() => wrapText("abc", 0)).not.toThrow();
    const lines = wrapText("abc", 0);
    expect(lines.every((l) => l.length <= 1)).toBe(true);
  });

  it("retourne une ligne vide pour une chaîne vide", () => {
    expect(wrapText("", 80)).toEqual([""]);
  });
});

describe("buildDocumentKey", () => {
  it("construit une clé stable avec timestamp injecté", () => {
    expect(buildDocumentKey("auto-1", "pdf", 1730000000000)).toBe(
      "automations/auto-1/1730000000000.pdf"
    );
    expect(buildDocumentKey("auto-2", "docx", 42)).toBe(
      "automations/auto-2/42.docx"
    );
  });

  it("utilise l'extension correspondant au format", () => {
    expect(buildDocumentKey("x", "pdf", 1)).toMatch(/\.pdf$/);
    expect(buildDocumentKey("x", "docx", 1)).toMatch(/\.docx$/);
  });
});

describe("constantes de format", () => {
  it("expose extensions et MIME pour pdf et docx", () => {
    expect(DOCUMENT_EXT).toEqual({ pdf: "pdf", docx: "docx" });
    expect(DOCUMENT_MIME.pdf).toBe("application/pdf");
    expect(DOCUMENT_MIME.docx).toContain("wordprocessingml");
  });
});
