import { describe, it, expect, vi, beforeEach } from "vitest";

const h = vi.hoisted(() => ({
  user: { id: "u1" } as unknown,
  org: "org1" as string | null,
  list: vi.fn(),
  create: vi.fn(),
  rename: vi.fn(),
  move: vi.fn(),
  update: vi.fn(),
  del: vi.fn(),
  restore: vi.fn(),
}));

vi.mock("@/lib/auth/get-user", () => ({ getSessionUser: () => Promise.resolve(h.user) }));
vi.mock("@/lib/org/get-request-org", () => ({ getRequestOrgId: () => Promise.resolve(h.org) }));
vi.mock("@/lib/media/folders", async () => {
  class FolderError extends Error {
    status: number;
    constructor(status: number, message: string) {
      super(message);
      this.status = status;
    }
  }
  return {
    FolderError,
    listFolders: h.list,
    createFolder: h.create,
    renameFolder: h.rename,
    moveFolder: h.move,
    updateFolder: h.update,
    deleteFolder: h.del,
    restoreFolder: h.restore,
  };
});

import { NextRequest } from "next/server";
import { FolderError } from "@/lib/media/folders";

const ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const json = (method: string, body: unknown, url = "http://x/api/media/folders") =>
  new NextRequest(url, { method, body: typeof body === "string" ? body : JSON.stringify(body) });
const ctx = (id = ID) => ({ params: Promise.resolve({ id }) });

beforeEach(() => {
  vi.clearAllMocks();
  h.user = { id: "u1" };
  h.org = "org1";
});

describe("/api/media/folders", () => {
  it("401 sans session (GET, POST, PATCH, DELETE)", async () => {
    h.user = null;
    const r = await import("@/app/api/media/folders/route");
    const r2 = await import("@/app/api/media/folders/[id]/route");
    expect((await r.GET()).status).toBe(401);
    expect((await r.POST(json("POST", {}))).status).toBe(401);
    expect((await r2.PATCH(json("PATCH", {}), ctx())).status).toBe(401);
    expect((await r2.DELETE(json("DELETE", {}), ctx())).status).toBe(401);
  });
  it("GET renvoie l'arbre, sans cache", async () => {
    h.list.mockResolvedValue([{ id: ID }]);
    const { GET } = await import("@/app/api/media/folders/route");
    const res = await GET();
    expect(res.headers.get("Cache-Control")).toBe("private, no-store");
    expect(await res.json()).toEqual({ folders: [{ id: ID }] });
  });
  it("POST 201, puis 409 et 403 propagés avec leur message", async () => {
    const { POST } = await import("@/app/api/media/folders/route");
    h.create.mockResolvedValueOnce({ id: ID, name: "x" });
    expect((await POST(json("POST", { name: "x" }))).status).toBe(201);
    h.create.mockRejectedValueOnce(new FolderError(409, "Doublon"));
    const dup = await POST(json("POST", { name: "x" }));
    expect(dup.status).toBe(409);
    expect((await dup.json()).error).toBe("Doublon");
    h.create.mockRejectedValueOnce(new FolderError(403, "Non"));
    expect((await POST(json("POST", { name: "x" }))).status).toBe(403);
  });
  it("POST 400 sur corps invalide ou parentId non texte, jamais 500", async () => {
    const { POST } = await import("@/app/api/media/folders/route");
    expect((await POST(json("POST", "pas du json"))).status).toBe(400);
    expect((await POST(json("POST", [1]))).status).toBe(400);
    expect((await POST(json("POST", { name: "x", parentId: 5 }))).status).toBe(400);
    expect(h.create).not.toHaveBeenCalled();
  });
});

describe("/api/media/folders/[id]", () => {
  it("404 sur un identifiant qui n'est pas un UUID", async () => {
    const { DELETE } = await import("@/app/api/media/folders/[id]/route");
    expect((await DELETE(json("DELETE", {}), ctx("nope"))).status).toBe(404);
    expect(h.del).not.toHaveBeenCalled();
  });
  it("PATCH renomme, déplace, ou refuse un corps vide", async () => {
    const { PATCH } = await import("@/app/api/media/folders/[id]/route");
    h.rename.mockResolvedValue({ id: ID, parentId: null, name: "n" });
    expect((await PATCH(json("PATCH", { name: "n" }), ctx())).status).toBe(200);
    expect(h.rename).toHaveBeenCalledWith(h.user, "org1", ID, "n");
    h.move.mockResolvedValue({ id: ID, parentId: null, name: "n" });
    expect((await PATCH(json("PATCH", { parentId: null }), ctx())).status).toBe(200);
    expect(h.move).toHaveBeenCalledWith(h.user, "org1", ID, null);
    expect((await PATCH(json("PATCH", {}), ctx())).status).toBe(400);
  });
  it("PATCH avec name et parentId : un seul appel atomique", async () => {
    const { PATCH } = await import("@/app/api/media/folders/[id]/route");
    h.update.mockResolvedValue({ id: ID, parentId: null, name: "n" });
    expect((await PATCH(json("PATCH", { name: "n", parentId: null }), ctx())).status).toBe(200);
    expect(h.update).toHaveBeenCalledWith(h.user, "org1", ID, { name: "n", parentId: null });
    expect(h.rename).not.toHaveBeenCalled();
    expect(h.move).not.toHaveBeenCalled();
  });
  it("PATCH 400 propagé d'un déplacement circulaire", async () => {
    const { PATCH } = await import("@/app/api/media/folders/[id]/route");
    h.move.mockRejectedValue(new FolderError(400, "Boucle"));
    const res = await PATCH(json("PATCH", { parentId: ID }), ctx());
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe("Boucle");
  });
  it("DELETE renvoie le résumé, 404 propagé", async () => {
    const { DELETE } = await import("@/app/api/media/folders/[id]/route");
    h.del.mockResolvedValueOnce({ movedMedia: 3, movedChildren: 2 });
    expect(await (await DELETE(json("DELETE", {}), ctx())).json()).toEqual({ movedMedia: 3, movedChildren: 2 });
    h.del.mockRejectedValueOnce(new FolderError(404, "Dossier introuvable"));
    expect((await DELETE(json("DELETE", {}), ctx())).status).toBe(404);
  });
});

describe("POST /api/media/folders/restore", () => {
  it("401 sans session, 400 corps invalide, 201 avec le résultat, statut de FolderError propagé", async () => {
    const { POST } = await import("@/app/api/media/folders/restore/route");
    h.user = null;
    expect((await POST(json("POST", { undo: {} }, "http://x/api/media/folders/restore"))).status).toBe(401);
    h.user = { id: "u1" };
    expect((await POST(json("POST", "[]", "http://x/api/media/folders/restore"))).status).toBe(400);
    h.restore.mockResolvedValueOnce({ folder: { id: ID }, restoredMedia: 1, restoredChildren: 0 });
    const res = await POST(json("POST", { undo: { folderId: ID } }, "http://x/api/media/folders/restore"));
    expect(res.status).toBe(201);
    expect(h.restore).toHaveBeenCalledWith({ id: "u1" }, "org1", { folderId: ID });
    h.restore.mockRejectedValueOnce(new FolderError(403, "Non"));
    expect((await POST(json("POST", { undo: {} }, "http://x/api/media/folders/restore"))).status).toBe(403);
  });
});
