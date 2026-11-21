import { describe, expect, it, vi, beforeEach } from "vitest";

const h = vi.hoisted(() => ({
  queue: [] as unknown[][],
  readable: [] as string[],
  admin: false,
  writeChecks: [] as string[],
  bulkCalls: 0,
  notWritable: [] as string[],
  retention: 30,
}));

function chain(): unknown {
  const p: Record<string, unknown> = {};
  const self = new Proxy(p, {
    get(_t, prop) {
      if (prop === "then") {
        return (res: (v: unknown) => void) => res(h.queue.shift() ?? []);
      }
      return () => self;
    },
  });
  return self;
}

vi.mock("@/lib/db", () => ({ db: { select: () => chain() } }));
vi.mock("@/lib/auth/check-access", () => ({
  getAccessibleSpaceIds: () => Promise.resolve(h.readable),
  checkSpaceWriteAccess: (_u: unknown, id: string) => {
    h.writeChecks.push(id);
    return Promise.resolve(true);
  },
  getWritableSpaceIds: (_u: unknown, _o: string, ids: string[]) => {
    h.bulkCalls++;
    return Promise.resolve(ids.filter((i) => !h.notWritable.includes(i)));
  },
}));
vi.mock("@/lib/media/access", () => ({ isOrgAdminOrOwner: () => Promise.resolve(h.admin) }));
vi.mock("@/lib/media/quota", () => ({ getOrgStorageUsedBytes: () => Promise.resolve(100) }));
vi.mock("@/lib/media/library-settings", () => ({
  getLibrarySettings: () => Promise.resolve({ trashRetentionDays: h.retention }),
}));

import { PgDialect } from "drizzle-orm/pg-core";
import { listMedia, getLibraryStats, visibleMediaCondition } from "./list";
import { FilterError, decodeCursor, encodeCursor, parseMediaFilters } from "./filters";
import { registerHooks, resetHooksForTests } from "@/lib/modules/hooks";
import { beforeEach as hooksBeforeEach } from "vitest";
hooksBeforeEach(() => {
  resetHooksForTests();
  registerHooks({ usage: { checkUsersLimit: async () => { throw new Error('unused'); }, checkSpacesLimit: async () => { throw new Error('unused'); }, getOrgStorageLimitBytes: async (...a: unknown[]) => 1000 } });
});


const user = { id: "u1" } as never;
const ORG = "00000000-0000-4000-8000-000000000001";
const SPACE_A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const SPACE_B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const f = (qs = "") => parseMediaFilters(new URLSearchParams(qs));

function row(i: number, over: Record<string, unknown> = {}) {
  return {
    id: `00000000-0000-4000-8000-0000000000${String(i).padStart(2, "0")}`,
    filename: "same.png", title: null, altText: null, kind: "image", mimeType: "image/png",
    sizeBytes: "10", width: null, height: null, spaceId: SPACE_A, spaceName: "A", folderId: null,
    uploadedBy: "u1", uploaderName: "U", createdAt: new Date(1000), deletedAt: null,
    thumbnailKey: null, usageCount: 0, publicShared: false, sortValue: "same.png", ...over,
  };
}

beforeEach(() => {
  h.queue = [];
  h.readable = [SPACE_A];
  h.admin = false;
  h.writeChecks = [];
  h.bulkCalls = 0;
  h.notWritable = [];
  h.retention = 30;
});

describe("visibleMediaCondition", () => {
  const sqlOf = async (scope: "live" | "trash" | "any") => {
    const c = await visibleMediaCondition(user, ORG, scope);
    return new PgDialect().sqlToQuery(c);
  };
  it("ne contient que les espaces lisibles, pas l'espace non lisible", async () => {
    const q = await sqlOf("live");
    expect(q.params).toContain(SPACE_A);
    expect(q.params).not.toContain(SPACE_B);
    expect(q.params).toContain(ORG);
    expect(q.params).toContain("u1");
  });
  it("un admin voit tous les médias hors espace (pas de filtre d'auteur)", async () => {
    h.admin = true;
    const q = await sqlOf("live");
    expect(q.params).not.toContain("u1");
  });
  it("sans espace lisible : aucune branche d'espace", async () => {
    h.readable = [];
    const q = await sqlOf("live");
    expect(q.sql).toContain("false");
  });
  it("la corbeille se juge sur l'écriture", async () => {
    h.readable = [SPACE_A, SPACE_B];
    h.notWritable = [SPACE_B];
    const q = await sqlOf("trash");
    expect(h.bulkCalls).toBe(1);
    expect(h.writeChecks).toEqual([]);
    expect(q.params).toContain(SPACE_A);
    expect(q.params).not.toContain(SPACE_B);
  });
});

describe("listMedia, vue corbeille", () => {
  const DAY = 86_400_000;
  it("purgeAt = deletedAt + délai du réglage, affectedCount = nombre d'usages", async () => {
    h.retention = 10;
    const deletedAt = new Date(Date.UTC(2026, 10, 1));
    h.queue = [[row(1, { deletedAt, usageCount: 3 })], []];
    const r = await listMedia(user, ORG, f("view=trash"));
    expect(r.items[0].purgeAt).toBe(new Date(deletedAt.getTime() + 10 * DAY).toISOString());
    expect(r.items[0].affectedCount).toBe(3);
  });
  it("hors corbeille : purgeAt nul et pas d'affectedCount", async () => {
    h.queue = [[row(1, { usageCount: 2 })], []];
    const r = await listMedia(user, ORG, f(""));
    expect(r.items[0].purgeAt).toBeNull();
    expect(r.items[0].affectedCount).toBeUndefined();
  });
});

describe("listMedia", () => {
  it("nextCursor non nul quand limit+1 lignes reviennent, borné à limit", async () => {
    h.queue = [[row(1), row(2), row(3)], []];
    const r = await listMedia(user, ORG, f("limit=2&sort=filename&dir=asc"));
    expect(r.items).toHaveLength(2);
    expect(r.nextCursor).not.toBeNull();
    expect(decodeCursor(r.nextCursor!)).toEqual({ sort: "filename", sortValue: "same.png", id: r.items[1].id });
  });
  it("nextCursor nul à la dernière page", async () => {
    h.queue = [[row(1)], []];
    const r = await listMedia(user, ORG, f("limit=2"));
    expect(r.nextCursor).toBeNull();
  });
  it("trois pages, noms identiques : le curseur reprend sans doublon ni trou", async () => {
    const all = [1, 2, 3, 4, 5].map((i) => row(i));
    const seen: string[] = [];
    let cursor: string | null = null;
    for (let page = 0; page < 3; page++) {
      const start = cursor ? all.findIndex((r) => r.id === decodeCursor(cursor!).id) + 1 : 0;
      h.queue = [all.slice(start, start + 3), []];
      const qs: string = `limit=2&sort=filename&dir=asc${cursor ? `&cursor=${cursor}` : ""}`;
      const r = await listMedia(user, ORG, f(qs));
      seen.push(...r.items.map((i) => i.id));
      cursor = r.nextCursor;
    }
    expect(seen).toEqual(all.map((r) => r.id));
    expect(cursor).toBeNull();
  });
  it("refuse un curseur d'un autre tri", async () => {
    const numeric = encodeCursor("sizeBytes", 5, row(1).id);
    expect(() => f(`sort=filename&cursor=${numeric}`)).toThrow(FilterError);
    const text = encodeCursor("filename", "x", row(1).id);
    expect(() => f(`sort=kind&cursor=${text}`)).toThrow(FilterError);
    await expect(listMedia(user, ORG, { ...f("sort=filename"), cursor: numeric })).rejects.toBeInstanceOf(FilterError);
  });
  it("refuse un curseur numérique non entier ou hors plage sûre", async () => {
    for (const v of [1.5, 1e300, 2 ** 60]) {
      const c = encodeCursor("sizeBytes", v, row(1).id);
      await expect(listMedia(user, ORG, { ...f("sort=sizeBytes"), cursor: c })).rejects.toBeInstanceOf(FilterError);
    }
  });
  it("publicShared : vrai seulement quand la ligne le porte", async () => {
    h.queue = [[row(1, { publicShared: true }), row(2)], []];
    const r = await listMedia(user, ORG, f());
    expect(r.items.map((i) => i.publicShared)).toEqual([true, false]);
  });
  it("filtre ids : reste sous la condition de visibilité", async () => {
    const id = row(1).id;
    h.queue = [[row(1)], []];
    const r = await listMedia(user, ORG, f(`id=${id}`));
    expect(r.items).toHaveLength(1);
  });
  it("canWrite : une vérification par espace distinct, règle 4 hors espace", async () => {
    h.queue = [[row(1), row(2), row(3, { spaceId: null, uploadedBy: "other" })], []];
    const r = await listMedia(user, ORG, f());
    expect(h.writeChecks.filter((s) => s === SPACE_A)).toHaveLength(1);
    expect(r.items.map((i) => i.canWrite)).toEqual([true, true, false]);
  });
  it("assemble les tags et les URL", async () => {
    h.queue = [[row(1, { thumbnailKey: "k" })], [{ mediaId: row(1).id, id: "t1", label: "Logo" }]];
    const r = await listMedia(user, ORG, f());
    expect(r.items[0].tags).toEqual([{ id: "t1", label: "Logo" }]);
    expect(r.items[0].thumbnailUrl).toBe(`/api/media/${row(1).id}/thumbnail`);
    expect(r.items[0].createdAt).toBe(new Date(1000).toISOString());
  });
});

describe("getLibraryStats", () => {
  it("assemble les compteurs, dossiers, tags et jauge", async () => {
    h.queue = [
      [{ total: 5, unused: 2, mine: 3, orphan: 1, noFolder: 4 }],
      [{ n: 7 }],
      [{ folderId: "f1", n: 1 }],
      [{ id: "t1", label: "Logo", n: 2 }],
    ];
    const s = await getLibraryStats(user, ORG);
    expect(s).toMatchObject({
      total: 5, unused: 2, mine: 3, trash: 7, orphan: 1, noFolder: 4,
      byFolder: { f1: 1 }, byTag: [{ id: "t1", label: "Logo", count: 2 }],
      usedBytes: 100, limitBytes: 1000, percent: 10,
    });
  });
});
