import { describe, it, expect, vi, beforeEach } from "vitest";

const calls: unknown[][] = [];
vi.mock("@/lib/automations/executor", () => ({
  dispatchTrigger: vi.fn((...a: unknown[]) => {
    calls.push(["trigger", ...a]);
    return Promise.resolve();
  }),
  dispatchValueChanged: vi.fn((...a: unknown[]) => {
    calls.push(["valueChanged", ...a]);
    return Promise.resolve();
  }),
}));

import { dispatchRowEvents } from "../dispatch-row-events";

beforeEach(() => {
  calls.length = 0;
});

describe("dispatchRowEvents", () => {
  it("création", () => {
    dispatchRowEvents({ databaseId: "d", rowId: "r", before: null, after: { a: 1 } });
    expect(calls).toEqual([["trigger", "row_created", { databaseId: "d", rowId: "r", cells: { a: 1 } }]]);
  });

  it("mise à jour (row_updated puis value_changed dans cet ordre)", () => {
    dispatchRowEvents({ databaseId: "d", rowId: "r", before: { a: 1 }, after: { a: 2 } });
    expect(calls).toEqual([
      ["trigger", "row_updated", { databaseId: "d", rowId: "r", cells: { a: 2 } }],
      ["valueChanged", { databaseId: "d", rowId: "r", before: { a: 1 }, after: { a: 2 } }],
    ]);
  });

  it("suppression avec les cellules d'avant", () => {
    dispatchRowEvents({ databaseId: "d", rowId: "r", before: { a: 1 }, after: null });
    expect(calls).toEqual([["trigger", "row_deleted", { databaseId: "d", rowId: "r", cells: { a: 1 } }]]);
  });

  it("before et after nuls : aucun appel", () => {
    dispatchRowEvents({ databaseId: "d", rowId: "r", before: null, after: null });
    expect(calls).toEqual([]);
  });
});
