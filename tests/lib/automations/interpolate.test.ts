import { describe, it, expect } from "vitest";
import { interpolate, interpolateCells } from "@/lib/automations/interpolate";

describe("interpolate", () => {
  const payload = {
    event: "row_created",
    databaseId: "db-1",
    rowId: "row-9",
    cells: { titre: "Bonjour", montant: 42, tags: ["a", "b"] },
  };

  it("substitue rowId / databaseId / event", () => {
    expect(interpolate("{{rowId}}", payload)).toBe("row-9");
    expect(interpolate("{{databaseId}}", payload)).toBe("db-1");
    expect(interpolate("{{event}}", payload)).toBe("row_created");
  });

  it("substitue les cellules par clé", () => {
    expect(interpolate("Sujet : {{cells.titre}}", payload)).toBe("Sujet : Bonjour");
  });

  it("sérialise les valeurs non-chaîne", () => {
    expect(interpolate("{{cells.montant}}", payload)).toBe("42");
    expect(interpolate("{{cells.tags}}", payload)).toBe('["a","b"]');
  });

  it("remplace les clés absentes par une chaîne vide", () => {
    expect(interpolate("[{{cells.inconnu}}]", payload)).toBe("[]");
    expect(interpolate("[{{autre}}]", payload)).toBe("[]");
  });

  it("tolère les espaces dans les accolades", () => {
    expect(interpolate("{{  rowId  }}", payload)).toBe("row-9");
  });

  it("gère plusieurs placeholders dans une même chaîne", () => {
    expect(interpolate("{{cells.titre}} #{{rowId}}", payload)).toBe("Bonjour #row-9");
  });

  it("renvoie une chaîne vide pour les champs absents du payload", () => {
    expect(interpolate("{{rowId}}", {})).toBe("");
  });
});

describe("interpolate — placeholders workflow autonome", () => {
  const ctx = {
    event: "manual",
    spaceId: "space-1",
    documentId: "doc-7",
    user: { id: "user-3", email: "bob@exemple.com", name: "Bob Martin" },
  };

  it("substitue space.id / doc.id", () => {
    expect(interpolate("{{space.id}}", ctx)).toBe("space-1");
    expect(interpolate("{{doc.id}}", ctx)).toBe("doc-7");
  });

  it("substitue user.id / user.email / user.name", () => {
    expect(interpolate("{{user.id}}", ctx)).toBe("user-3");
    expect(interpolate("{{user.email}}", ctx)).toBe("bob@exemple.com");
    expect(interpolate("{{user.name}}", ctx)).toBe("Bob Martin");
  });

  it("combine plusieurs placeholders autonomes", () => {
    expect(interpolate("Compte-rendu {{user.name}} ({{space.id}})", ctx)).toBe(
      "Compte-rendu Bob Martin (space-1)"
    );
  });

  it("renvoie une chaîne vide quand l'utilisateur est absent", () => {
    expect(interpolate("{{user.id}}", { event: "manual" })).toBe("");
    expect(interpolate("{{user.email}}", { user: {} })).toBe("");
  });

  it("non-régression : les placeholders base restent vides en contexte autonome", () => {
    expect(interpolate("{{rowId}}", ctx)).toBe("");
    expect(interpolate("{{databaseId}}", ctx)).toBe("");
  });
});

describe("interpolateCells", () => {
  const payload = { rowId: "r1", cells: { nom: "Alice" } };

  it("interpole les valeurs chaîne et conserve les autres", () => {
    const out = interpolateCells(
      { colA: "Salut {{cells.nom}}", colB: 7, colC: true, colD: ["x"] },
      payload
    );
    expect(out).toEqual({ colA: "Salut Alice", colB: 7, colC: true, colD: ["x"] });
  });

  it("ignore les clés de colonne vides", () => {
    const out = interpolateCells({ "": "ignoré", ok: "{{rowId}}" }, payload);
    expect(out).toEqual({ ok: "r1" });
  });

  it("renvoie un objet vide pour un mapping vide", () => {
    expect(interpolateCells({}, payload)).toEqual({});
  });
});
