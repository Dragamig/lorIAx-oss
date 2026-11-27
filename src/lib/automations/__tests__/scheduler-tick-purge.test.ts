import { describe, it, expect, vi } from "vitest";

const h = vi.hoisted(() => ({ purges: 0, mailTicks: 0, mailThrows: false }));
vi.mock("@/lib/mailing/tick", () => ({
  mailingTick: vi.fn(async () => {
    h.mailTicks += 1;
    if (h.mailThrows) throw new Error("mail down");
    return { delivered: 0, reconciled: 0 };
  }),
}));
vi.mock("@/lib/automations/executor", () => ({ tickCron: vi.fn(async () => {}), tickDateAutomations: vi.fn(async () => {}) }));
vi.mock("@/lib/integrations/tally/import-runner", () => ({ failStaleTallyImports: vi.fn(async () => {}) }));
vi.mock("@/lib/integrations/tally/import-items", () => ({ purgeTallyImportData: vi.fn(async () => void (h.purges += 1)) }));

import { automationSchedulerTick, mailingSchedulerTick } from "../scheduler-tick";

describe("tick : rétention Tally", () => {
  it("purge au plus une fois par fenêtre", async () => {
    await automationSchedulerTick();
    await automationSchedulerTick();
    expect(h.purges).toBe(1);
  });
});

describe("tick : mailing", () => {
  it("mailingSchedulerTick calls mailingTick and absorbs its errors", async () => {
    h.mailThrows = true;
    const before = h.mailTicks;
    await expect(mailingSchedulerTick()).resolves.toBeUndefined();
    expect(h.mailTicks).toBe(before + 1);
  });
});
