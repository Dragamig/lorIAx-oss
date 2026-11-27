import { describe, expect, it, vi, beforeEach } from "vitest";

const h = vi.hoisted(() => ({
  queue: [] as unknown[],
  failInsert: null as unknown,
  admin: false,
  member: true,
  calls: [] as string[],
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
    },
  );
  return self;
}
vi.mock("@/lib/db", () => ({
  db: {
    select: () => chain("select"),
    insert: () => chain("insert"),
    update: () => chain("update"),
    delete: () => chain("delete"),
  },
}));
vi.mock("@/lib/media/access", () => ({ isOrgAdminOrOwner: () => Promise.resolve(h.admin) }));
vi.mock("@/lib/org/resolve-request-org", () => ({ isOrgMember: () => Promise.resolve(h.member) }));

import {
  SavedViewError,
  createSavedView,
  deleteSavedView,
  listSavedViews,
  normalizeViewQuery,
  updateSavedView,
} from "./saved-views";

const ORG = "org1";
const me = { id: "u1", globalRole: "editor" } as never;
const ID = "11111111-1111-4111-8111-111111111111";
const row = (o: Record<string, unknown> = {}) => ({
  id: ID,
  organizationId: ORG,
  userId: "u1",
  name: "Vue",
  query: "",
  shared: false,
  ...o,
});
async function status(p: Promise<unknown>): Promise<number | null> {
  try {
    await p;
    return null;
  } catch (e) {
    if (e instanceof SavedViewError) return e.status;
    throw e;
  }
}

beforeEach(() => {
  h.queue = [];
  h.failInsert = null;
  h.admin = false;
  h.member = true;
  h.calls = [];
});

describe("normalizeViewQuery", () => {
  it("retire cursor et limit et canonise", () => {
    expect(normalizeViewQuery("kind=image&limit=10&cursor=abc&view=unused")).toBe("view=unused&kind=image");
  });
  it("accepte une chaîne vide", () => {
    expect(normalizeViewQuery("")).toBe("");
  });
  it("rejette un filtre invalide ou un champ inconnu ignoré", () => {
    expect(() => normalizeViewQuery("view=nimporte")).toThrow(SavedViewError);
    expect(() => normalizeViewQuery("spaceId=pas-un-uuid")).toThrow(SavedViewError);
    expect(normalizeViewQuery("evil=1;drop")).toBe("");
  });
  it("rejette un type non chaîne et une chaîne trop longue", () => {
    expect(() => normalizeViewQuery(42)).toThrow(SavedViewError);
    expect(() => normalizeViewQuery("q=" + "a".repeat(2100))).toThrow(SavedViewError);
  });
  it("garde un filtre vers un espace quelconque sans le résoudre", () => {
    const sp = "22222222-2222-4222-8222-222222222222";
    expect(normalizeViewQuery(`spaceId=${sp}`)).toBe(`spaceId=${sp}`);
  });
});

describe("createSavedView", () => {
  it("crée une vue valide", async () => {
    h.queue = [[{ n: 3 }], [row({ name: "Mes images", query: "kind=image" })]];
    const v = await createSavedView(me, ORG, { name: " Mes images ", query: "kind=image", shared: false });
    expect(v).toMatchObject({ name: "Mes images", query: "kind=image", mine: true, shared: false });
  });
  it("nom vide ou trop long : 400", async () => {
    expect(await status(createSavedView(me, ORG, { name: "  ", query: "" }))).toBe(400);
    expect(await status(createSavedView(me, ORG, { name: "a".repeat(81), query: "" }))).toBe(400);
  });
  it("query invalide : 400", async () => {
    expect(await status(createSavedView(me, ORG, { name: "x", query: "view=zzz" }))).toBe(400);
  });
  it("doublon (user, nom) : 409", async () => {
    h.queue = [[{ n: 1 }]];
    h.failInsert = { code: "23505" };
    expect(await status(createSavedView(me, ORG, { name: "x", query: "" }))).toBe(409);
  });
  it("51e vue : 409 sans insertion", async () => {
    h.queue = [[{ n: 50 }]];
    expect(await status(createSavedView(me, ORG, { name: "x", query: "" }))).toBe(409);
    expect(h.calls).not.toContain("insert");
  });
  it("non-membre : 403", async () => {
    h.member = false;
    expect(await status(createSavedView(me, ORG, { name: "x", query: "" }))).toBe(403);
  });
});

describe("listSavedViews", () => {
  it("sépare personnelles et partagées des autres", async () => {
    h.queue = [[row({ name: "A", shared: true }), row({ id: "v2", userId: "u2", name: "B", shared: true })]];
    const r = await listSavedViews(me, ORG);
    expect(r.mine.map((v) => v.name)).toEqual(["A"]);
    expect(r.shared.map((v) => v.name)).toEqual(["B"]);
    expect(r.shared[0].mine).toBe(false);
  });
  it("non-membre d'une autre organisation : 403 sans requête", async () => {
    h.member = false;
    expect(await status(listSavedViews(me, "autre"))).toBe(403);
    expect(h.calls).toEqual([]);
  });
});

describe("updateSavedView et deleteSavedView", () => {
  it("l'auteur renomme", async () => {
    h.queue = [[row()], [row({ name: "Neuf" })]];
    const v = await updateSavedView(me, ORG, ID, { name: "Neuf" });
    expect(v.name).toBe("Neuf");
  });
  it("l'auteur partage et ne partage plus", async () => {
    h.queue = [[row()], [row({ shared: true })]];
    expect((await updateSavedView(me, ORG, ID, { shared: true })).shared).toBe(true);
  });
  it("vue d'un autre utilisateur, non partagée : 404 même pour un admin", async () => {
    h.admin = true;
    h.queue = [[row({ userId: "u2", shared: false })]];
    expect(await status(updateSavedView(me, ORG, ID, { name: "x" }))).toBe(404);
    h.queue = [[row({ userId: "u2", shared: false })]];
    expect(await status(deleteSavedView(me, ORG, ID))).toBe(404);
  });
  it("vue partagée d'un autre : 404 pour un membre simple", async () => {
    h.queue = [[row({ userId: "u2", shared: true })]];
    expect(await status(updateSavedView(me, ORG, ID, { name: "x" }))).toBe(404);
    h.queue = [[row({ userId: "u2", shared: true })]];
    expect(await status(deleteSavedView(me, ORG, ID))).toBe(404);
    expect(h.calls).not.toContain("update");
    expect(h.calls).not.toContain("delete");
  });
  it("vue partagée d'un autre : admin peut modifier et supprimer", async () => {
    h.admin = true;
    h.queue = [[row({ userId: "u2", shared: true })], [row({ userId: "u2", shared: true, name: "N" })]];
    expect((await updateSavedView(me, ORG, ID, { name: "N" })).mine).toBe(false);
    h.queue = [[row({ userId: "u2", shared: true })], []];
    expect(await status(deleteSavedView(me, ORG, ID))).toBeNull();
    expect(h.calls).toContain("delete");
  });
  it("vue d'une autre organisation (ligne absente de la requête filtrée) : 404", async () => {
    h.queue = [[]];
    expect(await status(updateSavedView(me, ORG, ID, { name: "x" }))).toBe(404);
    h.queue = [[]];
    expect(await status(deleteSavedView(me, ORG, ID))).toBe(404);
  });
  it("patch vide, partage non booléen, query invalide : 400", async () => {
    expect(await status(updateSavedView(me, ORG, ID, {}))).toBe(400);
    expect(await status(updateSavedView(me, ORG, ID, { shared: "oui" }))).toBe(400);
    expect(await status(updateSavedView(me, ORG, ID, { query: "sort=zzz" }))).toBe(400);
  });
  it("renommage vers un nom existant : 409", async () => {
    const err = { code: "23505" };
    h.queue = [[row()]];
    const { db } = await import("@/lib/db");
    const orig2 = db.update;
    (db as unknown as { update: unknown }).update = () => ({
      set: () => ({ where: () => ({ returning: () => Promise.reject(err) }) }),
    });
    expect(await status(updateSavedView(me, ORG, ID, { name: "pris" }))).toBe(409);
    (db as unknown as { update: unknown }).update = orig2;
  });
});
