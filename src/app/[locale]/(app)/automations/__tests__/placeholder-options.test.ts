import { describe, expect, it } from "vitest";
import { cellsToOptions, stepOutputOptions } from "../automation-shared";

describe("entrées de cellules du menu de variables", () => {
  it("cellule déclencheuse : nom de colonne en libellé, type en indice, jeton intact", () => {
    const [o] = cellsToOptions([{ id: "bbbbbbbb-1111", name: "Statut", type: "select" }]);
    expect(o.label).toBe("Cellule : Statut");
    expect(o.hint).toBe("select");
    expect(o.value).toBe("{{cells.bbbbbbbb-1111}}");
  });
  it("cellule sans type : pas d'indice", () => {
    expect(cellsToOptions([{ id: "x", name: "Nom" }])[0].hint).toBeUndefined();
  });
  it("foundRow.cells : nom et type de la colonne de la base cible", () => {
    const opts = stepOutputOptions(
      [{ actionType: "find_row", storeAs: "contact", actionConfig: { databaseId: "db1" } }],
      { db1: [{ id: "col-1", name: "Nom", type: "text" }] }
    );
    const o = opts.find((x) => x.value.endsWith("cells.col-1}}"))!;
    expect(o.label).toBe("contact : Nom");
    expect(o.hint).toBe("text");
  });
});
