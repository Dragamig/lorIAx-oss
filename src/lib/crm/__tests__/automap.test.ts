import { describe, expect, it } from "vitest";
import { automapRole, type ColumnFact } from "../automap";

const col = (id: string, name: string, type: string): ColumnFact => ({ id, name, type });

const DEMANDES: ColumnFact[] = [
  col("c1", "Titre", "text"),
  col("c2", "Référence", "number"),
  col("c3", "Contact", "relation"),
  col("c4", "Statut", "select"),
  col("c5", "Montant devis", "number"),
  col("c6", "Prochaine relance", "date"),
  col("c7", "Responsable", "person"),
  col("c8", "Clôture prévue", "date"),
];

describe("automapRole", () => {
  it("associe le jeu de la maquette", () => {
    const m = automapRole("dossiers", DEMANDES);
    expect(m).toMatchObject({
      titre: "c1",
      contact: "c3",
      statut: "c4",
      montant: "c5",
      relance: "c6",
      responsable: "c7",
      cloture: "c8",
    });
  });

  it("une colonne n'est jamais attribuée à deux champs", () => {
    const m = automapRole("dossiers", [col("a", "Montant relance", "number")]);
    const ids = Object.values(m).filter(Boolean);
    expect(new Set(ids).size).toBe(ids.length);
    expect(m.montant).toBe("a");
    expect(m.relance).toBeNull();
  });

  it("une colonne de nom reconnu mais de type incompatible n'est pas proposée", () => {
    const m = automapRole("dossiers", [col("x", "Statut", "text")]);
    expect(m.statut).toBeNull();
  });

  it("reconnaît un nom accentué avec un indice sans accent", () => {
    const m = automapRole("contacts", [col("t", "Téléphone", "text"), col("n", "Nom", "text")]);
    expect(m.telephone).toBe("t");
  });

  it("aucune colonne : tout à null", () => {
    const m = automapRole("dossiers", []);
    expect(Object.keys(m)).toHaveLength(7);
    expect(Object.values(m).every((v) => v === null)).toBe(true);
  });
});
