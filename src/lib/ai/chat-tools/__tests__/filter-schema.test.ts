import { describe, it, expect } from "vitest";
import { queryFilterSchema, toFilterGroup } from "../filter-schema";

const cond = { columnId: "c1", operator: "contains" as const, value: "x" };

describe("queryFilterSchema", () => {
  it("rejette un operateur inconnu", () => {
    expect(
      queryFilterSchema.safeParse({
        conjunction: "and",
        conditions: [{ ...cond, operator: "regex" }],
      }).success,
    ).toBe(false);
  });
  it("rejette plus de 10 conditions", () => {
    expect(
      queryFilterSchema.safeParse({
        conjunction: "and",
        conditions: Array.from({ length: 11 }, () => cond),
      }).success,
    ).toBe(false);
  });
  it("accepte 10 conditions", () => {
    expect(
      queryFilterSchema.safeParse({
        conjunction: "or",
        conditions: Array.from({ length: 10 }, () => cond),
      }).success,
    ).toBe(true);
  });
  it("toFilterGroup mappe conditions vers children avec ids", () => {
    const g = toFilterGroup({ conjunction: "or", conditions: [cond, cond] });
    expect(g.type).toBe("group");
    expect(g.conjunction).toBe("or");
    expect(g.children).toHaveLength(2);
    const ids = g.children.map((c) => c.id);
    expect(new Set(ids).size).toBe(2);
    expect(g.id).toBeTruthy();
  });
});
