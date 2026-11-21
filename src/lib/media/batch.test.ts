import { describe, expect, it, vi, beforeEach } from "vitest";

const h = vi.hoisted(() => ({
  queue: [] as unknown[],
  sets: [] as unknown[],
  inserted: [] as unknown[],
  deleted: 0,
  logged: [] as { action: string; metadata: { count: number } }[],
  canWrite: true,
  ensured: 0,
  access: {} as Record<string, { read: boolean; write: boolean }>,
}));

function chain(): unknown {
  const self: unknown = new Proxy(
    {},
    {
      get(_t, prop) {
        if (prop === "then") return (res: (v: unknown) => void) => res(h.queue.shift() ?? []);
        if (prop === "set") return (v: unknown) => (h.sets.push(v), self);
        if (prop === "values") return (v: unknown) => (h.inserted.push(v), self);
        return () => self;
      },
    }
  );
  return self;
}
const tx = {
  update: () => chain(),
  insert: () => chain(),
  delete: () => (h.deleted++, chain()),
};
vi.mock("@/lib/db", () => ({
  db: {
    select: () => chain(),
    transaction: (cb: (t: typeof tx) => Promise<void>) => cb(tx),
  },
}));
vi.mock("@/lib/activity", () => ({ logActivity: (a: never) => (h.logged.push(a), Promise.resolve()) }));
vi.mock("@/lib/media/access", () => ({
  resolveMediaAccess: (_u: unknown, row: { id: string }, mode: "read" | "write") =>
    Promise.resolve({ allowed: h.access[row.id]?.[mode] ?? false }),
}));
vi.mock("@/lib/media/folders", () => ({ canWriteLibrary: () => Promise.resolve(h.canWrite) }));
vi.mock("@/lib/media/tags", async () => {
  class TagError extends Error {
    status = 400;
  }
  return {
    MEDIA_TAGS_MAX: 20,
    TagError,
    ensureTags: (_o: string, labels: string[]) =>
      (h.ensured++, Promise.resolve([...new Set(labels)].map((l) => ({ id: `t-${l}`, label: l })))),
  };
});

import { runBatch } from "./batch";

const user = { id: "u1" } as never;
const row = (id: string, extra: Record<string, unknown> = {}) => ({
  id,
  organizationId: "o1",
  spaceId: "s1",
  uploadedBy: "u1",
  deletedAt: null,
  origin: "upload",
  mimeType: "image/png",
  folderId: null,
  ...extra,
});

beforeEach(() => {
  h.queue = [];
  h.sets = [];
  h.inserted = [];
  h.deleted = 0;
  h.logged = [];
  h.canWrite = true;
  h.ensured = 0;
  h.access = {
    a: { read: true, write: true },
    b: { read: true, write: true },
    ro: { read: true, write: false },
    hidden: { read: false, write: false },
  };
});

describe("runBatch tag : création de tags", () => {
  it("sans droit d'écriture sur la médiathèque : aucun tag créé", async () => {
    h.canWrite = false;
    h.queue = [[row("a")]];
    await expect(runBatch(user, "o1", { action: "tag", ids: ["a"], tags: ["x"] })).rejects.toMatchObject({ status: 403 });
    expect(h.ensured).toBe(0);
  });
  it("aucun média modifiable : aucun tag créé", async () => {
    h.queue = [[row("ro")]];
    const r = await runBatch(user, "o1", { action: "tag", ids: ["ro"], tags: ["x"] });
    expect(r.succeeded).toBe(0);
    expect(h.ensured).toBe(0);
  });
  it("ids vide : refusé", async () => {
    await expect(runBatch(user, "o1", { action: "tag", ids: [], tags: ["x"] })).rejects.toMatchObject({ name: "BatchError" });
    expect(h.ensured).toBe(0);
  });
  it("média modifiable : tag créé", async () => {
    h.queue = [[row("a")]];
    await runBatch(user, "o1", { action: "tag", ids: ["a"], tags: ["x"] });
    expect(h.ensured).toBe(1);
  });
});

describe("runBatch", () => {
  it("lot mixte : un résultat par id, erreurs distinctes, invisible = inexistant", async () => {
    h.queue = [[row("a"), row("b"), row("ro"), row("hidden")]];
    const r = await runBatch(user, "o1", {
      action: "trash",
      ids: ["a", "b", "ro", "hidden", "ghost"],
    });
    expect(r.succeeded).toBe(2);
    expect(r.failed).toBe(3);
    const by = Object.fromEntries(r.results.map((x) => [x.id, x]));
    expect(by.ro.error).toBe("forbidden");
    expect(by.hidden.error).toBe("not_found");
    expect(by.ghost.error).toBe("not_found");
    expect(h.logged).toHaveLength(1);
    expect(h.logged[0]).toMatchObject({ action: "media.trashed", metadata: { count: 2 } });
  });

  it("trash pose deleted_at et deleted_by ; restore les efface ; restore répété : already", async () => {
    h.queue = [[row("a")]];
    await runBatch(user, "o1", { action: "trash", ids: ["a"] });
    expect(h.sets[0]).toMatchObject({ deletedBy: "u1" });
    expect((h.sets[0] as { deletedAt: Date }).deletedAt).toBeInstanceOf(Date);

    h.sets = [];
    const d = new Date("2026-11-01T00:00:00Z");
    h.queue = [[row("a", { deletedAt: d })]];
    const r1 = await runBatch(user, "o1", { action: "restore", ids: ["a"] });
    expect(h.sets[0]).toMatchObject({ deletedAt: null, deletedBy: null });
    expect(r1.results[0].previous?.deletedAt).toBe(d.toISOString());

    h.sets = [];
    h.queue = [[row("a")]];
    const r2 = await runBatch(user, "o1", { action: "restore", ids: ["a"] });
    expect(r2.results[0]).toMatchObject({ ok: true, error: "already" });
    expect(h.sets).toHaveLength(0);
    expect(h.logged.filter((l) => l.action === "media.restored")).toHaveLength(1);
  });

  it("move rend l'ancien dossier ; dossier d'une autre organisation : 400 pour tout le lot", async () => {
    h.queue = [[{ id: "f2" }], [row("a", { folderId: "f1" })]];
    const r = await runBatch(user, "o1", { action: "move", ids: ["a"], folderId: "f2" });
    expect(r.results[0].previous?.folderId).toBe("f1");
    expect(h.sets[0]).toMatchObject({ folderId: "f2" });

    h.queue = [[]];
    await expect(
      runBatch(user, "o1", { action: "move", ids: ["a"], folderId: "alien" })
    ).rejects.toMatchObject({ status: 400 });
  });

  it("untag d'un tag absent : ok sans écriture", async () => {
    h.queue = [[row("a")], []];
    const r = await runBatch(user, "o1", { action: "untag", ids: ["a"], tagIds: ["zz"] });
    expect(r.results[0]).toMatchObject({ ok: true, previous: { tagIds: [] } });
    expect(h.deleted).toBe(0);
  });

  it("tag : 20 tags par média après fusion avec l'existant", async () => {
    const existing = Array.from({ length: 19 }, (_, i) => ({ mediaId: "a", tagId: `old${i}` }));
    h.queue = [[row("a"), row("b")], existing];
    const r = await runBatch(user, "o1", { action: "tag", ids: ["a", "b"], tags: ["x", "y"] });
    const by = Object.fromEntries(r.results.map((x) => [x.id, x]));
    expect(by.a).toMatchObject({ ok: false, error: "too_many_tags" });
    expect(by.a.previous?.tagIds).toHaveLength(19);
    expect(by.b.ok).toBe(true);
    expect(h.inserted).toHaveLength(1);
  });

  it("tag déjà présent : fusion sans doublon", async () => {
    h.queue = [[row("a")], [{ mediaId: "a", tagId: "t-x" }]];
    await runBatch(user, "o1", { action: "tag", ids: ["a"], tags: ["x", "y"] });
    expect(h.inserted[0]).toEqual([{ mediaId: "a", tagId: "t-y" }]);
  });

  it("201 ids : refusé", async () => {
    const ids = Array.from({ length: 201 }, (_, i) => `i${i}`);
    await expect(runBatch(user, "o1", { action: "trash", ids })).rejects.toMatchObject({
      status: 400,
    });
  });
});
