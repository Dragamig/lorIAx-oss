import { describe, it, expect } from "vitest";
import { renderCsv } from "@/lib/bases/export-encoders";

const COLUMNS = [
  { id: "c1", name: "Nom", type: "text", position: 0 },
  { id: "c2", name: "Quantité", type: "number", position: 1 },
  { id: "c3", name: "Actif", type: "checkbox", position: 2 },
  { id: "c4", name: "Tags", type: "select", position: 3 },
];

describe("renderCsv", () => {
  it("inclut le BOM UTF-8 pour ouverture Excel", () => {
    const csv = renderCsv(COLUMNS, []);
    expect(csv.charCodeAt(0)).toBe(0xfeff);
  });

  it("écrit la ligne d'en-tête avec les noms de colonnes", () => {
    const csv = renderCsv(COLUMNS, []);
    expect(csv).toContain("Nom,Quantité,Actif,Tags");
  });

  it("encode les valeurs simples", () => {
    const csv = renderCsv(COLUMNS, [
      { cells: { c1: "Alice", c2: 42, c3: true, c4: ["a", "b"] } },
    ]);
    expect(csv).toContain("Alice,42,vrai,a; b");
  });

  it("entoure de guillemets les valeurs avec virgule", () => {
    const csv = renderCsv(COLUMNS, [{ cells: { c1: "Smith, John" } }]);
    expect(csv).toContain('"Smith, John"');
  });

  it("double les guillemets internes (RFC 4180)", () => {
    const csv = renderCsv(COLUMNS, [{ cells: { c1: 'Il dit "hello"' } }]);
    expect(csv).toContain('"Il dit ""hello"""');
  });

  it("entoure les valeurs avec saut de ligne", () => {
    const csv = renderCsv(COLUMNS, [{ cells: { c1: "Ligne 1\nLigne 2" } }]);
    expect(csv).toContain('"Ligne 1\nLigne 2"');
  });

  it("rend les nulls comme vide", () => {
    const csv = renderCsv(COLUMNS, [{ cells: { c1: null, c2: undefined } }]);
    // Vérifie qu'on a bien "," "," "," sur la ligne (4 colonnes, valeurs vides)
    const lines = csv.split("\r\n");
    expect(lines[1]).toBe(",,,");
  });

  it("formate les booléens en fr (vrai/faux)", () => {
    const csv = renderCsv(COLUMNS, [
      { cells: { c3: true } },
      { cells: { c3: false } },
    ]);
    const lines = csv.split("\r\n");
    expect(lines[1].split(",")[2]).toBe("vrai");
    expect(lines[2].split(",")[2]).toBe("faux");
  });

  it("formate les attachments par filename", () => {
    const csv = renderCsv(
      [{ id: "f", name: "Fichiers", type: "attachment", position: 0 }],
      [{ cells: { f: [{ filename: "doc.pdf" }, { filename: "img.png" }] } }]
    );
    expect(csv).toContain("doc.pdf; img.png");
  });

  it("rend les nombres tels quels", () => {
    const csv = renderCsv(COLUMNS, [{ cells: { c2: 3.14 } }]);
    expect(csv).toContain(",3.14,");
  });
});
