import { describe, it, expect } from "vitest";
import { parseFrontmatter, chunkMarkdown, hashChunk, kbFetchLimit } from "./kb";

describe("parseFrontmatter", () => {
  it("extrait le titre entre guillemets doubles et retire le bloc", () => {
    const raw = `---\ntitle: "Mon titre"\ndescription: "Desc"\n---\nCorps du document.`;
    const { title, body } = parseFrontmatter(raw);
    expect(title).toBe("Mon titre");
    expect(body).toBe("Corps du document.");
  });

  it("gère un titre sans guillemets", () => {
    const raw = `---\ntitle: Sans guillemets\n---\nTexte.`;
    const { title, body } = parseFrontmatter(raw);
    expect(title).toBe("Sans guillemets");
    expect(body).toBe("Texte.");
  });

  it("gère les guillemets simples", () => {
    const raw = `---\ntitle: 'Avec apostrophes'\n---\nTexte.`;
    const { title } = parseFrontmatter(raw);
    expect(title).toBe("Avec apostrophes");
  });

  it("renvoie title=null et body=raw sans frontmatter", () => {
    const raw = `Pas de frontmatter ici.\n\nDeuxième paragraphe.`;
    const { title, body } = parseFrontmatter(raw);
    expect(title).toBeNull();
    expect(body).toBe(raw);
  });

  it("renvoie title=null si le frontmatter n'a pas de champ title", () => {
    const raw = `---\ndescription: "rien d'autre"\n---\nCorps.`;
    const { title, body } = parseFrontmatter(raw);
    expect(title).toBeNull();
    expect(body).toBe("Corps.");
  });
});

describe("chunkMarkdown", () => {
  it("regroupe les paragraphes courts dans un seul chunk", () => {
    const text = `Para un.\n\nPara deux.\n\nPara trois.`;
    const chunks = chunkMarkdown(text, 1500);
    expect(chunks).toHaveLength(1);
    expect(chunks[0]).toBe("Para un.\n\nPara deux.\n\nPara trois.");
  });

  it("démarre un nouveau chunk quand maxChars est dépassé", () => {
    const p = "x".repeat(100);
    const text = `${p}\n\n${p}\n\n${p}`;
    const chunks = chunkMarkdown(text, 150);
    // Chaque paragraphe (100) + séparateur (102) > 150 → un chunk par paragraphe.
    expect(chunks).toHaveLength(3);
    chunks.forEach((c) => expect(c.length).toBeLessThanOrEqual(150));
  });

  it("respecte la frontière des paragraphes en accumulant", () => {
    const text = `aaaa\n\nbbbb\n\ncccc\n\ndddd`;
    const chunks = chunkMarkdown(text, 12);
    // "aaaa\n\nbbbb" = 10 <= 12, ajouter cccc dépasserait → nouveau chunk.
    expect(chunks).toEqual(["aaaa\n\nbbbb", "cccc\n\ndddd"]);
  });

  it("coupe brutalement un paragraphe plus long que maxChars", () => {
    const giant = "y".repeat(50);
    const chunks = chunkMarkdown(giant, 20);
    expect(chunks).toHaveLength(3);
    expect(chunks[0].length).toBe(20);
    expect(chunks[1].length).toBe(20);
    expect(chunks[2].length).toBe(10);
    expect(chunks.join("")).toBe(giant);
  });

  it("ne produit aucun chunk vide", () => {
    const text = `\n\n\n\nContenu.\n\n\n\n`;
    const chunks = chunkMarkdown(text);
    expect(chunks).toEqual(["Contenu."]);
    chunks.forEach((c) => expect(c.length).toBeGreaterThan(0));
  });

  it("renvoie un tableau vide pour un texte vide", () => {
    expect(chunkMarkdown("")).toEqual([]);
    expect(chunkMarkdown("   \n\n  ")).toEqual([]);
  });
});

describe("kbFetchLimit", () => {
  it("plafonne le sur-echantillonnage a dix, sous le plafond generique de 40", () => {
    // Sans plafond specifique a la KB, fetchLimitForRerank(5) rendrait 20.
    expect(kbFetchLimit(5)).toBe(10);
  });

  it("ne descend jamais sous la limite demandee", () => {
    expect(kbFetchLimit(15)).toBe(15);
  });
});

describe("hashChunk", () => {
  it("est déterministe", () => {
    expect(hashChunk("bonjour")).toBe(hashChunk("bonjour"));
  });

  it("change quand le texte change", () => {
    expect(hashChunk("bonjour")).not.toBe(hashChunk("bonjour!"));
  });

  it("renvoie un sha256 hex (64 caractères)", () => {
    expect(hashChunk("test")).toMatch(/^[0-9a-f]{64}$/);
  });
});
