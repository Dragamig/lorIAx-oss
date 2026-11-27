import { describe, expect, it } from "vitest";
import type { ColumnFact } from "../automap";
import { CRM_FIELDS } from "../fields";
import { validateField, validateRole } from "../validate";

const def = (role: "contacts" | "dossiers" | "interactions", key: string) =>
  CRM_FIELDS[role].find((f) => f.key === key)!;

const cols: ColumnFact[] = [
  { id: "t", name: "Titre", type: "text" },
  { id: "s", name: "Statut", type: "select" },
  { id: "n", name: "Nombre", type: "number" },
  { id: "r", name: "Contact", type: "relation", targetDatabaseId: "db-contacts" },
];

describe("validateField", () => {
  it("none sans identifiant", () => {
    expect(validateField(def("dossiers", "titre"), null, cols)).toEqual({ state: "none" });
    expect(validateField(def("dossiers", "titre"), undefined, cols)).toEqual({ state: "none" });
  });

  it("ok pour une colonne compatible", () => {
    expect(validateField(def("dossiers", "titre"), "t", cols)).toEqual({ state: "ok" });
  });

  it("column_missing", () => {
    expect(validateField(def("dossiers", "titre"), "zzz", cols)).toEqual({
      state: "bad",
      code: "column_missing",
      message: "crm.errors.columnMissing",
    });
  });

  it("type_incompatible", () => {
    expect(validateField(def("dossiers", "titre"), "n", cols)).toEqual({
      state: "bad",
      code: "type_incompatible",
      message: "crm.errors.typeIncompatible",
    });
  });

  it("relation sans cible attendue : relation_target", () => {
    const s = validateField(def("dossiers", "contact"), "r", cols);
    expect(s).toEqual({ state: "bad", code: "relation_target", message: "crm.errors.relationTarget" });
    expect(validateField(def("dossiers", "contact"), "r", cols, null)).toMatchObject({ code: "relation_target" });
  });

  it("relation vers une autre base : relation_target", () => {
    expect(validateField(def("dossiers", "contact"), "r", cols, "autre")).toMatchObject({
      code: "relation_target",
    });
  });

  it("relation vers la bonne base : ok", () => {
    expect(validateField(def("dossiers", "contact"), "r", cols, "db-contacts")).toEqual({ state: "ok" });
  });
});

describe("validateRole", () => {
  it("compte ok, total, bad et complete", () => {
    const r = validateRole(
      "dossiers",
      { titre: "t", statut: "s", contact: "r", montant: "t" },
      cols,
      { contacts: "db-contacts" },
    );
    expect(r.total).toBe(7);
    expect(r.ok).toBe(3);
    expect(r.bad).toBe(1);
    expect(r.fields.montant).toMatchObject({ code: "type_incompatible" });
    expect(r.fields.relance).toEqual({ state: "none" });
    expect(r.complete).toBe(true);
  });

  it("incomplet si un champ obligatoire n'est pas ok", () => {
    const r = validateRole("dossiers", { titre: "t", statut: "s" }, cols, {});
    expect(r.complete).toBe(false);
  });

  it("a connection with contact and sens unmapped is still complete", () => {
    const r = validateRole(
      "interactions",
      { date: "d", type: "s", dossier: "r" },
      [
        { id: "d", name: "Date", type: "date" },
        { id: "s", name: "Type", type: "select" },
        { id: "r", name: "Dossier", type: "relation", targetDatabaseId: "db-dossiers" },
      ],
      { dossiers: "db-dossiers", contacts: "db-contacts" },
    );
    expect(r.complete).toBe(true);
    expect(r.fields.contact).toEqual({ state: "none" });
    expect(r.fields.sens).toEqual({ state: "none" });
    expect(r.total).toBe(8);
  });

  it("fieldMap avec un champ inconnu : ignoré", () => {
    const r = validateRole("dossiers", { titre: "t", inconnu: "t" }, cols, {});
    expect(r.fields.inconnu).toBeUndefined();
    expect(r.ok).toBe(1);
  });
});
