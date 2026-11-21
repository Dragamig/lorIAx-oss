import { describe, expect, it, vi, beforeEach } from "vitest";

const h = vi.hoisted(() => ({
  queue: [] as unknown[],
  sets: [] as unknown[],
  row: null as unknown,
  read: true,
  write: true,
  admin: false,
  spaceWrite: true,
  tags: [] as { id: string; label: string }[],
  existingLinks: [] as { tagId: string }[],
  inserted: [] as unknown[],
  deleted: 0,
  logged: [] as unknown[],
}));

function chain(kind: string): unknown {
  const self: unknown = new Proxy(
    {},
    {
      get(_t, prop) {
        if (prop === "then") {
          return (res: (v: unknown) => void) => {
            if (kind === "select-links") return res(h.existingLinks);
            if (kind === "insert" || kind === "update" || kind === "delete") return res([]);
            res(h.queue.shift() ?? []);
          };
        }
        if (prop === "set") return (v: unknown) => (h.sets.push(v), self);
        if (prop === "values") return (v: unknown) => (h.inserted.push(v), self);
        return () => self;
      },
    }
  );
  return self;
}
const tx = {
  select: () => chain("select-links"),
  insert: () => chain("insert"),
  update: () => chain("update"),
  delete: () => (h.deleted++, chain("delete")),
};
vi.mock("@/lib/db", () => ({
  db: {
    select: () => chain("select"),
    transaction: (cb: (t: typeof tx) => Promise<void>) => cb(tx),
  },
}));
vi.mock("@/lib/activity", () => ({ logActivity: (a: unknown) => (h.logged.push(a), Promise.resolve()) }));
vi.mock("@/lib/auth/check-access", () => ({ checkSpaceWriteAccess: () => Promise.resolve(h.spaceWrite) }));
vi.mock("@/lib/media/access", () => ({
  getMediaFull: () => Promise.resolve(h.row),
  isOrgAdminOrOwner: () => Promise.resolve(h.admin),
  resolveMediaAccess: (_u: unknown, _r: unknown, mode: string) =>
    Promise.resolve({ allowed: mode === "read" ? h.read : h.write }),
}));
vi.mock("@/lib/media/list", () => ({}));
vi.mock("@/lib/media/tags", async () => {
  class TagError extends Error {
    status = 400;
  }
  return {
    MEDIA_TAGS_MAX: 20,
    TagError,
    ensureTags: (_o: string, labels: string[]) => {
      const seen = new Map<string, string>();
      for (const l of labels) {
        const k = l.trim().toLowerCase();
        if (k && !seen.has(k)) seen.set(k, l.trim());
      }
      if (seen.size > 20) throw new TagError("20 tags au plus par média");
      return Promise.resolve([...seen.keys()].map((k) => ({ id: `t-${k}`, label: seen.get(k)! })));
    },
  };
});

import { MetadataError, resolveFilename, updateMedia } from "./metadata";

const user = { id: "u1", globalRole: "editor" } as never;
const baseRow = () => ({
  id: "m1",
  filename: "doc.pdf",
  title: "T",
  altText: null,
  description: null,
  kind: "document",
  mimeType: "application/pdf",
  sizeBytes: 10,
  width: null,
  height: null,
  spaceId: "s1",
  folderId: null,
  uploadedBy: "u1",
  createdAt: new Date("2026-01-01"),
  deletedAt: null,
  deletedBy: null,
  thumbnailKey: null,
  checksumSha256: null,
  pageCount: null,
  origin: "upload",
  documentId: null,
});

function primeDetail() {
  h.queue.push([{ spaceName: "S", uploaderName: "U", usageCount: 0, publicShared: false }], []);
}

beforeEach(() => {
  h.queue = [];
  h.sets = [];
  h.row = baseRow();
  h.read = true;
  h.write = true;
  h.admin = false;
  h.spaceWrite = true;
  h.existingLinks = [];
  h.inserted = [];
  h.deleted = 0;
  h.logged = [];
});

const status = async (p: Promise<unknown>) => {
  try {
    await p;
    return 200;
  } catch (e) {
    if (e instanceof MetadataError) return e.status;
    throw e;
  }
};

describe("resolveFilename", () => {
  it("conserve l'extension retirée, refuse vide et trop long", () => {
    expect(resolveFilename("rapport", "doc.pdf")).toBe("rapport.pdf");
    expect(resolveFilename("rapport.docx", "doc.pdf")).toBe("rapport.docx");
    expect(() => resolveFilename("   ", "doc.pdf")).toThrow(MetadataError);
    expect(() => resolveFilename("x".repeat(600), "doc.pdf")).toThrow(MetadataError);
    expect(resolveFilename("a/b\\c", "doc.pdf")).toBe("a-b-c.pdf");
  });
});

describe("updateMedia", () => {
  it("filename vide : 400 ; 600 caractères : 400", async () => {
    expect(await status(updateMedia(user, "o", "m1", { filename: "   " }))).toBe(400);
    expect(await status(updateMedia(user, "o", "m1", { filename: "x".repeat(600) }))).toBe(400);
  });
  it("rapport sur un pdf donne rapport.pdf", async () => {
    primeDetail();
    await updateMedia(user, "o", "m1", { filename: "rapport" });
    expect(h.sets[0]).toMatchObject({ filename: "rapport.pdf" });
    expect(h.logged[0]).toMatchObject({ action: "media.updated", metadata: { fields: ["filename"] } });
  });
  it("titre vidé enregistré null", async () => {
    primeDetail();
    await updateMedia(user, "o", "m1", { title: "  " });
    expect(h.sets[0]).toMatchObject({ title: null });
  });
  it("dossier d'une autre organisation : 400", async () => {
    h.queue.push([]);
    expect(await status(updateMedia(user, "o", "m1", { folderId: "f1" }))).toBe(400);
  });
  it("tags a et A : un seul lien", async () => {
    primeDetail();
    await updateMedia(user, "o", "m1", { tags: ["a", "A"] });
    expect(h.inserted).toEqual([[{ mediaId: "m1", tagId: "t-a" }]]);
  });
  it("tags : diff, retire l'ancien lien, n'écrit pas si identique", async () => {
    h.existingLinks = [{ tagId: "t-old" }, { tagId: "t-a" }];
    primeDetail();
    await updateMedia(user, "o", "m1", { tags: ["a"] });
    expect(h.deleted).toBe(1);
    expect(h.inserted).toEqual([]);
    h.deleted = 0;
    h.existingLinks = [{ tagId: "t-a" }];
    primeDetail();
    await updateMedia(user, "o", "m1", { tags: ["a"] });
    expect(h.deleted).toBe(0);
    expect(h.logged).toHaveLength(1);
  });
  it("limite de 20 tags par média : 21 refusés, 20 acceptés", async () => {
    h.existingLinks = [{ tagId: "t-x1" }, { tagId: "t-x2" }, { tagId: "t-x3" }];
    const many = (n: number) => Array.from({ length: n }, (_, i) => `tag${i}`);
    await expect(updateMedia(user, "o", "m1", { tags: many(21) })).rejects.toThrow();
    primeDetail();
    await expect(updateMedia(user, "o", "m1", { tags: many(20) })).resolves.toBeDefined();
  });
  it("viewer : 403 ; espace non lisible : 404", async () => {
    h.write = false;
    expect(await status(updateMedia(user, "o", "m1", { title: "x" }))).toBe(403);
    h.read = false;
    expect(await status(updateMedia(user, "o", "m1", { title: "x" }))).toBe(404);
  });
  it("média inconnu : 404", async () => {
    h.row = null;
    expect(await status(updateMedia(user, "o", "m1", { title: "x" }))).toBe(404);
  });
  it("changement d'espace : editor non admin 403", async () => {
    expect(await status(updateMedia(user, "o", "m1", { spaceId: "s2" }))).toBe(403);
  });
  it("changement d'espace : cible hors de l'organisation 404 (ADR-079)", async () => {
    h.admin = true;
    h.spaceWrite = true;
    h.queue.push([]);
    expect(await status(updateMedia(user, "o", "m1", { spaceId: "autre-org" }))).toBe(404);
  });
  it("changement d'espace : admin sans écriture sur la cible 403", async () => {
    h.admin = true;
    h.spaceWrite = false;
    h.queue.push([{ id: "s2" }]);
    expect(await status(updateMedia(user, "o", "m1", { spaceId: "s2" }))).toBe(403);
  });
  it("spaceId null par un admin : accepté, canChangeSpace vrai", async () => {
    h.admin = true;
    primeDetail();
    const d = await updateMedia(user, "o", "m1", { spaceId: null });
    expect(h.sets[0]).toMatchObject({ spaceId: null });
    expect(d.canChangeSpace).toBe(true);
  });
  it("média en corbeille : modifiable si le résolveur l'autorise", async () => {
    h.row = { ...baseRow(), deletedAt: new Date() };
    primeDetail();
    await expect(updateMedia(user, "o", "m1", { title: "z" })).resolves.toBeDefined();
    h.write = false;
    expect(await status(updateMedia(user, "o", "m1", { title: "z" }))).toBe(403);
  });
  it("aucun changement : pas d'écriture ni de journal", async () => {
    primeDetail();
    await updateMedia(user, "o", "m1", { title: "T" });
    expect(h.sets).toHaveLength(0);
    expect(h.logged).toHaveLength(0);
  });
});
