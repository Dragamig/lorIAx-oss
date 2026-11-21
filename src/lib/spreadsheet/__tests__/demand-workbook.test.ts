import { describe, it, expect } from "vitest";
import {
  buildDemandWorkbook,
  LINES_HEADERS,
  LINE_STATUSES,
  LINE_TYPES,
  REQUIREMENTS_HEADERS,
  REQUIREMENT_CATEGORIES,
} from "../demand-workbook";
import { isWorkbookData } from "../fortune-to-univer";

type Sheet = {
  id: string;
  name: string;
  cellData: Record<number, Record<number, { v?: unknown; f?: string; s?: string }>>;
  columnCount: number;
  freeze?: { xSplit: number; ySplit: number };
  columnData?: Record<number, { w: number }>;
};
type Wb = {
  sheetOrder: string[];
  sheets: Record<string, Sheet>;
  styles: Record<string, Record<string, unknown>>;
  resources: { name: string; data: string }[];
};

function build(input?: Parameters<typeof buildDemandWorkbook>[0]) {
  const wb = buildDemandWorkbook(input) as unknown as Wb;
  const [a, b] = wb.sheetOrder.map((id) => wb.sheets[id]);
  return { wb, lignes: a, exigences: b };
}

describe("buildDemandWorkbook", () => {
  it("produit un classeur Univer à deux feuilles nommées", () => {
    const { wb, lignes, exigences } = build();
    expect(isWorkbookData(wb)).toBe(true);
    expect(wb.sheetOrder).toHaveLength(2);
    expect(lignes.name).toBe("Lignes");
    expect(exigences.name).toBe("Exigences");
  });

  it("a exactement les en-têtes du gabarit dans l'ordre", () => {
    const { lignes, exigences } = build();
    expect(LINES_HEADERS).toHaveLength(16);
    expect(REQUIREMENTS_HEADERS).toHaveLength(5);
    expect(LINES_HEADERS.slice(0, 15)).toEqual([
      "SKU", "Modèle", "Couleur", "Taille", "Matière et grammage", "Quantité",
      "Type", "Personnalisation", "Industriel", "Prix unitaire (€)",
      "Prix total (€)", "Délai", "Pays de confection", "Statut", "Provenance",
    ]);
    expect(LINES_HEADERS[15]).toBe("Fichiers");
    expect(REQUIREMENTS_HEADERS).toEqual([
      "Exigence", "Catégorie", "Détail", "Réponse industriel", "Statut",
    ]);
    LINES_HEADERS.forEach((h, c) => expect(lignes.cellData[0][c].v).toBe(h));
    REQUIREMENTS_HEADERS.forEach((h, c) => expect(exigences.cellData[0][c].v).toBe(h));
    expect(lignes.columnCount).toBe(16);
    expect(exigences.columnCount).toBe(5);
  });

  it("met les en-têtes en gras et fige la première ligne", () => {
    const { wb, lignes } = build();
    const styleId = lignes.cellData[0][0].s!;
    expect(wb.styles[styleId].bl).toBe(1);
    expect(lignes.freeze).toMatchObject({ ySplit: 1 });
  });

  it("dimensionne les colonnes à liste sur la valeur la plus longue + 32 px", () => {
    const { lignes, exigences } = build();
    const longest = (vs: readonly string[]) => Math.max(...vs.map((v) => v.length)) * 7 + 32;
    expect(lignes.columnData![6].w).toBeGreaterThanOrEqual(longest(LINE_TYPES));
    expect(lignes.columnData![13].w).toBeGreaterThanOrEqual(longest(LINE_STATUSES));
    expect(exigences.columnData![1].w).toBeGreaterThanOrEqual(longest(REQUIREMENT_CATEGORIES));
  });

  it("accepte des listes vides", () => {
    const { lignes, exigences } = build({ lines: [], requirements: [] });
    expect(Object.keys(lignes.cellData)).toEqual(["0"]);
    expect(Object.keys(exigences.cellData)).toEqual(["0"]);
    expect(() => build(undefined)).not.toThrow();
  });

  it("écrit les lignes et la formule prix total", () => {
    const { lignes } = build({
      lines: [
        { sku: "A-1", modele: "Hoodie", quantite: 50, prixUnitaire: 12.5, fichiers: ["a.pdf", "b.png"] },
        { sku: "A-2" },
      ],
    });
    expect(lignes.cellData[1][0].v).toBe("A-1");
    expect(lignes.cellData[1][5].v).toBe(50);
    expect(lignes.cellData[1][9].v).toBe(12.5);
    expect(lignes.cellData[1][10].f).toBe("=F2*J2");
    expect(lignes.cellData[2][10].f).toBe("=F3*J3");
    expect(lignes.cellData[1][15].v).toBe("a.pdf, b.png");
    expect(lignes.cellData[2][1]).toBeUndefined();
  });

  it("écrit les exigences", () => {
    const { exigences } = build({
      requirements: [{ exigence: "Minimum", categorie: "Minimum et couleurs", statut: "Posée" }],
    });
    expect(exigences.cellData[1][0].v).toBe("Minimum");
    expect(exigences.cellData[1][1].v).toBe("Minimum et couleurs");
    expect(exigences.cellData[1][4].v).toBe("Posée");
  });

  it("déclare les listes de validation", () => {
    const { wb, lignes, exigences } = build();
    const res = wb.resources.find((r) => r.name === "SHEET_DATA_VALIDATION_PLUGIN")!;
    const data = JSON.parse(res.data) as Record<string, { formula1: string; type: string; ranges: { startColumn: number }[] }[]>;
    const l = data[lignes.id];
    const byCol = (rules: typeof l, c: number) => rules.find((r) => r.ranges[0].startColumn === c)!;
    expect(byCol(l, 6).formula1).toBe("Production,Échantillon");
    expect(byCol(l, 13).formula1).toBe("À chiffrer,Chiffrée,Validée");
    expect(byCol(l, 14).formula1).toBe("Extrait,Deviné,Saisi");
    expect(l.every((r) => r.type === "list")).toBe(true);
    const e = data[exigences.id];
    expect(byCol(e, 1).formula1).toContain("Minimum et couleurs");
    expect(byCol(e, 4).formula1).toBe("À poser,Posée,Répondue,Validée");
  });
});
