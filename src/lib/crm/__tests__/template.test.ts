import { describe, expect, it } from "vitest";
import { CRM_FIELDS, CRM_ROLES } from "../fields";
import type { MissingColumn } from "../plan";
import { buildRoleDatabase, crmRelations, missingToTemplateColumns } from "../template";
import { loadTemplateMessages } from "../template-messages";

describe("description générique des bases CRM", () => {
  it("trois bases, un champ non relation par colonne, relations hors liste", async () => {
    const m = await loadTemplateMessages("fr");
    for (const role of CRM_ROLES) {
      const db = buildRoleDatabase(role, m);
      const expected = CRM_FIELDS[role].filter((f) => f.types[0] !== "relation").map((f) => f.key);
      expect(db.key).toBe(role);
      expect(db.name).toBe(m.databases[role]);
      expect(db.columns.map((c) => c.key)).toEqual(expected);
      expect(db.columns.map((c) => c.name)).toEqual(expected.map((k) => m.fields[role][k]));
    }
    expect(crmRelations(m)).toEqual([
      { from: "dossiers", to: "contacts", fieldKey: "contact", name: "Contact", inverseName: "Dossiers" },
      { from: "interactions", to: "dossiers", fieldKey: "dossier", name: "Dossier", inverseName: "Interactions" },
    ]);
  });

  it("Statut : 9 options, Type : 4", async () => {
    const m = await loadTemplateMessages("fr");
    const statut = buildRoleDatabase("dossiers", m).columns.find((c) => c.key === "statut");
    const type = buildRoleDatabase("interactions", m).columns.find((c) => c.key === "type");
    expect(statut?.options).toEqual([
      "Nouvelle", "À qualifier", "Devis envoyé", "En attente client", "Chez l'industriel",
      "Échantillon en cours", "Gagnée", "Perdue", "Sans suite",
    ]);
    expect(type?.options).toEqual(["Appel", "Mail", "Rendez-vous", "Note"]);
  });

  it("types par défaut = premier type accepté (Nom -> text)", async () => {
    const m = await loadTemplateMessages("fr");
    const cols = buildRoleDatabase("contacts", m).columns;
    expect(cols.find((c) => c.key === "nom")?.type).toBe("text");
    expect(cols.find((c) => c.key === "email")?.type).toBe("email");
    expect(buildRoleDatabase("dossiers", m).columns.find((c) => c.key === "montant")?.type).toBe("number");
  });

  it("missingToTemplateColumns : key = fieldKey, nom du plan, options de modèle pour select", async () => {
    const m = await loadTemplateMessages("fr");
    const missing: MissingColumn[] = [
      { fieldKey: "statut", name: "Statut (select)", type: "select", cause: "wrong_type", existingName: "Statut" },
      { fieldKey: "montant", name: "Montant", type: "number", cause: "absent" },
    ];
    const cols = missingToTemplateColumns(missing, "dossiers", m);
    expect(cols[0]).toMatchObject({ key: "statut", name: "Statut (select)", type: "select" });
    expect(cols[0].options).toHaveLength(9);
    expect(cols[1]).toEqual({ key: "montant", name: "Montant", type: "number" });
  });
});

describe("vues d'exemple de Dossiers", () => {
  it("seule la base Dossiers porte des vues, dans l'ordre, avec un nom unique", async () => {
    const m = await loadTemplateMessages("fr");
    expect(buildRoleDatabase("contacts", m).views).toBeUndefined();
    expect(buildRoleDatabase("interactions", m).views).toBeUndefined();
    const views = buildRoleDatabase("dossiers", m).views ?? [];
    expect(views.map((v) => v.name)).toEqual(["Pipeline", "Relances", "Tous", "Mes dossiers", "Gagnés ce trimestre"]);
    expect(new Set(views.map((v) => v.name)).size).toBe(views.length);
  });

  it("Pipeline : totaux sur la colonne Montant, 9 poids, 3 voies closes", async () => {
    const m = await loadTemplateMessages("fr");
    const ids = { statut: "S", montant: "M", relance: "R", responsable: "P", cloture: "C" };
    const cfg = buildRoleDatabase("dossiers", m).views![0].config(ids) as { groupByColumnId: string; kanbanTotals: { amountColumnId: string; weights: Record<string, number>; closedLanes: string[] } };
    expect(cfg.groupByColumnId).toBe("S");
    expect(cfg.kanbanTotals.amountColumnId).toBe("M");
    expect(Object.keys(cfg.kanbanTotals.weights)).toHaveLength(9);
    expect(cfg.kanbanTotals.closedLanes).toEqual(m.statusOptions.slice(6));
  });
});
