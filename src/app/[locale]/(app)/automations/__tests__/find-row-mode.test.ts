import { describe, expect, it } from "vitest";
import { findRowModeOf, setFindRowMode, stepOutputOptions } from "../automation-shared";

describe("mode de find_row", () => {
  it("déduit le mode de la présence de rowId, même vide", () => {
    expect(findRowModeOf({ columnId: "c", value: "v" })).toBe("column");
    expect(findRowModeOf({ rowId: "" })).toBe("id");
    expect(findRowModeOf({ rowId: "{{cells.x.0}}" })).toBe("id");
  });
  it("mode identifiant : retire columnId et value, garde databaseId", () => {
    const next = setFindRowMode({ databaseId: "db", columnId: "c", value: "v", storeAs: "x" }, "id");
    expect(next).toEqual({ databaseId: "db", rowId: "", storeAs: "x" });
  });
  it("mode colonne : retire rowId", () => {
    expect(setFindRowMode({ databaseId: "db", rowId: "{{rowId}}" }, "column")).toEqual({ databaseId: "db" });
  });
  it("expose les cellules de la base cible de find_row", () => {
    const opts = stepOutputOptions(
      [{ actionType: "find_row", storeAs: "contact", actionConfig: { databaseId: "db1" } }],
      { db1: [{ id: "col-1", name: "Nom" }] }
    );
    expect(opts.map((o) => o.value)).toContain("{{variables.contact.foundRow.cells.col-1}}");
    expect(opts.find((o) => o.value.endsWith("cells.col-1}}"))?.label).toBe("contact : Nom");
  });
});
