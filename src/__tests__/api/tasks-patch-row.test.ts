import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

const h = vi.hoisted(() => ({
  user: { id: "u1" } as { id: string } | null,
  selects: [] as unknown[][],
  directUpdates: [] as unknown[],
  eligible: true,
  updateWithEvents: vi.fn(),
  notify: vi.fn(),
  onboarding: vi.fn(),
  member: true,
  perm: "editor" as string | null,
}));

function chain(result: () => unknown[]) {
  const c: Record<string, unknown> = {};
  for (const m of ["from", "innerJoin", "where", "limit"]) c[m] = () => c;
  c.then = (res: (v: unknown) => unknown) => Promise.resolve(result()).then(res);
  return c;
}

vi.mock("@/lib/db", () => ({
  db: {
    select: () => chain(() => h.selects.shift() ?? []),
    update: () => ({
      set: (v: unknown) => ({
        where: () => ({
          returning: async () => {
            h.directUpdates.push(v);
            return [{ id: "t", ...(v as object) }];
          },
        }),
      }),
    }),
  },
}));
vi.mock("@/lib/auth/get-user", () => ({ getSessionUser: vi.fn(async () => h.user) }));
vi.mock("@/lib/logger", () => ({ default: { error: vi.fn(), warn: vi.fn(), info: vi.fn() } }));
vi.mock("@/lib/org/resolve-request-org", () => ({ isOrgMember: vi.fn(async () => h.member) }));
vi.mock("@/lib/auth/check-access", () => ({ getSpacePermission: vi.fn(async () => h.perm) }));
vi.mock("@/lib/tasks/update-task", () => ({ updateTaskWithEvents: h.updateWithEvents }));
vi.mock("@/lib/tasks/notify-task-assigned", () => ({ notifyTaskAssigned: h.notify }));
vi.mock("@/lib/onboarding/progress", () => ({
  recordOnboardingEvent: (...a: unknown[]) => {
    h.onboarding(...a);
    return Promise.resolve();
  },
}));
vi.mock("@/lib/databases/row-eligibility", () => ({
  makeCanView: vi.fn(() => async () => true),
  isEligibleUser: vi.fn(async () => h.eligible),
}));

import { PATCH } from "@/app/api/tasks/[id]/route";

const ID = "11111111-1111-4111-8111-111111111111";
const OTHER = "22222222-2222-4222-8222-222222222222";
const SAME = "33333333-3333-4333-8333-333333333333";
const req = (body: unknown) =>
  new NextRequest("http://localhost/api/tasks/x", {
    method: "PATCH",
    body: JSON.stringify(body),
    headers: { "content-type": "application/json" },
  });
const call = (body: unknown) => PATCH(req(body), { params: Promise.resolve({ id: ID }) });

const rowTask = {
  id: ID,
  kind: "database_row",
  status: "open",
  assigneeId: "u1",
  createdBy: "u1",
  databaseId: "db1",
  rowId: "r1",
};
const SCOPE = { spaceId: "s1", orgId: "o1" };
const docTask = { ...rowTask, kind: "document_item", databaseId: null, rowId: null };

beforeEach(() => {
  h.user = { id: "u1" };
  h.selects = [];
  h.directUpdates = [];
  h.eligible = true;
  h.member = true;
  h.perm = "editor";
  h.updateWithEvents.mockReset();
  h.notify.mockReset();
  h.onboarding.mockReset();
  h.updateWithEvents.mockImplementation(async (_db, a) => ({
    previous: rowTask,
    updated: { ...rowTask, ...a.patch },
    eventKind: null,
  }));
});

describe("PATCH /api/tasks/[id]", () => {
  it("tâche inexistante : 404", async () => {
    h.selects = [[]];
    expect((await call({ status: "done" })).status).toBe(404);
  });

  it("ni assigné ni créateur : 403", async () => {
    h.selects = [[{ ...rowTask, assigneeId: OTHER, createdBy: OTHER }]];
    expect((await call({ status: "done" })).status).toBe(403);
    expect(h.updateWithEvents).not.toHaveBeenCalled();
  });

  it("assigné sans accès à l'espace : 422, rien n'est écrit", async () => {
    h.selects = [[rowTask], [SCOPE]];
    h.eligible = false;
    const res = await call({ assigneeId: OTHER });
    expect(res.status).toBe(422);
    expect(h.updateWithEvents).not.toHaveBeenCalled();
    expect(h.directUpdates).toEqual([]);
    expect(h.notify).not.toHaveBeenCalled();
  });

  it("assigné éligible : 200 et notification d'assignation", async () => {
    h.selects = [[rowTask], [SCOPE]];
    const res = await call({ assigneeId: OTHER });
    expect(res.status).toBe(200);
    expect(h.notify).toHaveBeenCalledWith(ID, OTHER, "u1");
  });

  it("assigné inchangé : pas de contrôle d'éligibilité", async () => {
    const { isEligibleUser } = await import("@/lib/databases/row-eligibility");
    vi.mocked(isEligibleUser).mockClear();
    h.selects = [[{ ...rowTask, assigneeId: SAME }], [SCOPE]];
    const res = await call({ assigneeId: SAME, status: "done" });
    expect(res.status).toBe(200);
    expect(isEligibleUser).not.toHaveBeenCalled();
  });

  it("done sur une tâche database_row : updateTaskWithEvents appelé", async () => {
    h.selects = [[rowTask], [SCOPE]];
    const res = await call({ status: "done" });
    expect(res.status).toBe(200);
    expect(h.updateWithEvents).toHaveBeenCalledTimes(1);
    expect(h.updateWithEvents.mock.calls[0][1]).toMatchObject({
      taskId: ID,
      actorUserId: "u1",
      patch: { status: "done" },
    });
    expect(h.directUpdates).toEqual([]);
    expect(h.onboarding).toHaveBeenCalledWith("u1", "tasks");
  });

  it("créateur ex-membre de l'organisation : 404 sur dueAt et sur réassignation", async () => {
    h.member = false;
    h.selects = [[{ ...rowTask, assigneeId: OTHER }], [SCOPE]];
    expect((await call({ dueAt: "2026-12-01T10:00:00.000Z" })).status).toBe(404);
    h.selects = [[{ ...rowTask, assigneeId: OTHER }], [SCOPE]];
    expect((await call({ assigneeId: SAME })).status).toBe(404);
    h.selects = [[{ ...rowTask, assigneeId: OTHER }], [SCOPE]];
    expect((await call({ status: "done" })).status).toBe(404);
    expect(h.updateWithEvents).not.toHaveBeenCalled();
    expect(h.notify).not.toHaveBeenCalled();
  });

  it("créateur membre mais sans accès éditeur à l'espace : 404", async () => {
    h.perm = "viewer";
    h.selects = [[{ ...rowTask, assigneeId: OTHER }], [SCOPE]];
    expect((await call({ dueAt: null })).status).toBe(404);
    h.perm = null;
    h.selects = [[{ ...rowTask, assigneeId: OTHER }], [SCOPE]];
    expect((await call({ status: "done" })).status).toBe(404);
  });

  it("assigné sans accès à l'espace : peut changer le statut, pas l'échéance ni l'assignation", async () => {
    h.member = false;
    h.perm = null;
    h.selects = [[{ ...rowTask, createdBy: OTHER }], [SCOPE]];
    expect((await call({ status: "done" })).status).toBe(200);
    expect(h.updateWithEvents).toHaveBeenCalledTimes(1);
    h.selects = [[{ ...rowTask, createdBy: OTHER }], [SCOPE]];
    expect((await call({ status: "done", dueAt: "2026-12-01T10:00:00.000Z" })).status).toBe(404);
    h.selects = [[{ ...rowTask, createdBy: OTHER }], [SCOPE]];
    expect((await call({ assigneeId: SAME })).status).toBe(404);
    expect(h.updateWithEvents).toHaveBeenCalledTimes(1);
  });

  it("éditeur avec accès : peut réassigner", async () => {
    h.selects = [[{ ...rowTask, assigneeId: OTHER }], [SCOPE]];
    const res = await call({ assigneeId: SAME });
    expect(res.status).toBe(200);
    expect(h.notify).toHaveBeenCalledWith(ID, SAME, "u1");
  });

  it("échec de notification d'assignation : 200, pas de 500", async () => {
    h.notify.mockRejectedValueOnce(new Error("boom"));
    h.selects = [[rowTask], [SCOPE]];
    expect((await call({ assigneeId: OTHER })).status).toBe(200);
  });

  it("s'assigner soi-même : aucune notification", async () => {
    h.user = { id: SAME };
    h.selects = [[{ ...rowTask, assigneeId: OTHER, createdBy: SAME }], [SCOPE]];
    expect((await call({ assigneeId: SAME })).status).toBe(200);
    expect(h.notify).not.toHaveBeenCalled();
  });

  it("tâche document_item : écriture directe inchangée, sans événement ni éligibilité", async () => {
    h.selects = [[docTask]];
    const res = await call({ status: "done", assigneeId: OTHER });
    expect(res.status).toBe(200);
    expect(h.updateWithEvents).not.toHaveBeenCalled();
    expect(h.directUpdates).toHaveLength(1);
    expect(h.directUpdates[0]).toMatchObject({ status: "done", assigneeId: OTHER });
    expect(h.notify).toHaveBeenCalledWith(ID, OTHER, "u1");
  });
});
