import { describe, it, expect } from "vitest";
import { getRowDisplayName } from "@/components/editor/extensions/database-block/row-display-name";
import type { DbColumn, DbRow } from "@/components/editor/extensions/database-block/types";

const col = (id: string, type: string, name = id, config: Record<string, unknown> = {}) =>
  ({ id, type, name, position: 0, config }) as unknown as DbColumn;
const row = (cells: Record<string, unknown>, position = 0) =>
  ({ id: "r", position, cells }) as unknown as DbRow;

describe("getRowDisplayName", () => {
  it("texte", () => {
    expect(getRowDisplayName(row({ a: "Acme" }), [col("a", "text")])).toBe("Acme");
  });
  it("formule en colonne primaire", () => {
    const cols = [col("f", "formula", "Titre", { formula: 'prop("Nom") + "-X"' }), col("n", "text", "Nom")];
    expect(getRowDisplayName(row({ n: "Acme" }), cols)).toBe("Acme-X");
  });
  it("autonumber formaté", () => {
    const cols = [col("n", "autonumber", "N", { padding: 4, prefix: "CLI-" })];
    expect(getRowDisplayName(row({ n: 7 }), cols)).toBe("CLI-0007");
  });
  it("primaire vide: repli sur la colonne suivante", () => {
    const cols = [col("a", "text"), col("b", "text")];
    expect(getRowDisplayName(row({ b: "Suite" }), cols)).toBe("Suite");
  });
  it("tout vide: Ligne N", () => {
    expect(getRowDisplayName(row({}, 2), [col("a", "text")])).toBe("Ligne 3");
  });
});

import { getRelationLabels } from "@/components/editor/extensions/database-block/row-display-name";

describe("getRelationLabels", () => {
  const columns = [
    { id: "f", name: "Titre", type: "formula", position: 0, config: { formula: 'prop("Nom") + "-X"' } },
    { id: "n", name: "Nom", type: "text", position: 1, config: {} },
  ] as never[];
  const rows = [{ id: "r1", position: 0, cells: { n: "Alpha" } }] as never[];

  it("résout une ligne liée via la première colonne affichée (formule)", () => {
    expect(getRelationLabels(["r1"], { rows, columns })).toEqual(["Alpha-X"]);
  });
  it("renvoie l'id si la ligne est absente et … si la base n'est pas chargée", () => {
    expect(getRelationLabels(["zz"], { rows, columns })).toEqual(["zz"]);
    expect(getRelationLabels(["r1"], undefined)).toEqual(["…"]);
  });
  it("tolère une valeur non tableau", () => {
    expect(getRelationLabels(null, undefined)).toEqual([]);
  });
});
