import { describe, it, expect } from "vitest";
import { describePairing, pairingLabel } from "../relation-pairing";
import type { DbColumn } from "../types";

const dbs = [{ id: "b2", name: "Interactions" }];
const col = (config: DbColumn["config"], type: DbColumn["type"] = "relation") => ({ type, config });

describe("describePairing", () => {
  it("ignore une colonne qui n'est pas une relation", () => {
    expect(describePairing(col({}, "text"), {}, dbs).kind).toBe("none");
  });
  it("sens unique sans inverseColumnId", () => {
    const p = describePairing(col({ targetDatabaseId: "b2" }), {}, dbs);
    expect(p.kind).toBe("oneway");
    expect(pairingLabel(p)).toContain("Sens unique");
  });
  it("jumelée : nom de la jumelle résolu dans la base cible", () => {
    const rd = { b2: { columns: [{ id: "c9", name: "Contacts" } as DbColumn] } };
    const p = describePairing(col({ targetDatabaseId: "b2", inverseColumnId: "c9" }), rd, dbs);
    expect(p).toMatchObject({ kind: "paired", inverseColumnName: "Contacts" });
    expect(pairingLabel(p)).toBe("Jumelée avec Interactions › Contacts");
  });
  it("jumelée mais base cible pas encore chargée", () => {
    const p = describePairing(col({ targetDatabaseId: "b2", inverseColumnId: "c9" }), {}, dbs);
    expect(p).toMatchObject({ kind: "paired", inverseColumnName: null });
  });
});
