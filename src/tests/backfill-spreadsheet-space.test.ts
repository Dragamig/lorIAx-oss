/**
 * Logique de rattachement du backfill des tableurs : extraction du `sheetId`
 * depuis le markdown du document porteur.
 *
 * Le nœud TipTap `spreadsheetBlock` est atomique et sérialisé en HTML brut
 * (`tiptap-markdown` en `html: true`). La sérialisation DOM met les noms
 * d'attributs en minuscules : c'est `sheetid=` qui atterrit en base, jamais la
 * graphie `sheetId` du schéma de nœud. Ces cas verrouillent ce piège.
 */
import { describe, it, expect } from "vitest";
import { extractSheetLinks } from "../../scripts/backfill-spreadsheet-space";

const SHEET_A = "11111111-2222-4333-8444-555555555555";
const SHEET_B = "66666666-7777-4888-8999-aaaaaaaaaaaa";

function block(attrs: string): string {
  return `<div ${attrs} data-type="spreadsheet-block"></div>`;
}

describe("extractSheetLinks", () => {
  it("lit l'attribut sérialisé en minuscules", () => {
    const { links, conflicts } = extractSheetLinks([
      { id: "doc-1", contentText: `# Titre\n\n${block(`sheetid="${SHEET_A}" title="Budget"`)}` },
    ]);
    expect(links.get(SHEET_A)).toBe("doc-1");
    expect(conflicts).toHaveLength(0);
  });

  it("accepte aussi la graphie d'origine sheetId", () => {
    const { links } = extractSheetLinks([
      { id: "doc-1", contentText: block(`sheetId="${SHEET_A}"`) },
    ]);
    expect(links.get(SHEET_A)).toBe("doc-1");
  });

  it("se replie sur le premier UUID de la balise si l'attribut est absent", () => {
    const { links } = extractSheetLinks([
      { id: "doc-1", contentText: `<div data-sheet-id="${SHEET_A}" data-type="spreadsheet-block"></div>` },
    ]);
    expect(links.get(SHEET_A)).toBe("doc-1");
  });

  it("récupère plusieurs blocs dans un même document", () => {
    const { links } = extractSheetLinks([
      {
        id: "doc-1",
        contentText: `${block(`sheetid="${SHEET_A}"`)}\ntexte\n${block(`sheetid="${SHEET_B}"`)}`,
      },
    ]);
    expect(links.get(SHEET_A)).toBe("doc-1");
    expect(links.get(SHEET_B)).toBe("doc-1");
  });

  it("retient le document le plus ancien et journalise le conflit", () => {
    // Entrée triée du plus anciennement modifié au plus récent.
    const { links, conflicts } = extractSheetLinks([
      { id: "doc-ancien", contentText: block(`sheetid="${SHEET_A}"`) },
      { id: "doc-recent", contentText: block(`sheetid="${SHEET_A}"`) },
    ]);
    expect(links.get(SHEET_A)).toBe("doc-ancien");
    expect(conflicts).toHaveLength(1);
    expect(conflicts[0]).toContain("doc-ancien");
    expect(conflicts[0]).toContain("doc-recent");
  });

  it("ne signale pas de conflit pour deux blocs du même document", () => {
    const { conflicts } = extractSheetLinks([
      { id: "doc-1", contentText: block(`sheetid="${SHEET_A}"`).repeat(2) },
    ]);
    expect(conflicts).toHaveLength(0);
  });

  it("ignore un bloc neuf sans identifiant et le contenu vide", () => {
    const { links } = extractSheetLinks([
      { id: "doc-1", contentText: block('sheetid="null" title="Nouveau tableur"') },
      { id: "doc-2", contentText: null },
    ]);
    expect(links.size).toBe(0);
  });

  it("ignore les identifiants cités hors d'une balise de bloc", () => {
    const { links } = extractSheetLinks([
      { id: "doc-1", contentText: `Voir le tableur ${SHEET_A} dans l'autre espace.` },
    ]);
    expect(links.size).toBe(0);
  });
});
