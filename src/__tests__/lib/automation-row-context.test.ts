import { describe, it, expect, vi, beforeEach } from "vitest";

const h = vi.hoisted(() => ({ calls: [] as { fn: string; ctx: unknown }[], existing: null as unknown }));

vi.mock("@/lib/databases/row-writes", () => ({
  createDatabaseRow: vi.fn(async (_d: string, _c: unknown, _e: unknown, ctx: unknown) => {
    h.calls.push({ fn: "create", ctx });
    return { id: "r1", cells: {} };
  }),
  mergeDatabaseRowCells: vi.fn(async (_d: string, id: string, _c: unknown, _o: unknown, _e: unknown, ctx: unknown) => {
    h.calls.push({ fn: "merge", ctx });
    return { id, cells: {} };
  }),
  fillEmptyRowCells: vi.fn(async (_d: string, _id: string, _c: unknown, _o: unknown, _e: unknown, ctx: unknown) => {
    h.calls.push({ fn: "fill", ctx });
    return { row: { id: "r1" }, filledColumns: ["c1"] };
  }),
  findRowByCellValue: vi.fn(async () => h.existing),
  loadColumnTypes: vi.fn(async () => ({})),
  withMatchLock: vi.fn(async (_d: string, _c: string, _v: string, fn: (tx: unknown) => unknown) => fn(undefined)),
}));
vi.mock("@/lib/automations/media-guard", () => ({ automationMediaGuard: vi.fn(async () => ({ user: null, orgId: "o1" })) }));
vi.mock("@/lib/automations/target-database", () => ({ resolveTargetDatabaseId: vi.fn(async () => "d1") }));

import { createRowAction } from "@/lib/automations/actions/create-row";
import { updateRowAction } from "@/lib/automations/actions/update-row";

const automation = { id: "a1", name: "Mon automatisme", databaseId: "d1" } as never;
const ctx = { rowId: "r9" } as never;
const expected = {
  source: "automation",
  automationId: "a1",
  actorLabel: "Mon automatisme",
  mediaGuard: { user: null, orgId: "o1" },
};

beforeEach(() => {
  h.calls.length = 0;
  h.existing = null;
});

describe("automation row context", () => {
  it("create_row passe source automation, automationId et actorLabel à createDatabaseRow, fillEmptyRowCells et mergeDatabaseRowCells", async () => {
    await createRowAction.execute({ cells: { c1: "x" } }, automation, ctx);
    h.existing = { id: "r1", cells: {} };
    await createRowAction.execute({ cells: { c1: "x" }, match: { columnId: "c1", value: "x" }, onMatch: "fill_empty" }, automation, ctx);
    await createRowAction.execute({ cells: { c1: "x" }, match: { columnId: "c1", value: "x" } }, automation, ctx);
    expect(h.calls.map((c) => c.fn)).toEqual(["create", "fill", "merge"]);
    for (const c of h.calls) expect(c.ctx).toEqual(expected);
  });

  it("update_row idem", async () => {
    await updateRowAction.execute({ cells: { c1: "x" } }, automation, ctx);
    expect(h.calls).toHaveLength(1);
    expect(h.calls[0].ctx).toEqual(expected);
  });
});
