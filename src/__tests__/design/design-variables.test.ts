import { describe, it, expect } from "vitest";
import { StaticCanvas, Rect } from "fabric/node";
import {
  extractDesignVariables,
  slugifyVariableKey,
  PERSIST_PROPS,
} from "@/components/editor/extensions/design-canvas/utils";
import type { DesignPage } from "@/components/editor/extensions/design-constants";

// Fabrique une page de design portant un JSON Fabric arbitraire.
function page(objects: unknown[]): DesignPage {
  return {
    id: crypto.randomUUID(),
    name: "P",
    format: "a4-portrait",
    bgColor: "#fff",
    json: { objects } as object,
    thumbnail: null,
  };
}

describe("extractDesignVariables", () => {
  it("collecte les calques variabilisés (clé/libellé/layerId)", () => {
    const vars = extractDesignVariables([
      page([
        { type: "i-text", text: "Nom", layerId: "l1", variableKey: "client_nom", variableLabel: "Nom du client" },
        { type: "rect" }, // non variable → ignoré
      ]),
    ]);
    expect(vars).toEqual([
      { key: "client_nom", label: "Nom du client", layerId: "l1" },
    ]);
  });

  it("parcourt les groupes imbriqués", () => {
    const vars = extractDesignVariables([
      page([
        { type: "group", objects: [
          { type: "i-text", text: "X", layerId: "l2", variableKey: "titre", variableLabel: "Titre" },
        ] },
      ]),
    ]);
    expect(vars).toEqual([{ key: "titre", label: "Titre", layerId: "l2" }]);
  });

  it("dédupe par clé (première occurrence conservée) sur plusieurs pages", () => {
    const vars = extractDesignVariables([
      page([{ type: "i-text", layerId: "a", variableKey: "k", variableLabel: "Premier" }]),
      page([{ type: "i-text", layerId: "b", variableKey: "k", variableLabel: "Second" }]),
    ]);
    expect(vars).toHaveLength(1);
    expect(vars[0]).toEqual({ key: "k", label: "Premier", layerId: "a" });
  });

  it("retombe sur la clé comme libellé si variableLabel absent", () => {
    const vars = extractDesignVariables([
      page([{ type: "i-text", layerId: "a", variableKey: "montant" }]),
    ]);
    expect(vars[0]).toEqual({ key: "montant", label: "montant", layerId: "a" });
  });

  it("ignore les pages vides et les calques sans layerId", () => {
    const vars = extractDesignVariables([
      { id: "1", name: "P", format: "a4-portrait", bgColor: "#fff", json: null, thumbnail: null },
      page([{ type: "i-text", variableKey: "k" /* pas de layerId */ }]),
    ]);
    expect(vars).toEqual([]);
  });
});

describe("slugifyVariableKey", () => {
  it("normalise en clé a-z0-9_", () => {
    expect(slugifyVariableKey("Nom du Client")).toBe("nom_du_client");
    expect(slugifyVariableKey("Prénom éàü !")).toBe("prenom_eau");
    expect(slugifyVariableKey("")).toBe("variable");
    expect(slugifyVariableKey("---")).toBe("variable");
  });
});

describe("sérialisation Fabric des props custom (round-trip)", () => {
  it("les props PERSIST_PROPS survivent à toObject → loadFromJSON → toObject", async () => {
    const c1 = new StaticCanvas(undefined, { width: 200, height: 200 });
    const r = new Rect({ left: 5, top: 5, width: 10, height: 10 });
    r.set({ layerId: "uuid-1", variableKey: "client_nom", variableLabel: "Nom du client" });
    c1.add(r);

    // toObject AVEC propertiesToInclude — indispensable en Fabric v7 (toJSON() n'en prend pas).
    const json = c1.toObject(PERSIST_PROPS) as { objects: Record<string, unknown>[] };
    expect(json.objects[0].variableKey).toBe("client_nom");

    // Rechargement dans un nouveau canvas puis re-sérialisation.
    const c2 = new StaticCanvas(undefined, { width: 200, height: 200 });
    await c2.loadFromJSON(json);
    const json2 = c2.toObject(PERSIST_PROPS) as { objects: Record<string, unknown>[] };

    expect(json2.objects[0].layerId).toBe("uuid-1");
    expect(json2.objects[0].variableKey).toBe("client_nom");
    expect(json2.objects[0].variableLabel).toBe("Nom du client");
  });

  it("sans propertiesToInclude, les props custom sont perdues (régression que l'on corrige)", () => {
    const c1 = new StaticCanvas(undefined, { width: 200, height: 200 });
    const r = new Rect({ left: 0, top: 0, width: 10, height: 10 });
    r.set({ variableKey: "perdu" });
    c1.add(r);
    const json = c1.toObject() as { objects: Record<string, unknown>[] };
    expect(json.objects[0].variableKey).toBeUndefined();
  });
});
