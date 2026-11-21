import { describe, it, expect, vi } from "vitest";

const h = vi.hoisted(() => ({ notify: vi.fn(), logError: vi.fn() }));
vi.mock("@/lib/db", () => ({ db: {} }));
vi.mock("@/lib/logger", () => ({ default: { error: h.logError } }));
vi.mock("../notify-task-assigned", () => ({ notifyTaskAssigned: h.notify }));
vi.mock("../record-task-event", () => ({ recordTaskEvent: vi.fn() }));

import { createTask } from "../create-task";

const exec = {
  transaction: async (fn: (tx: unknown) => unknown) =>
    fn({ insert: () => ({ values: () => ({ returning: async () => [{ id: "t1" }] }) }) }),
};

describe("createTask : échec de notification", () => {
  it("résout avec { id } et journalise l'erreur", async () => {
    h.notify.mockRejectedValue(new Error("boom"));
    const r = await createTask(
      { title: "a", createdBy: "u1", assigneeId: "u2" },
      exec as never,
    );
    expect(r).toEqual({ id: "t1" });
    expect(h.logError).toHaveBeenCalledTimes(1);
  });
});
