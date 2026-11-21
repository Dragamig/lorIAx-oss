import { describe, it, expect, vi, afterEach } from "vitest";

const purgeFails = vi.hoisted(() => ({ on: false }));
vi.mock("@/lib/db", () => ({
  db: {
    transaction: async () => {
      if (purgeFails.on) throw new Error("boom");
      return 0;
    },
  },
}));
vi.mock("@/lib/logger", () => ({ default: { error: vi.fn(), info: vi.fn(), warn: vi.fn() } }));

import { isRowHistoryPurgeDisabled, runRowHistoryPurgeJob } from "../row-history-purge";

describe("row-history-purge", () => {
  const saved = process.env.ROW_HISTORY_PURGE;
  afterEach(() => {
    purgeFails.on = false;
    if (saved === undefined) delete process.env.ROW_HISTORY_PURGE;
    else process.env.ROW_HISTORY_PURGE = saved;
  });

  it("isRowHistoryPurgeDisabled lit ROW_HISTORY_PURGE=off", () => {
    delete process.env.ROW_HISTORY_PURGE;
    expect(isRowHistoryPurgeDisabled()).toBe(false);
    process.env.ROW_HISTORY_PURGE = "off";
    expect(isRowHistoryPurgeDisabled()).toBe(true);
  });

  it("runRowHistoryPurgeJob ne lève jamais quand la purge échoue", async () => {
    purgeFails.on = true;
    await expect(runRowHistoryPurgeJob()).resolves.toBeUndefined();
  });
});
