import { describe, it, expect, vi } from "vitest";

const { tickCron, tickDateAutomations } = vi.hoisted(() => ({
  tickCron: vi.fn().mockResolvedValue({ ran: 1, skipped: 0 }),
  tickDateAutomations: vi.fn().mockResolvedValue({ ran: 0, rows: 0 }),
}));
vi.mock("@/lib/automations/executor", () => ({ tickCron, tickDateAutomations }));

import { automationSchedulerTick } from "@/lib/automations/scheduler-tick";

describe("automationSchedulerTick", () => {
  it("appelle tickCron puis tickDateAutomations", async () => {
    await automationSchedulerTick();
    expect(tickCron).toHaveBeenCalledOnce();
    expect(tickDateAutomations).toHaveBeenCalledOnce();
  });

  it("n'échoue pas si un tick lève (erreurs absorbées)", async () => {
    tickCron.mockRejectedValueOnce(new Error("boom"));
    await expect(automationSchedulerTick()).resolves.toBeUndefined();
    expect(tickDateAutomations).toHaveBeenCalled();
  });
});
