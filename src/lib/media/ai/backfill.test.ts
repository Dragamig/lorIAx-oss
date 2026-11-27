import { describe, it, expect, vi, beforeEach } from "vitest";

const h = vi.hoisted(() => ({ pages: [] as string[][], queries: 0, enqueue: vi.fn(async () => undefined) }));
vi.mock("@/lib/db", () => ({
  db: {
    execute: async () => ({ rows: (h.pages[h.queries++] ?? []).map((id) => ({ id })) }),
  },
}));
vi.mock("./enqueue", () => ({ enqueueMediaIndex: h.enqueue }));

import { backfillMediaIndex } from "./backfill";

beforeEach(() => {
  h.pages = [];
  h.queries = 0;
  h.enqueue.mockClear();
});

describe("backfillMediaIndex", () => {
  it("met chaque média en file backfill", async () => {
    h.pages = [["a", "b"]];
    expect(await backfillMediaIndex("o1")).toBe(2);
    expect(h.enqueue.mock.calls).toEqual([["a", "backfill"], ["b", "backfill"]]);
  });

  it("pagine par lots de 200 jusqu'à une page incomplète", async () => {
    const full = Array.from({ length: 200 }, (_, i) => `m${i}`);
    h.pages = [full, ["z"]];
    expect(await backfillMediaIndex("o1")).toBe(201);
    expect(h.queries).toBe(2);
    expect(h.enqueue).toHaveBeenCalledTimes(201);
  });

  it("ne lève jamais", async () => {
    h.enqueue.mockRejectedValueOnce(new Error("boom"));
    h.pages = [["a"]];
    await expect(backfillMediaIndex("o1")).resolves.toBe(0);
  });
});
