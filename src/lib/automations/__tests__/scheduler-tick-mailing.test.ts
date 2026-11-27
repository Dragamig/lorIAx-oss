import { describe, it, expect, vi, afterEach } from "vitest";

const { tickCron, tickDateAutomations, mailingTick } = vi.hoisted(() => ({
  tickCron: vi.fn(),
  tickDateAutomations: vi.fn().mockResolvedValue({ ran: 0, rows: 0 }),
  mailingTick: vi.fn().mockResolvedValue({ delivered: 0, reconciled: 0 }),
}));
vi.mock("@/lib/automations/executor", () => ({ tickCron, tickDateAutomations }));
vi.mock("@/lib/mailing/tick", () => ({ mailingTick }));
vi.mock("@/lib/integrations/tally/import-runner", () => ({ failStaleTallyImports: vi.fn() }));
vi.mock("@/lib/integrations/tally/import-items", () => ({ purgeTallyImportData: vi.fn() }));

import { automationSchedulerTick, mailingSchedulerTick } from "@/lib/automations/scheduler-tick";
import { SEND_TIMEOUT_MS } from "@/lib/mailing/timeouts";
import { STEP_TIMEOUT_MS } from "@/lib/automations/with-timeout";

afterEach(() => {
  vi.useRealTimers();
  vi.clearAllMocks();
});

describe("tick mailing indépendant", () => {
  it("automationSchedulerTick n'appelle plus le tick mailing", async () => {
    tickCron.mockResolvedValue({ ran: 0, skipped: 0 });
    await automationSchedulerTick();
    expect(mailingTick).not.toHaveBeenCalled();
  });

  it("une étape d'automatisme qui ne rend jamais la main n'empêche pas le tick mailing", async () => {
    vi.useFakeTimers();
    vi.spyOn(console, "warn").mockImplementation(() => {});
    tickCron.mockImplementation(() => new Promise(() => {}));
    void automationSchedulerTick();
    await mailingSchedulerTick();
    expect(mailingTick).toHaveBeenCalledOnce();
  });

  it("le tick automatismes borne l'étape bloquée et passe aux suivantes", async () => {
    vi.useFakeTimers();
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    tickCron.mockImplementation(() => new Promise(() => {}));
    const p = automationSchedulerTick();
    await vi.advanceTimersByTimeAsync(50_000);
    await p;
    expect(tickDateAutomations).toHaveBeenCalled();
    expect(warn).toHaveBeenCalledWith(expect.stringContaining("automations-cron"));
  });

  it("l'étape mailing attend plus longtemps qu'un envoi SMTP (SEND_TIMEOUT_MS)", async () => {
    vi.useFakeTimers();
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    mailingTick.mockImplementation(() => new Promise(() => {}));
    const p = mailingSchedulerTick();
    await vi.advanceTimersByTimeAsync(STEP_TIMEOUT_MS + 1);
    expect(warn).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(SEND_TIMEOUT_MS);
    await p;
    expect(warn).toHaveBeenCalledWith(expect.stringContaining("mailing-tick"));
  });
});
