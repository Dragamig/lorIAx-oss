import { describe, it, expect, vi, beforeEach } from "vitest";

const { createNotification } = vi.hoisted(() => ({ createNotification: vi.fn() }));
vi.mock("@/lib/notifications", () => ({ createNotification }));

import { notifyUserAction } from "@/lib/automations/actions/notify-user";
import type { AutomationRow, ExecutionContext } from "@/lib/automations/actions/types";

const automation = { id: "a1", databaseId: null, spaceId: "s1", name: "n", triggerType: "manual", triggerConfig: {}, actionType: "notify_user", actionConfig: {}, enabled: true, lastRunAt: null, createdBy: "u-creator" } as AutomationRow;

describe("action notify_user", () => {
  beforeEach(() => createNotification.mockReset());

  it("interpole le destinataire depuis le contexte et crée une notification", async () => {
    const ctx: ExecutionContext = { event: "manual", user: { id: "u-42" } };
    const res = await notifyUserAction.execute(
      { userId: "{{user.id}}", title: "Tâche prête", message: "Bonjour {{user.id}}" },
      automation,
      ctx
    );
    expect(createNotification).toHaveBeenCalledWith({
      userId: "u-42",
      type: "automation",
      title: "Tâche prête",
      message: "Bonjour u-42",
    });
    expect(res).toEqual({ notified: { userId: "u-42" } });
  });

  it("rejette si le destinataire est vide après interpolation", async () => {
    await expect(
      notifyUserAction.execute({ userId: "{{cells.absent}}", title: "x" }, automation, { event: "manual", cells: {} })
    ).rejects.toThrow(/destinataire/i);
    expect(createNotification).not.toHaveBeenCalled();
  });

  it("le schéma refuse un titre manquant", () => {
    expect(notifyUserAction.configSchema.safeParse({ userId: "u" }).success).toBe(false);
  });
});
