import { describe, expect, it } from "vitest";
import type { ColumnFact } from "../automap";
import { classifyCandidate, fallbackColumnName, normalizeName, planMissing } from "../plan";

const label = (key: string) => (({ titre: "Titre", statut: "Statut", contact: "Contact", montant: "Montant" }) as Record<string, string>)[key] ?? key;
const col = (id: string, name: string, type: string, targetDatabaseId: string | null = null): ColumnFact => ({
  id,
  name,
  type,
  targetDatabaseId,
});
const opts = { fieldLabel: label, relationTargetKnown: true };

describe("plan de complétion", () => {
  it("classement : base complète compatible, base sans Statut presque compatible, base sans aucun champ obligatoire none", () => {
    const full = [col("a", "Titre", "text"), col("b", "Statut", "select"), col("c", "Contact", "relation", "T")];
    expect(classifyCandidate("dossiers", full, { titre: "a", statut: "b", contact: "c" }, true).status).toBe("compatible");
    const noStatut = [col("a", "Titre", "text"), col("c", "Contact", "relation", "T")];
    const r = classifyCandidate("dossiers", noStatut, { titre: "a", statut: null, contact: "c" }, true, label);
    expect(r.status).toBe("almost");
    expect(r.missing.map((m) => m.fieldKey)).toContain("statut");
    const empty = [col("z", "Autre", "text")];
    expect(classifyCandidate("dossiers", empty, {}, true).status).toBe("none");
  });

  it("plan : colonne absente -> cause absent, nom du libellé", () => {
    const m = planMissing("dossiers", [col("a", "Titre", "text")], { titre: "a" }, opts);
    const statut = m.find((x) => x.fieldKey === "statut");
    expect(statut).toEqual({ fieldKey: "statut", name: "Statut", type: "select", cause: "absent" });
  });

  it("plan : « Statut » de type text -> cause wrong_type, nom « Statut (select) »", () => {
    const m = planMissing("dossiers", [col("a", "Titre", "text"), col("s", "Statut", "text")], { titre: "a" }, opts);
    const statut = m.find((x) => x.fieldKey === "statut");
    expect(statut).toMatchObject({ cause: "wrong_type", name: "Statut (select)", existingName: "Statut" });
  });

  it("suffixes : « Statut (select) » déjà pris -> « Statut (select) 2 », puis 3", () => {
    const cols = [col("s", "Statut", "text"), col("p", "Statut (select)", "text")];
    expect(planMissing("dossiers", cols, {}, opts).find((x) => x.fieldKey === "statut")?.name).toBe("Statut (select) 2");
    const cols3 = [...cols, col("q", "statut (select) 2", "text")];
    expect(planMissing("dossiers", cols3, {}, opts).find((x) => x.fieldKey === "statut")?.name).toBe("Statut (select) 3");
    expect(fallbackColumnName("Statut", "select", ["Statut (select)"])).toBe("Statut (select) 2");
  });

  it("comparaison insensible à la casse, aux accents et aux espaces de bord", () => {
    expect(normalizeName("  Téléphone  ")).toBe("telephone");
    expect(normalizeName("Compte   Rendu")).toBe("compte rendu");
    const cols = [col("s", "  STATUT ", "text")];
    expect(planMissing("dossiers", cols, {}, opts).find((x) => x.fieldKey === "statut")?.cause).toBe("wrong_type");
    const accent = (k: string) => (k === "statut" ? "Statût" : k);
    const m = planMissing("dossiers", [col("s", "statut", "text")], {}, { ...opts, fieldLabel: accent });
    expect(m.find((x) => x.fieldKey === "statut")?.cause).toBe("wrong_type");
  });

  it("relation sans cible connue : ni ajoutable ni dans missing, base classée none si elle était obligatoire", () => {
    const cols = [col("a", "Titre", "text"), col("b", "Statut", "select")];
    const r = classifyCandidate("dossiers", cols, { titre: "a", statut: "b", contact: null }, false, label);
    expect(r.missing.some((m) => m.fieldKey === "contact")).toBe(false);
    expect(r.status).toBe("none");
    expect(classifyCandidate("dossiers", cols, { titre: "a", statut: "b", contact: null }, true, label).status).toBe("almost");
  });

  it("les colonnes existantes ne figurent jamais dans missing", () => {
    const cols = [col("a", "Titre", "text"), col("b", "Statut", "select"), col("m", "Montant", "number")];
    const m = planMissing("dossiers", cols, { titre: "a", statut: "b", montant: "m" }, opts);
    expect(m.map((x) => x.fieldKey)).not.toEqual(expect.arrayContaining(["titre", "statut", "montant"]));
  });
});
