import { describe, it, expect, vi } from "vitest";

const h = vi.hoisted(() => ({ purges: 0 }));
vi.mock("@/lib/automations/executor", () => ({ tickCron: vi.fn(async () => {}), tickDateAutomations: vi.fn(async () => {}) }));
vi.mock("@/lib/integrations/tally/import-runner", () => ({ failStaleTallyImports: vi.fn(async () => {}) }));
vi.mock("@/lib/integrations/tally/import-items", () => ({ purgeTallyImportData: vi.fn(async () => void (h.purges += 1)) }));

import { automationSchedulerTick } from "../scheduler-tick";

describe("tick : rétention Tally", () => {
  it("purge au plus une fois par fenêtre", async () => {
    await automationSchedulerTick();
    await automationSchedulerTick();
    expect(h.purges).toBe(1);
  });
});
