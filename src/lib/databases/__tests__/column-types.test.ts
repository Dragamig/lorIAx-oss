import { describe, expect, it } from "vitest";
import {
  describeColumnTypes,
  isColumnTypeCompatible,
} from "../column-types";

describe("isColumnTypeCompatible", () => {
  it("accepte un type attendu", () => {
    expect(isColumnTypeCompatible(["text", "formula"], "formula")).toBe(true);
    expect(isColumnTypeCompatible(["number", "formula"], "number")).toBe(true);
    expect(isColumnTypeCompatible(["relation"], "relation")).toBe(true);
    expect(isColumnTypeCompatible(["person"], "person")).toBe(true);
  });
  it("refuse un type non attendu", () => {
    expect(isColumnTypeCompatible(["select"], "text")).toBe(false);
    expect(isColumnTypeCompatible(["date"], "time")).toBe(false);
  });
  it("refuse un type inconnu ou une liste vide", () => {
    expect(isColumnTypeCompatible(["text"], "inconnu")).toBe(false);
    expect(isColumnTypeCompatible([], "text")).toBe(false);
  });
});

describe("describeColumnTypes", () => {
  it("rend les clés de message", () => {
    expect(describeColumnTypes(["email", "text"])).toEqual([
      "crm.types.email",
      "crm.types.text",
    ]);
  });
});
