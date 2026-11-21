import { describe, it, expect } from "vitest";
import { resolveRecordNav } from "@/lib/bases/record-navigation";

const ids = ["a", "b", "c"];

describe("resolveRecordNav", () => {
  it("returns neighbours for a middle row", () => {
    expect(resolveRecordNav(ids, "b", null)).toEqual({
      index: 1,
      total: 3,
      prevId: "a",
      nextId: "c",
      outOfList: false,
    });
  });

  it("has no previous on the first row and no next on the last", () => {
    const first = resolveRecordNav(ids, "a", null);
    expect(first.prevId).toBeNull();
    expect(first.nextId).toBe("b");

    const last = resolveRecordNav(ids, "c", null);
    expect(last.prevId).toBe("b");
    expect(last.nextId).toBeNull();
  });

  it("handles a single-element list", () => {
    const nav = resolveRecordNav(["a"], "a", null);
    expect(nav.prevId).toBeNull();
    expect(nav.nextId).toBeNull();
    expect(nav.total).toBe(1);
  });

  it("handles an empty list", () => {
    const nav = resolveRecordNav([], "x", null);
    expect(nav.total).toBe(0);
    expect(nav.prevId).toBeNull();
    expect(nav.nextId).toBeNull();
    expect(nav.outOfList).toBe(true);
  });

  it("keeps navigating from the previous position when the row left the list", () => {
    expect(resolveRecordNav(["a", "c"], "b", 1)).toEqual({
      index: 1,
      total: 2,
      prevId: "a",
      nextId: "c",
      outOfList: true,
    });
  });

  it("starts from the first row when never in the list", () => {
    const nav = resolveRecordNav(["a", "c"], "b", null);
    expect(nav.prevId).toBeNull();
    expect(nav.nextId).toBe("a");
    expect(nav.outOfList).toBe(true);
  });

  it("clamps a stale anchor", () => {
    const nav = resolveRecordNav(["a", "c"], "b", 5);
    expect(nav.prevId).toBe("c");
    expect(nav.nextId).toBeNull();
  });
});
