import { describe, it, expect } from "vitest";
import { CRM_FIELDS, CRM_ROLES, bindingsSchema, parseFieldMap } from "../fields";

const A = "3f2b8c1e-5d4a-4b6c-9e7f-1a2b3c4d5e6f";
const B = "7a1c9d2e-0b3f-4c5d-8e6a-9f0b1c2d3e4f";

describe("registre CRM", () => {
  it("19 champs, clés uniques par rôle, aucun champ obligatoire sans type", () => {
    const all = CRM_ROLES.flatMap((r) => CRM_FIELDS[r]);
    expect(all).toHaveLength(19);
    for (const r of CRM_ROLES) {
      const keys = CRM_FIELDS[r].map((f) => f.key);
      expect(new Set(keys).size).toBe(keys.length);
    }
    for (const f of all.filter((x) => x.required)) expect(f.types.length).toBeGreaterThan(0);
  });

  it("les obligatoires sont nom, titre, statut, contact, date, type, dossier", () => {
    const req = CRM_ROLES.flatMap((r) => CRM_FIELDS[r]).filter((f) => f.required).map((f) => f.key);
    expect(req.sort()).toEqual(["contact", "date", "dossier", "nom", "statut", "titre", "type"].sort());
  });

  it("les relations ciblent le bon rôle", () => {
    expect(CRM_FIELDS.dossiers.find((f) => f.key === "contact")?.relationTargetRole).toBe("contacts");
    expect(CRM_FIELDS.interactions.find((f) => f.key === "dossier")?.relationTargetRole).toBe("dossiers");
  });
});

describe("clés facultatives des Interactions", () => {
  it("interactions registry includes optional contact relation and sens select", () => {
    const contact = CRM_FIELDS.interactions.find((f) => f.key === "contact");
    const sens = CRM_FIELDS.interactions.find((f) => f.key === "sens");
    expect(contact).toMatchObject({ types: ["relation"], relationTargetRole: "contacts", required: false, hints: ["contact"] });
    expect(sens).toMatchObject({ types: ["select"], required: false, hints: ["sens", "direction"] });
  });

  it("a stored field_map without contact and sens still parses", () => {
    expect(parseFieldMap({ interactions: { date: A, dossier: B } })).toEqual({ interactions: { date: A, dossier: B } });
  });

  it("bindingsSchema accepts interactions.contact and interactions.sens", () => {
    expect(bindingsSchema.safeParse({ roles: {}, fieldMap: { interactions: { contact: A, sens: B } } }).success).toBe(true);
  });
});

describe("parseFieldMap", () => {
  it("null, tableau, chaîne, rôle inconnu, champ inconnu, valeur numérique : {} sans exception", () => {
    for (const raw of [null, undefined, [], "x", 3, { autre: { nom: A } }, { contacts: { inconnu: A } }, { contacts: { nom: 5 } }, { contacts: [] }]) {
      const out = parseFieldMap(raw);
      expect(Object.values(out).every((v) => Object.keys(v ?? {}).length === 0)).toBe(true);
    }
    expect(parseFieldMap(null)).toEqual({});
    expect(parseFieldMap({ autre: { nom: A } })).toEqual({});
  });

  it("conserve les uuid valides et les null", () => {
    expect(parseFieldMap({ contacts: { nom: A, email: null, telephone: "pas-uuid" }, dossiers: { titre: B } })).toEqual({
      contacts: { nom: A, email: null },
      dossiers: { titre: B },
    });
  });
});

describe("bindingsSchema", () => {
  it("accepte une forme valide", () => {
    expect(bindingsSchema.safeParse({ roles: { contacts: A, dossiers: null }, fieldMap: { contacts: { nom: B } } }).success).toBe(true);
  });

  it("refuse une clé de champ inconnue (strict) et un id de base non uuid", () => {
    expect(bindingsSchema.safeParse({ roles: {}, fieldMap: { contacts: { inconnu: A } } }).success).toBe(false);
    expect(bindingsSchema.safeParse({ roles: { contacts: "abc" }, fieldMap: {} }).success).toBe(false);
  });
});
