import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest, NextResponse } from "next/server";

const h = vi.hoisted(() => ({
  scope: "ok" as "ok" | 404,
  permission: "editor" as "viewer" | "editor" | "admin",
  row: true,
  eligible: true,
  list: vi.fn(),
  count: vi.fn(),
  get: vi.fn(),
  dto: vi.fn(),
  del: vi.fn(),
  create: vi.fn(),
  update: vi.fn(),
  notify: vi.fn(),
  isEligible: vi.fn(),
}));

vi.mock("@/lib/auth/require-org-scoped", () => {
  class OrgScopeError extends Error {
    constructor(public response: Response) {
      super("scope");
    }
  }
  return {
    OrgScopeError,
    requireOrgScoped: vi.fn(async () => {
      if (h.scope === 404) throw new OrgScopeError(NextResponse.json({ error: "Introuvable" }, { status: 404 }));
      return { user: { id: ME, name: "Ana" }, orgId: "org1", spaceId: "space1", permission: h.permission };
    }),
  };
});
vi.mock("@/lib/db", () => ({ db: {} }));
vi.mock("@/lib/logger", () => ({ default: { error: vi.fn() }, logger: { error: vi.fn() } }));
vi.mock("@/lib/databases/row-writes", () => ({
  findRowById: vi.fn(async () => (h.row ? { id: "r" } : undefined)),
}));
vi.mock("@/lib/databases/row-eligibility", () => ({
  makeCanView: vi.fn(() => async () => true),
  isEligibleUser: h.isEligible,
}));
vi.mock("@/lib/databases/row-tasks", () => ({
  listRowTasks: h.list,
  countOpenRowTasks: h.count,
  getRowTask: h.get,
  getRowTaskDto: h.dto,
  deleteRowTask: h.del,
}));
vi.mock("@/lib/tasks/create-task", () => ({ createTask: h.create }));
vi.mock("@/lib/tasks/update-task", () => ({ updateTaskWithEvents: h.update }));
vi.mock("@/lib/tasks/notify-task-assigned", () => ({ notifyTaskAssigned: h.notify }));

import { GET, POST } from "@/app/api/databases/[databaseId]/rows/[rowId]/tasks/route";
import { PATCH, DELETE } from "@/app/api/databases/[databaseId]/rows/[rowId]/tasks/[taskId]/route";

const DB = "11111111-1111-4111-8111-111111111111";
const ROW = "22222222-2222-4222-8222-222222222222";
const TID = "33333333-3333-4333-8333-333333333333";
const OTHER = "44444444-4444-4444-8444-444444444444";
const ME = "55555555-5555-4555-8555-555555555555";

const req = (body?: unknown, method = "POST") =>
  new NextRequest("http://localhost/api/x", {
    method,
    body: body === undefined ? undefined : JSON.stringify(body),
    headers: { "content-type": "application/json" },
  });
const p = () => ({ params: Promise.resolve({ databaseId: DB, rowId: ROW }) });
const pt = () => ({ params: Promise.resolve({ databaseId: DB, rowId: ROW, taskId: TID }) });
const dto = {
  id: TID,
  title: "t",
  status: "open",
  dueAt: null,
  assignee: { id: ME, name: "Ana" },
  createdBy: ME,
  createdAt: "2026-11-16T00:00:00.000Z",
};
const task = { id: TID, assigneeId: null, createdBy: "u9", status: "open" };

beforeEach(() => {
  h.scope = "ok";
  h.permission = "editor";
  h.row = true;
  for (const f of [h.list, h.count, h.get, h.dto, h.del, h.create, h.update, h.notify, h.isEligible]) f.mockReset();
  h.list.mockResolvedValue([]);
  h.count.mockResolvedValue(0);
  h.get.mockResolvedValue(task);
  h.dto.mockResolvedValue(dto);
  h.create.mockResolvedValue({ id: TID });
  h.update.mockResolvedValue({ previous: task, updated: { ...task }, eventKind: null });
  h.isEligible.mockResolvedValue(true);
  h.del.mockResolvedValue("deleted");
});

describe("GET tâches de ligne", () => {
  it("viewer autorisé", async () => {
    h.permission = "viewer";
    h.list.mockResolvedValue([{ id: TID }]);
    h.count.mockResolvedValue(1);
    const res = await GET(req(undefined, "GET"), p());
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ tasks: [{ id: TID }], openCount: 1, permission: "viewer" });
  });
  it("autre organisation : 404", async () => {
    h.scope = 404;
    expect((await GET(req(undefined, "GET"), p())).status).toBe(404);
  });
});

describe("POST tâche de ligne", () => {
  it("viewer : 403", async () => {
    h.permission = "viewer";
    expect((await POST(req({ title: "a" }), p())).status).toBe(403);
  });
  it("ligne inexistante : 404", async () => {
    h.row = false;
    expect((await POST(req({ title: "a" }), p())).status).toBe(404);
  });
  it.each([
    [{ title: "   " }],
    [{ title: "a".repeat(501) }],
    [{ title: "a", dueAt: "pas une date" }],
    [{ title: "a", assigneeId: "pas-un-uuid" }],
  ])("corps invalide %j : 400", async (body) => {
    expect((await POST(req(body), p())).status).toBe(400);
    expect(h.create).not.toHaveBeenCalled();
  });
  it("corps absent : 400", async () => {
    expect((await POST(req(), p())).status).toBe(400);
  });
  it("assigné non éligible : 422 au corps générique", async () => {
    h.isEligible.mockResolvedValue(false);
    const res = await POST(req({ title: "a", assigneeId: OTHER }), p());
    expect(res.status).toBe(422);
    expect(await res.json()).toEqual({ error: "Cet utilisateur n'a pas accès à cette fiche" });
    expect(h.create).not.toHaveBeenCalled();
  });
  it("assigné éligible : createTask avec base et ligne, une seule notification (celle de createTask)", async () => {
    const res = await POST(req({ title: " a ", assigneeId: OTHER, dueAt: "2026-12-01T10:00:00.000Z" }), p());
    expect(res.status).toBe(201);
    expect(h.create).toHaveBeenCalledTimes(1);
    expect(h.create.mock.calls[0][0]).toMatchObject({
      kind: "database_row",
      databaseId: DB,
      rowId: ROW,
      assigneeId: OTHER,
      createdBy: ME,
      title: "a",
    });
    expect(h.create.mock.calls[0][0].dueAt).toEqual(new Date("2026-12-01T10:00:00.000Z"));
    expect(h.notify).not.toHaveBeenCalled();
  });
  it("auto-assignation : pas de contrôle d'éligibilité nécessaire, aucune notification route", async () => {
    const res = await POST(req({ title: "a", assigneeId: ME }), p());
    expect(res.status).toBe(201);
    expect(h.notify).not.toHaveBeenCalled();
  });
  it("renvoie le DTO de la tâche créée", async () => {
    const res = await POST(req({ title: "a" }), p());
    expect(await res.json()).toEqual({ task: dto });
    expect(h.dto).toHaveBeenCalledWith({}, { databaseId: DB, rowId: ROW, taskId: TID });
  });
  it("sans échéance : dueAt nul, pas de date par défaut", async () => {
    await POST(req({ title: "a" }), p());
    expect(h.create.mock.calls[0][0].dueAt ?? null).toBeNull();
  });
});

describe("PATCH tâche de ligne", () => {
  it("statut done puis open : appelle updateTaskWithEvents avec la patch", async () => {
    for (const status of ["done", "open"]) {
      h.update.mockClear();
      const res = await PATCH(req({ status }, "PATCH"), pt());
      expect(res.status).toBe(200);
      expect(h.update).toHaveBeenCalledWith(
        {},
        expect.objectContaining({ taskId: TID, actorUserId: ME, patch: { status } })
      );
    }
  });
  it("tâche d'une autre ligne : 404", async () => {
    h.get.mockResolvedValue(null);
    expect((await PATCH(req({ status: "done" }, "PATCH"), pt())).status).toBe(404);
    expect(h.update).not.toHaveBeenCalled();
  });
  it("assigneeId null : pas de contrôle, pas de notification", async () => {
    const res = await PATCH(req({ assigneeId: null }, "PATCH"), pt());
    expect(res.status).toBe(200);
    expect(h.isEligible).not.toHaveBeenCalled();
    expect(h.notify).not.toHaveBeenCalled();
  });
  it("assigné non éligible : 422", async () => {
    h.isEligible.mockResolvedValue(false);
    const res = await PATCH(req({ assigneeId: OTHER }, "PATCH"), pt());
    expect(res.status).toBe(422);
    expect(h.update).not.toHaveBeenCalled();
  });
  it("assigné changé et différent de l'acteur : une notification", async () => {
    h.update.mockResolvedValue({ previous: task, updated: { ...task, assigneeId: OTHER }, eventKind: null });
    await PATCH(req({ assigneeId: OTHER }, "PATCH"), pt());
    expect(h.notify).toHaveBeenCalledTimes(1);
    expect(h.notify).toHaveBeenCalledWith(TID, OTHER, ME);
  });
  it("assigné inchangé ou acteur lui-même : aucune notification", async () => {
    h.update.mockResolvedValue({ previous: { ...task, assigneeId: OTHER }, updated: { ...task, assigneeId: OTHER }, eventKind: null });
    await PATCH(req({ assigneeId: OTHER }, "PATCH"), pt());
    h.update.mockResolvedValue({ previous: task, updated: { ...task, assigneeId: ME }, eventKind: null });
    await PATCH(req({ assigneeId: ME }, "PATCH"), pt());
    expect(h.notify).not.toHaveBeenCalled();
  });
  it("échec de notification : reste 200", async () => {
    h.notify.mockRejectedValue(new Error("boom"));
    h.update.mockResolvedValue({ previous: task, updated: { ...task, assigneeId: OTHER }, eventKind: null });
    expect((await PATCH(req({ assigneeId: OTHER }, "PATCH"), pt())).status).toBe(200);
  });
  it("renvoie le DTO (assignee {id, name}), pas la ligne brute", async () => {
    const res = await PATCH(req({ title: "x" }, "PATCH"), pt());
    expect(await res.json()).toEqual({ task: dto });
  });
  it("corps vide {} : 400", async () => {
    expect((await PATCH(req({}, "PATCH"), pt())).status).toBe(400);
    expect(h.update).not.toHaveBeenCalled();
  });
  it("assigné inchangé : pas de contrôle d'éligibilité", async () => {
    h.get.mockResolvedValue({ ...task, assigneeId: OTHER });
    h.isEligible.mockResolvedValue(false);
    const res = await PATCH(req({ assigneeId: OTHER }, "PATCH"), pt());
    expect(res.status).toBe(200);
    expect(h.isEligible).not.toHaveBeenCalled();
  });
  it("éditeur ni assigné ni créateur : 200", async () => {
    expect((await PATCH(req({ title: "x" }, "PATCH"), pt())).status).toBe(200);
  });
  it("viewer : 403 ; corps invalide : 400", async () => {
    expect((await PATCH(req({ status: "nope" }, "PATCH"), pt())).status).toBe(400);
    h.permission = "viewer";
    expect((await PATCH(req({ status: "done" }, "PATCH"), pt())).status).toBe(403);
  });
});

describe("DELETE tâche de ligne", () => {
  it.each([
    ["deleted", 200],
    ["forbidden", 403],
    ["not_found", 404],
  ])("%s : %i", async (r, status) => {
    h.del.mockResolvedValue(r);
    const res = await DELETE(req(undefined, "DELETE"), pt());
    expect(res.status).toBe(status);
    if (status === 200) expect(await res.json()).toEqual({ deleted: true });
  });
  it("viewer : 403", async () => {
    h.permission = "viewer";
    expect((await DELETE(req(undefined, "DELETE"), pt())).status).toBe(403);
  });
});
