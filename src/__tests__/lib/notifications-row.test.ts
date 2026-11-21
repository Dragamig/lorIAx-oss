import { describe, it, expect, vi, beforeEach } from "vitest";

const h = vi.hoisted(() => ({
  values: vi.fn(),
  sendEmail: vi.fn(),
  taskRow: { current: null as unknown },
}));

vi.mock("@/lib/db", () => {
  const select = () => ({
    from: () => ({
      leftJoin: () => ({ where: () => ({ limit: async () => [] }) }),
      where: () => ({
        limit: async () => (h.taskRow.current ? [h.taskRow.current] : [{ email: "a@b.fr", name: "A" }]),
      }),
    }),
  });
  return { db: { insert: () => ({ values: h.values }), select } };
});
vi.mock("@/lib/email/send", () => ({ sendEmail: h.sendEmail }));
vi.mock("@/lib/logger", () => ({ default: { error: vi.fn() } }));

import { createNotification, createNotifications } from "@/lib/notifications";
import { notifyTaskAssigned } from "@/lib/tasks/notify-task-assigned";

const flush = () => new Promise((r) => setTimeout(r, 10));

describe("notifications de ligne", () => {
  beforeEach(() => {
    h.values.mockReset();
    h.sendEmail.mockReset();
    h.taskRow.current = null;
  });

  it("createNotification persiste database_id et row_id", async () => {
    await createNotification({ userId: "u1", type: "comment", title: "t", databaseId: "d1", rowId: "r1", actorId: "u2" });
    expect(h.values).toHaveBeenCalledWith(expect.objectContaining({ databaseId: "d1", rowId: "r1", documentId: null }));
  });

  it("createNotifications persiste les deux colonnes pour chaque destinataire et exclut l'acteur", async () => {
    await createNotifications(["u1", "u2", "u3"], { type: "mention", title: "t", databaseId: "d1", rowId: "r1", actorId: "u2" });
    const rows = h.values.mock.calls[0][0];
    expect(rows).toHaveLength(2);
    expect(rows.map((r: { userId: string }) => r.userId)).toEqual(["u1", "u3"]);
    for (const r of rows) expect(r).toMatchObject({ databaseId: "d1", rowId: "r1" });
  });

  it("aucun courriel pour une notification de ligne", async () => {
    await createNotification({ userId: "u1", type: "comment", title: "t", databaseId: "d1", rowId: "r1" });
    await flush();
    expect(h.sendEmail).not.toHaveBeenCalled();
    await createNotification({ userId: "u1", type: "comment", title: "t" });
    await flush();
    expect(h.sendEmail).toHaveBeenCalledTimes(1);
  });

  it("notifyTaskAssigned d'une tâche database_row transmet databaseId et rowId et pas documentId", async () => {
    h.taskRow.current = { id: "t1", title: "X", documentId: null, databaseId: "d1", rowId: "r1" };
    await notifyTaskAssigned("t1", "u1", "u2");
    expect(h.values).toHaveBeenCalledWith(
      expect.objectContaining({ type: "task_assigned", databaseId: "d1", rowId: "r1", documentId: null }),
    );
  });

  it("notifyTaskAssigned d'une tâche de document reste inchangé", async () => {
    h.taskRow.current = { id: "t1", title: "X", documentId: "doc1", databaseId: null, rowId: null };
    await notifyTaskAssigned("t1", "u1", "u2");
    expect(h.values).toHaveBeenCalledWith(
      expect.objectContaining({ documentId: "doc1", databaseId: null, rowId: null }),
    );
  });
});
