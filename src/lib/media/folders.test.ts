import { describe, expect, it, vi, beforeEach } from "vitest";

const h = vi.hoisted(() => ({
  queue: [] as unknown[],
  calls: [] as string[],
  admin: false,
  member: true,
  failInsert: null as unknown,
  db: null as unknown,
}));

function chain(kind: string): unknown {
  const self: unknown = new Proxy(
    {},
    {
      get(_t, prop) {
        if (prop === "then") {
          return (res: (v: unknown) => void, rej: (e: unknown) => void) => {
            h.calls.push(kind);
            if (kind === "insert" && h.failInsert) return rej(h.failInsert);
            res(h.queue.shift() ?? []);
          };
        }
        return () => self;
      },
    }
  );
  return self;
}
const dbMock: Record<string, unknown> = {
  select: () => chain("select"),
  insert: () => chain("insert"),
  update: () => chain("update"),
  delete: () => chain("delete"),
  transaction: (fn: (tx: unknown) => unknown) => fn(dbMock),
};
h.db = dbMock;

vi.mock("@/lib/db", () => ({
  db: new Proxy({}, { get: (_t, p) => (h.db as Record<string | symbol, unknown>)[p] }),
}));
vi.mock("@/lib/activity", () => ({ logActivity: vi.fn() }));
vi.mock("@/lib/media/access", () => ({ isOrgAdminOrOwner: () => Promise.resolve(h.admin) }));
vi.mock("@/lib/org/resolve-request-org", () => ({ isOrgMember: () => Promise.resolve(h.member) }));
vi.mock("@/lib/media/list", () => ({ listableMediaCondition: () => Promise.resolve({}) }));

import {
  FolderError,
  createFolder,
  deleteFolder,
  listFolders,
  moveFolder,
  renameFolder,
  updateFolder,
  canWriteLibrary,
  restoreFolder,
} from "./folders";

const ORG = "org1";
const editor = { id: "u1", globalRole: "editor" } as never;
const viewer = { id: "u2", globalRole: "viewer" } as never;
const A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const C = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const D = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";
const f = (id: string, parentId: string | null, name: string) => ({ id, parentId, name });

async function status(p: Promise<unknown>): Promise<number | null> {
  try {
    await p;
    return null;
  } catch (e) {
    if (e instanceof FolderError) return e.status;
    throw e;
  }
}

beforeEach(() => {
  h.queue = [];
  h.calls = [];
  h.admin = false;
  h.member = true;
  h.failInsert = null;
});

describe("canWriteLibrary", () => {
  it("editor global non membre de l'organisation : refusé", async () => {
    h.member = false;
    expect(await canWriteLibrary(editor, ORG)).toBe(false);
  });
  it("editor global membre : accepté ; viewer membre : refusé", async () => {
    expect(await canWriteLibrary(editor, ORG)).toBe(true);
    expect(await canWriteLibrary(viewer, ORG)).toBe(false);
  });
  it("admin/owner de l'organisation passe, même viewer global et sans membership generique", async () => {
    h.admin = true;
    h.member = false;
    expect(await canWriteLibrary(viewer, ORG)).toBe(true);
  });
  it("super_admin franchit l'organisation", async () => {
    h.member = false;
    expect(await canWriteLibrary({ id: "u9", globalRole: "super_admin" } as never, ORG)).toBe(true);
  });
});

describe("updateFolder", () => {
  const tree = () => [f(A, null, "a"), f(B, A, "b"), f(D, null, "d")];
  it("nom ET parent valides : une seule écriture", async () => {
    h.queue = [tree(), []];
    await updateFolder(editor, ORG, B, { name: "z", parentId: D });
    expect(h.calls.filter((c) => c === "update")).toHaveLength(1);
  });
  it("parent invalide : aucune écriture, le nom n'est pas appliqué", async () => {
    h.queue = [tree()];
    expect(await status(updateFolder(editor, ORG, A, { name: "z", parentId: B }))).toBe(400);
    expect(h.calls.filter((c) => c === "update")).toHaveLength(0);
  });
  it("nom en doublon au point d'arrivée : 409 sans écriture", async () => {
    h.queue = [tree()];
    expect(await status(updateFolder(editor, ORG, B, { name: "D", parentId: null }))).toBe(409);
    expect(h.calls.filter((c) => c === "update")).toHaveLength(0);
  });
});

describe("createFolder", () => {
  it("400 sur nom vide, espaces, non texte ou de 201 caractères", async () => {
    for (const name of ["", "   ", 42, "x".repeat(201)]) {
      expect(await status(createFolder(editor, ORG, { name }))).toBe(400);
    }
    expect(h.calls).toEqual([]);
  });
  it("accepte 200 caractères et rogne les espaces", async () => {
    h.queue = [[], [{ id: A }]];
    const node = await createFolder(editor, ORG, { name: `  ${"x".repeat(200)}  ` });
    expect(node.name).toHaveLength(200);
    expect(node.mediaCount).toBe(0);
  });
  it("409 sur doublon (parent, nom) insensible à la casse", async () => {
    h.queue = [[f(A, null, "Logos")]];
    expect(await status(createFolder(editor, ORG, { name: "lOGOS" }))).toBe(409);
  });
  it("même nom sous un autre parent : accepté", async () => {
    h.queue = [[f(A, null, "Logos"), f(B, null, "Docs")], [{ id: C }]];
    const node = await createFolder(editor, ORG, { name: "Logos", parentId: B });
    expect(node.parentId).toBe(B);
  });
  it("404 si le parent est d'une autre organisation ou inconnu", async () => {
    h.queue = [[f(A, null, "Logos")]];
    expect(await status(createFolder(editor, ORG, { name: "x", parentId: B }))).toBe(404);
  });
  it("409 sur violation d'unicité concurrente", async () => {
    h.queue = [[]];
    h.failInsert = { code: "23505" };
    expect(await status(createFolder(editor, ORG, { name: "x" }))).toBe(409);
  });
  it("403 pour un viewer, accepté pour un admin d'organisation", async () => {
    expect(await status(createFolder(viewer, ORG, { name: "x" }))).toBe(403);
    h.admin = true;
    h.queue = [[], [{ id: A }]];
    expect(await status(createFolder(viewer, ORG, { name: "x" }))).toBeNull();
  });
});

describe("renameFolder", () => {
  it("404 inconnu, 409 doublon avec un frère, 400 nom vide, 403 viewer", async () => {
    h.queue = [[f(A, null, "a")]];
    expect(await status(renameFolder(editor, ORG, B, "z"))).toBe(404);
    h.queue = [[f(A, null, "a"), f(B, null, "b")]];
    expect(await status(renameFolder(editor, ORG, A, "B"))).toBe(409);
    expect(await status(renameFolder(editor, ORG, A, "  "))).toBe(400);
    expect(await status(renameFolder(viewer, ORG, A, "z"))).toBe(403);
  });
  it("renommer en changeant seulement la casse de soi-même : accepté", async () => {
    h.queue = [[f(A, null, "logos")], []];
    expect(await status(renameFolder(editor, ORG, A, "Logos"))).toBeNull();
  });
});

describe("moveFolder", () => {
  const tree = () => [f(A, null, "a"), f(B, A, "b"), f(C, B, "c"), f(D, null, "d")];
  it("400 dans lui-même et dans un descendant, sur 3 niveaux", async () => {
    h.queue = [tree()];
    expect(await status(moveFolder(editor, ORG, A, A))).toBe(400);
    h.queue = [tree()];
    expect(await status(moveFolder(editor, ORG, A, B))).toBe(400);
    h.queue = [tree()];
    expect(await status(moveFolder(editor, ORG, A, C))).toBe(400);
  });
  it("une boucle déjà présente en base ne fait pas boucler", async () => {
    h.queue = [[f(A, B, "a"), f(B, A, "b"), f(D, null, "d")]];
    expect(await status(moveFolder(editor, ORG, D, A))).toBeNull();
  });
  it("déplace vers un cousin ou la racine", async () => {
    h.queue = [tree(), []];
    expect(await status(moveFolder(editor, ORG, C, D))).toBeNull();
    h.queue = [tree(), []];
    expect(await status(moveFolder(editor, ORG, C, null))).toBeNull();
  });
  it("404 parent inconnu, 409 doublon au point d'arrivée", async () => {
    h.queue = [tree()];
    expect(await status(moveFolder(editor, ORG, C, "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee"))).toBe(404);
    h.queue = [[f(A, null, "x"), f(B, A, "X")]];
    expect(await status(moveFolder(editor, ORG, B, null))).toBe(409);
  });
});

describe("deleteFolder", () => {
  it("remonte 2 enfants et 3 médias au parent", async () => {
    const M = ["11111111-1111-4111-8111-111111111111", "22222222-2222-4222-8222-222222222222", "33333333-3333-4333-8333-333333333333"];
    h.queue = [
      [f(A, null, "a"), f(B, A, "b"), f(C, B, "c1"), f(D, B, "c2")],
      [{ id: C }, { id: D }],
      M.map((id) => ({ id })),
      [],
    ];
    expect(await deleteFolder(editor, ORG, B)).toEqual({
      movedMedia: 3,
      movedChildren: 2,
      undo: { folderId: B, parentId: A, name: "b", mediaIds: M, childIds: [C, D] },
    });
    expect(h.calls.slice(1)).toEqual(["update", "update", "delete"]);
  });
  it("409 si un enfant entrerait en collision avec un frère du dossier", async () => {
    h.queue = [[f(A, null, "x"), f(B, null, "b"), f(C, B, "X")]];
    expect(await status(deleteFolder(editor, ORG, B))).toBe(409);
  });
  it("404 inconnu, 403 viewer", async () => {
    h.queue = [[]];
    expect(await status(deleteFolder(editor, ORG, A))).toBe(404);
    expect(await status(deleteFolder(viewer, ORG, A))).toBe(403);
  });
});

describe("listFolders", () => {
  it("garde un dossier vide et compte seulement les médias visibles", async () => {
    h.queue = [
      [f(A, null, "Direction"), f(B, null, "Vide")],
      [{ folderId: A, n: 1 }],
    ];
    const out = await listFolders(editor, ORG);
    expect(out).toEqual([
      { id: A, parentId: null, name: "Direction", mediaCount: 1 },
      { id: B, parentId: null, name: "Vide", mediaCount: 0 },
    ]);
  });
});

describe("restoreFolder", () => {
  const M1 = "11111111-1111-4111-8111-111111111111";
  const undo = { folderId: B, parentId: A, name: "b", mediaIds: [M1], childIds: [C] };
  it("recrée le dossier et replace médias et enfants", async () => {
    h.queue = [[f(A, null, "a"), f(C, A, "c1")], [], [{ id: C }], [{ id: M1 }]];
    const out = await restoreFolder(editor, ORG, undo);
    expect(out.restoredMedia).toBe(1);
    expect(out.restoredChildren).toBe(1);
    expect(out.folder).toMatchObject({ id: B, parentId: A, name: "b" });
    expect(h.calls.slice(1)).toEqual(["insert", "update", "update"]);
  });
  it("403 viewer, 400 charge invalide, 409 déjà là ou doublon, 404 parent absent", async () => {
    expect(await status(restoreFolder(viewer, ORG, undo))).toBe(403);
    expect(await status(restoreFolder(editor, ORG, { ...undo, mediaIds: ["x"] }))).toBe(400);
    expect(await status(restoreFolder(editor, ORG, { ...undo, folderId: "nope" }))).toBe(400);
    expect(await status(restoreFolder(editor, ORG, null))).toBe(400);
    h.queue = [[f(A, null, "a"), f(B, A, "b")]];
    expect(await status(restoreFolder(editor, ORG, undo))).toBe(409);
    h.queue = [[f(A, null, "a"), f(D, A, "B")]];
    expect(await status(restoreFolder(editor, ORG, undo))).toBe(409);
    h.queue = [[f(D, null, "d")]];
    expect(await status(restoreFolder(editor, ORG, undo))).toBe(404);
  });
});
