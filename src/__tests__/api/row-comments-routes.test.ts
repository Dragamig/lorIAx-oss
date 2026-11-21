import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest, NextResponse } from "next/server";

const h = vi.hoisted(() => ({
  scope: "ok" as "ok" | 404,
  permission: "editor" as "viewer" | "editor" | "admin",
  row: true,
  notified: [] as unknown[],
  create: vi.fn(),
  edit: vi.fn(),
  del: vi.fn(),
  restore: vi.fn(),
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
      return { user: { id: "u1", name: "Ana" }, orgId: "org1", spaceId: "space1", permission: h.permission };
    }),
  };
});
vi.mock("@/lib/db", () => ({ db: {} }));
vi.mock("@/lib/logger", () => ({ default: { error: vi.fn(), warn: vi.fn(), info: vi.fn() } }));
vi.mock("@/lib/databases/row-writes", () => ({
  findRowById: vi.fn(async () => (h.row ? { id: "r" } : undefined)),
}));
vi.mock("@/lib/databases/row-eligibility", () => ({ makeCanView: vi.fn(() => async () => true) }));
vi.mock("@/lib/notifications", () => ({
  createNotifications: vi.fn(async (...a: unknown[]) => {
    h.notified.push(a);
  }),
}));
vi.mock("@/lib/databases/row-comments", async () => {
  const actual = await vi.importActual<typeof import("@/lib/databases/row-comments")>(
    "@/lib/databases/row-comments"
  );
  return {
    RowCommentError: actual.RowCommentError,
    createRowComment: h.create,
    editRowComment: h.edit,
    deleteRowComment: h.del,
    restoreRowComment: h.restore,
  };
});

import { RowCommentError } from "@/lib/databases/row-comments";
import { POST } from "@/app/api/databases/[databaseId]/rows/[rowId]/comments/route";
import { PATCH, DELETE } from "@/app/api/databases/[databaseId]/rows/[rowId]/comments/[commentId]/route";
import { POST as RESTORE } from "@/app/api/databases/[databaseId]/rows/[rowId]/comments/[commentId]/restore/route";

const DB = "11111111-1111-4111-8111-111111111111";
const ROW = "22222222-2222-4222-8222-222222222222";
const CID = "33333333-3333-4333-8333-333333333333";
const M1 = "44444444-4444-4444-8444-444444444444";

const req = (body?: unknown) =>
  new NextRequest("http://localhost/api/x", {
    method: "POST",
    body: body === undefined ? undefined : JSON.stringify(body),
    headers: { "content-type": "application/json" },
  });
const p = (row = ROW) => ({ params: Promise.resolve({ databaseId: DB, rowId: row }) });
const pc = (row = ROW) => ({ params: Promise.resolve({ databaseId: DB, rowId: row, commentId: CID }) });
const comment = { id: CID, body: "x" };

beforeEach(() => {
  h.scope = "ok";
  h.permission = "editor";
  h.row = true;
  h.notified = [];
  for (const f of [h.create, h.edit, h.del, h.restore]) f.mockReset();
  h.create.mockResolvedValue({ comment, newMentions: [] });
  h.edit.mockResolvedValue({ comment, newMentions: [] });
  h.del.mockResolvedValue(comment);
  h.restore.mockResolvedValue(comment);
});

describe("POST commentaires", () => {
  it("viewer 403, autre organisation 404, ligne inexistante 404", async () => {
    h.permission = "viewer";
    expect((await POST(req({ body: "a" }), p())).status).toBe(403);
    h.permission = "editor";
    h.scope = 404;
    expect((await POST(req({ body: "a" }), p())).status).toBe(404);
    h.scope = "ok";
    h.row = false;
    expect((await POST(req({ body: "a" }), p())).status).toBe(404);
    expect(h.create).not.toHaveBeenCalled();
  });

  it("rowId non uuid : 404", async () => {
    expect((await POST(req({ body: "a" }), p("nope"))).status).toBe(404);
  });

  it("corps vide, espaces, 5001 caracteres : 400", async () => {
    for (const body of ["", "   ", "a".repeat(5001), 12]) {
      const r = await POST(req({ body }), p());
      expect(r.status).toBe(400);
      expect(await r.json()).toEqual({ error: "Commentaire invalide" });
    }
    const bad = new NextRequest("http://localhost/api/x", { method: "POST", body: "{" });
    expect((await POST(bad, p())).status).toBe(400);
  });

  it("5000 caracteres : 201", async () => {
    const r = await POST(req({ body: "a".repeat(5000) }), p());
    expect(r.status).toBe(201);
    expect(await r.json()).toEqual({ comment });
  });

  it("spaceId vient de la garde, pas du client", async () => {
    await POST(req({ body: "a", spaceId: "evil" }), p());
    expect(h.create.mock.calls[0][1]).toMatchObject({ databaseId: DB, rowId: ROW, orgId: "org1" });
    expect(JSON.stringify(h.create.mock.calls[0][1])).not.toContain("evil");
  });

  it("notifie les newMentions sans extrait du corps", async () => {
    h.create.mockResolvedValue({ comment, newMentions: [M1] });
    await POST(req({ body: "secret @[B](user:" + M1 + ")" }), p());
    expect(h.notified).toHaveLength(1);
    const [ids, params] = h.notified[0] as [string[], Record<string, unknown>];
    expect(ids).toEqual([M1]);
    expect(params).toMatchObject({
      type: "mention",
      title: "Ana vous a mentionné dans une fiche",
      databaseId: DB,
      rowId: ROW,
      actorId: "u1",
    });
    expect(params.message).toBeUndefined();
    expect(JSON.stringify(h.notified)).not.toContain("secret");
  });

  it("échec de notification après écriture : 201, pas de 500", async () => {
    h.create.mockResolvedValue({ comment, newMentions: [M1] });
    const { createNotifications } = await import("@/lib/notifications");
    vi.mocked(createNotifications).mockRejectedValueOnce(new Error("boom"));
    const r = await POST(req({ body: "a" }), p());
    expect(r.status).toBe(201);
    expect(await r.json()).toEqual({ comment });
  });

  it("sans mention : aucune notification", async () => {
    await POST(req({ body: "a" }), p());
    expect(h.notified).toHaveLength(0);
  });
});

describe("PATCH commentaire", () => {
  it("auteur 200, corps invalide 400, viewer 403", async () => {
    expect((await PATCH(req({ body: "b" }), pc())).status).toBe(200);
    expect((await PATCH(req({ body: " " }), pc())).status).toBe(400);
    h.permission = "viewer";
    expect((await PATCH(req({ body: "b" }), pc())).status).toBe(403);
  });

  it("autre editeur ou admin : forbidden 403 ; not_found 404", async () => {
    h.edit.mockRejectedValue(new RowCommentError("forbidden"));
    expect((await PATCH(req({ body: "b" }), pc())).status).toBe(403);
    h.permission = "admin";
    expect((await PATCH(req({ body: "b" }), pc())).status).toBe(403);
    h.edit.mockRejectedValue(new RowCommentError("not_found"));
    expect((await PATCH(req({ body: "b" }), pc())).status).toBe(404);
  });

  it("notifie seulement les nouvelles mentions", async () => {
    h.edit.mockResolvedValue({ comment, newMentions: [M1] });
    await PATCH(req({ body: "b" }), pc());
    expect((h.notified[0] as [string[]])[0]).toEqual([M1]);
    h.notified = [];
    h.edit.mockResolvedValue({ comment, newMentions: [] });
    await PATCH(req({ body: "b" }), pc());
    expect(h.notified).toHaveLength(0);
  });

  it("échec de notification après édition : 200, pas de 500", async () => {
    h.edit.mockResolvedValue({ comment, newMentions: [M1] });
    const { createNotifications } = await import("@/lib/notifications");
    vi.mocked(createNotifications).mockRejectedValueOnce(new Error("boom"));
    const r = await PATCH(req({ body: "b" }), pc());
    expect(r.status).toBe(200);
    expect(await r.json()).toEqual({ comment });
  });

  it("commentaire non uuid : 404", async () => {
    const r = await PATCH(req({ body: "b" }), { params: Promise.resolve({ databaseId: DB, rowId: ROW, commentId: "x" }) });
    expect(r.status).toBe(404);
  });
});

describe("DELETE et restore", () => {
  it("DELETE : 200 JSON, forbidden 403, viewer 403, deux fois 200", async () => {
    const r = await DELETE(req(), pc());
    expect(r.status).toBe(200);
    expect(await r.json()).toEqual({ comment });
    expect((await DELETE(req(), pc())).status).toBe(200);
    h.del.mockRejectedValue(new RowCommentError("forbidden"));
    expect((await DELETE(req(), pc())).status).toBe(403);
    h.permission = "viewer";
    expect((await DELETE(req(), pc())).status).toBe(403);
  });

  it("restore : 200, forbidden 403, purge 404", async () => {
    expect((await RESTORE(req(), pc())).status).toBe(200);
    h.restore.mockRejectedValue(new RowCommentError("forbidden"));
    expect((await RESTORE(req(), pc())).status).toBe(403);
    h.restore.mockRejectedValue(new RowCommentError("not_found"));
    expect((await RESTORE(req(), pc())).status).toBe(404);
  });

  it("commentaire d'une autre ligne : 404 identique a l'absence", async () => {
    h.del.mockRejectedValue(new RowCommentError("not_found"));
    const a = await DELETE(req(), pc());
    expect(a.status).toBe(404);
    expect(await a.json()).toEqual({ error: "Introuvable" });
  });

  it("autre organisation : 404", async () => {
    h.scope = 404;
    expect((await DELETE(req(), pc())).status).toBe(404);
    expect((await RESTORE(req(), pc())).status).toBe(404);
  });
});
