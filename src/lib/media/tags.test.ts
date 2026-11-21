import { describe, expect, it, vi, beforeEach } from "vitest";

const h = vi.hoisted(() => ({
  queue: [] as unknown[],
  failInsert: [] as unknown[],
  inserted: [] as unknown[],
  canWrite: true,
}));

function chain(kind: string): unknown {
  let values: unknown;
  const self: unknown = new Proxy(
    {},
    {
      get(_t, prop) {
        if (prop === "then") {
          return (res: (v: unknown) => void, rej: (e: unknown) => void) => {
            if (kind === "insert") {
              const err = h.failInsert.shift();
              if (err) return rej(err);
              h.inserted.push(values);
              const v = values as { label: string };
              return res([{ id: `id-${h.inserted.length}`, label: v.label }]);
            }
            res(h.queue.shift() ?? []);
          };
        }
        if (prop === "values") {
          return (v: unknown) => {
            values = v;
            return self;
          };
        }
        return () => self;
      },
    }
  );
  return self;
}
vi.mock("@/lib/db", () => ({
  db: { select: () => chain("select"), insert: () => chain("insert") },
}));
vi.mock("@/lib/media/list", () => ({ visibleMediaCondition: () => Promise.resolve({}) }));
vi.mock("@/lib/media/folders", () => ({ canWriteLibrary: () => Promise.resolve(h.canWrite) }));

import { TagError, createTag, ensureTags, listTags, tagSlug } from "./tags";

const user = { id: "u1", globalRole: "editor" } as never;

beforeEach(() => {
  h.queue = [];
  h.failInsert = [];
  h.inserted = [];
  h.canWrite = true;
});

describe("tagSlug", () => {
  it("replie casse et accents", () => {
    expect(tagSlug(" LOGO ")).toBe("logo");
    expect(tagSlug("Été")).toBe(tagSlug("ete"));
  });
});

describe("ensureTags", () => {
  it("un seul tag pour Logo, logo, LOGO (premier libellé conservé)", async () => {
    const r = await ensureTags("o", ["Logo", "logo", " LOGO "]);
    expect(r).toHaveLength(1);
    expect(h.inserted).toEqual([{ organizationId: "o", label: "Logo", slug: "logo" }]);
  });
  it("Été et ete donnent un seul tag", async () => {
    expect(await ensureTags("o", ["Été", "ete"])).toHaveLength(1);
  });
  it("réutilise un tag existant sans insérer", async () => {
    h.queue.push([{ id: "t1", label: "Logo", slug: "logo" }]);
    const r = await ensureTags("o", ["LOGO"]);
    expect(r).toEqual([{ id: "t1", label: "Logo" }]);
    expect(h.inserted).toHaveLength(0);
  });
  it("121 caractères : TagError 400", async () => {
    await expect(ensureTags("o", ["a".repeat(121)])).rejects.toMatchObject({ status: 400 });
    await expect(ensureTags("o", ["a".repeat(121)])).rejects.toBeInstanceOf(TagError);
  });
  it("chaînes vides ignorées", async () => {
    expect(await ensureTags("o", ["", "   "])).toEqual([]);
  });
  it("libellé sans slug : 400", async () => {
    await expect(ensureTags("o", ["!!!"])).rejects.toMatchObject({ status: 400 });
  });
  it("plus de 20 tags : 400", async () => {
    const many = Array.from({ length: 21 }, (_, i) => `tag${i}`);
    await expect(ensureTags("o", many)).rejects.toMatchObject({ status: 400 });
  });
  it("course sur 23505 : relit l'existant, une seule ligne", async () => {
    h.queue.push([]); // première lecture
    h.failInsert.push({ code: "23505" });
    h.queue.push([{ id: "t9", label: "Logo", slug: "logo" }]); // relecture
    const r = await ensureTags("o", ["Logo"]);
    expect(r).toEqual([{ id: "t9", label: "Logo" }]);
    expect(h.inserted).toHaveLength(0);
  });
  it("autre erreur d'insertion : remonte", async () => {
    h.failInsert.push(new Error("boom"));
    await expect(ensureTags("o", ["Logo"])).rejects.toThrow("boom");
  });
});

describe("listTags", () => {
  it("masque un tag porté uniquement par des médias invisibles", async () => {
    h.queue.push([
      { id: "a", label: "Visible", n: 2, total: 2 },
      { id: "b", label: "Secret", n: 0, total: 3 },
      { id: "c", label: "Vide", n: 0, total: 0 },
    ]);
    const r = await listTags(user, "o");
    expect(r.map((t) => t.label)).toEqual(["Vide", "Visible"]);
    expect(r.find((t) => t.id === "a")?.count).toBe(2);
  });
});

describe("createTag", () => {
  it("refuse un viewer (403)", async () => {
    h.canWrite = false;
    await expect(createTag(user, "o", "Logo")).rejects.toMatchObject({ status: 403 });
  });
  it("refuse un libellé vide ou non texte (400)", async () => {
    await expect(createTag(user, "o", "  ")).rejects.toMatchObject({ status: 400 });
    await expect(createTag(user, "o", 5)).rejects.toMatchObject({ status: 400 });
  });
  it("crée", async () => {
    expect(await createTag(user, "o", "Logo")).toMatchObject({ label: "Logo" });
  });
});
