/**
 * T5 : API colonnes et relations jumelées (droits cross-base, contrat d'API).
 * La logique SQL est couverte par relation-columns.integration.test.ts.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const SRC = "11111111-1111-4111-8111-111111111111";
const TGT = "22222222-2222-4222-8222-222222222222";
const COL = "33333333-3333-4333-8333-333333333333";
const INV = "44444444-4444-4444-8444-444444444444";

const h = vi.hoisted(() => {
  class FakeOrgScopeError extends Error {
    constructor(public response: Response) {
      super("scope");
    }
  }
  return {
  FakeOrgScopeError,
  requireOrgScoped: vi.fn(),
  selectQueue: [] as unknown[][],
  createPaired: vi.fn(),
  deleteWithPair: vi.fn(),
  findInverse: vi.fn(),
  unpairInverse: vi.fn(),
  unpairDeleted: vi.fn(),
  inserted: [] as unknown[],
  updated: [] as unknown[],
  };
});
const { FakeOrgScopeError } = h;

vi.mock("@/lib/auth/require-org-scoped", () => ({
  requireOrgScoped: h.requireOrgScoped,
  OrgScopeError: h.FakeOrgScopeError,
}));
vi.mock("@/lib/databases/relation-columns", async (orig) => ({
  ...(await orig<typeof import("@/lib/databases/relation-columns")>()),
  createPairedRelationColumn: h.createPaired,
  deleteColumnWithPair: h.deleteWithPair,
  findPairedInverse: h.findInverse,
  unpairInverse: h.unpairInverse,
  unpairColumnsOfDeletedDatabase: h.unpairDeleted,
}));

function chain() {
  const rows = () => h.selectQueue.shift() ?? [];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const self: any = {
    then: (res: (v: unknown) => void, rej?: (e: unknown) => void) => Promise.resolve(rows()).then(res, rej),
    from: () => self,
    where: () => self,
    orderBy: () => self,
    limit: () => Promise.resolve(rows()),
  };
  return self;
}
const tx = {
  execute: vi.fn(),
  select: vi.fn(() => chain()),
  insert: vi.fn(() => ({
    values: (v: unknown) => {
      h.inserted.push(v);
      return { returning: async () => [{ id: COL, type: "relation", config: (v as { config: unknown }).config }] };
    },
  })),
  update: vi.fn(() => ({
    set: (v: unknown) => {
      h.updated.push(v);
      return { where: () => ({ returning: async () => [{ id: COL, type: "relation", config: {} }] }) };
    },
  })),
  delete: vi.fn(() => ({ where: async () => undefined })),
};
vi.mock("@/lib/db", () => ({
  db: {
    select: vi.fn(() => chain()),
    transaction: vi.fn(async (cb: (t: typeof tx) => unknown) => cb(tx)),
    delete: vi.fn(),
  },
}));

import { POST, PATCH, DELETE } from "@/app/api/databases/[databaseId]/columns/route";
import { DELETE as deleteDatabase } from "@/app/api/databases/[databaseId]/route";
import { RelationColumnError } from "@/lib/databases/relation-columns";

const params = (id: string) => ({ params: Promise.resolve({ databaseId: id }) });
const req = (body: unknown) =>
  new Request("http://x/api", { method: "POST", body: JSON.stringify(body) });

/** requireOrgScoped : la base source passe, la cible selon `targetOk`. */
function scope(targetOk: boolean) {
  h.requireOrgScoped.mockImplementation(async (o: { resource: { id: string } }) => {
    if (o.resource.id === TGT && !targetOk) {
      throw new FakeOrgScopeError(new Response(null, { status: 403 }));
    }
    return { orgId: "o" };
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  h.selectQueue.length = 0;
  h.inserted.length = 0;
  h.updated.length = 0;
  h.findInverse.mockReset();
  scope(true);
  h.createPaired.mockResolvedValue({
    column: { id: COL, type: "relation", config: { targetDatabaseId: TGT, inverseColumnId: INV } },
    inverse: { id: INV, type: "relation", config: { targetDatabaseId: SRC, inverseColumnId: COL } },
  });
});

describe("POST /columns relation", () => {
  const body = { name: "Interactions", type: "relation", config: { targetDatabaseId: TGT } };

  it("crée la jumelle par défaut, nom proposé = nom de la base source", async () => {
    h.selectQueue.push([{ name: "Contacts" }]);
    const res = await POST(req(body) as never, params(SRC));
    expect(res.status).toBe(201);
    const json = await res.json();
    expect(json.inverseColumn.id).toBe(INV);
    expect(h.createPaired.mock.calls[0][1]).toMatchObject({
      databaseId: SRC, targetDatabaseId: TGT, inverseName: "Contacts",
    });
  });

  it("utilise inverseName fourni et n'accepte jamais inverseColumnId du client", async () => {
    h.selectQueue.push([{ name: "Contacts" }]);
    await POST(
      req({ ...body, inverseName: "Relances", config: { targetDatabaseId: TGT, inverseColumnId: "x" } }) as never,
      params(SRC)
    );
    const arg = h.createPaired.mock.calls[0][1];
    expect(arg.inverseName).toBe("Relances");
    expect(arg.config.inverseColumnId).toBeUndefined();
  });

  it("cible sans droit editor : 404 muet, rien créé", async () => {
    scope(false);
    const res = await POST(req(body) as never, params(SRC));
    expect(res.status).toBe(404);
    expect(h.createPaired).not.toHaveBeenCalled();
    expect(tx.insert).not.toHaveBeenCalled();
  });

  it("cible inexistante ou non UUID : 404", async () => {
    const res = await POST(
      req({ ...body, config: { targetDatabaseId: "pas-un-uuid" } }) as never,
      params(SRC)
    );
    expect(res.status).toBe(404);
  });

  it("nom d'inverse déjà pris : 409 explicite", async () => {
    h.selectQueue.push([{ name: "Contacts" }]);
    h.createPaired.mockRejectedValue(new RelationColumnError("inverse-name-exists", "Une colonne « X » existe déjà"));
    const res = await POST(req(body) as never, params(SRC));
    expect(res.status).toBe(409);
    expect((await res.json()).code).toBe("inverse-name-exists");
  });

  it("createInverse=false : relation simple, sans jumelle, inverseColumnId retiré", async () => {
    const res = await POST(
      req({ ...body, createInverse: false, config: { targetDatabaseId: TGT, inverseColumnId: "x" } }) as never,
      params(SRC)
    );
    expect(res.status).toBe(201);
    expect(h.createPaired).not.toHaveBeenCalled();
    expect((h.inserted[0] as { config: Record<string, unknown> }).config).toEqual({ targetDatabaseId: TGT });
  });

  it("colonne non relation portant targetDatabaseId : la cible est ignorée", async () => {
    scope(false);
    const res = await POST(
      req({ name: "T", type: "text", config: { targetDatabaseId: TGT, keep: 1 } }) as never,
      params(SRC)
    );
    expect(res.status).toBe(201);
    expect((h.inserted[0] as { config: Record<string, unknown> }).config).toEqual({ keep: 1 });
  });

  it("nom de plus de 255 caractères : 400", async () => {
    const res = await POST(req({ ...body, name: "x".repeat(256) }) as never, params(SRC));
    expect(res.status).toBe(400);
  });

  it("auto-relation : sens unique, pas de jumelle", async () => {
    await POST(req({ ...body, config: { targetDatabaseId: SRC } }) as never, params(SRC));
    expect(h.createPaired).not.toHaveBeenCalled();
  });
});

describe("PATCH /columns", () => {
  const patch = (cols: unknown) =>
    new Request("http://x/api", { method: "PATCH", body: JSON.stringify({ columns: cols }) });

  it("refuse de changer la cible d'une relation jumelée", async () => {
    h.selectQueue.push([
      { id: COL, databaseId: SRC, type: "relation", config: { targetDatabaseId: TGT, inverseColumnId: INV } },
    ]);
    h.findInverse.mockResolvedValue({ id: INV });
    const res = await PATCH(
      patch([{ id: COL, config: { targetDatabaseId: SRC } }]) as never,
      params(SRC)
    );
    expect(res.status).toBe(400);
    expect((await res.json()).code).toBe("paired-target-locked");
  });

  it("nouvelle cible d'une relation simple sans droit : 404", async () => {
    scope(false);
    h.selectQueue.push([{ id: COL, databaseId: SRC, type: "relation", config: {} }]);
    const res = await PATCH(
      patch([{ id: COL, config: { targetDatabaseId: TGT } }]) as never,
      params(SRC)
    );
    expect(res.status).toBe(404);
  });

  it("passage d'un type non relation vers relation avec cible sans droit : 404", async () => {
    scope(false);
    h.selectQueue.push([{ id: COL, databaseId: SRC, type: "text", config: {} }]);
    const res = await PATCH(
      patch([{ id: COL, type: "relation", config: { targetDatabaseId: TGT } }]) as never,
      params(SRC)
    );
    expect(res.status).toBe(404);
    expect(tx.update).not.toHaveBeenCalled();
  });

  it("passage vers relation sans config mais cible déjà en config, sans droit : 404", async () => {
    scope(false);
    h.selectQueue.push([{ id: COL, databaseId: SRC, type: "text", config: { targetDatabaseId: TGT } }]);
    const res = await PATCH(patch([{ id: COL, type: "relation" }]) as never, params(SRC));
    expect(res.status).toBe(404);
  });

  it("PATCH de config sans targetDatabaseId sur une jumelle : cible et inverse conservés", async () => {
    const existing = { id: COL, databaseId: SRC, type: "relation", config: { targetDatabaseId: TGT, inverseColumnId: INV } };
    h.selectQueue.push([existing], [existing]);
    h.findInverse.mockResolvedValue({ id: INV });
    const res = await PATCH(patch([{ id: COL, config: { foo: 1 } }]) as never, params(SRC));
    expect(res.status).toBe(200);
    expect((h.updated[0] as { config: unknown }).config).toEqual({
      foo: 1, targetDatabaseId: TGT, inverseColumnId: INV,
    });
  });

  it("jumelle orpheline : la cible n'est pas figée, l'inverseColumnId orphelin est nettoyé", async () => {
    const existing = { id: COL, databaseId: SRC, type: "relation", config: { targetDatabaseId: TGT, inverseColumnId: INV } };
    h.selectQueue.push([existing], [existing]);
    h.findInverse.mockResolvedValue(null);
    const res = await PATCH(
      patch([{ id: COL, config: { targetDatabaseId: SRC } }]) as never,
      params(SRC)
    );
    expect(res.status).toBe(200);
    expect((h.updated[0] as { config: unknown }).config).toEqual({ targetDatabaseId: SRC });
  });

  it("nom trop long ou JSON invalide : 400", async () => {
    const long = await PATCH(patch([{ id: COL, name: "x".repeat(256) }]) as never, params(SRC));
    expect(long.status).toBe(400);
    const bad = await PATCH(new Request("http://x/api", { method: "PATCH", body: "{" }) as never, params(SRC));
    expect(bad.status).toBe(400);
  });

  it("changement de type d'une colonne jumelée : la jumelle est dé-jumelée", async () => {
    const existing = { id: COL, databaseId: SRC, type: "relation", config: { targetDatabaseId: TGT, inverseColumnId: INV } };
    h.selectQueue.push([existing], [existing]);
    h.findInverse.mockResolvedValue({ id: INV });
    const res = await PATCH(patch([{ id: COL, type: "text" }]) as never, params(SRC));
    expect(res.status).toBe(200);
    expect(h.unpairInverse).toHaveBeenCalledWith(expect.anything(), INV);
  });
});

describe("DELETE /columns", () => {
  const del = (b: unknown) => new Request("http://x/api", { method: "DELETE", body: JSON.stringify(b) });
  const existing = { id: COL, databaseId: SRC, type: "relation", config: { targetDatabaseId: TGT, inverseColumnId: INV } };

  it("par défaut conserve la jumelle (alsoDeleteInverse=false)", async () => {
    h.selectQueue.push([existing]);
    h.deleteWithPair.mockResolvedValue({ deletedInverseColumnId: null });
    const res = await DELETE(del({ columnId: COL }) as never, params(SRC));
    expect(res.status).toBe(200);
    expect(h.deleteWithPair.mock.calls[0][1]).toMatchObject({ alsoDeleteInverse: false });
  });

  it("alsoDeleteInverse=true avec droit sur la base de la jumelle", async () => {
    h.selectQueue.push([existing]);
    h.findInverse.mockResolvedValue({ id: INV, databaseId: TGT });
    h.deleteWithPair.mockResolvedValue({ deletedInverseColumnId: INV });
    const res = await DELETE(del({ columnId: COL, alsoDeleteInverse: true }) as never, params(SRC));
    expect(await res.json()).toEqual({ ok: true, deletedInverseColumnId: INV });
  });

  it("alsoDeleteInverse=true sans droit sur la base de la jumelle : 404, rien supprimé", async () => {
    scope(false);
    h.selectQueue.push([existing]);
    h.findInverse.mockResolvedValue({ id: INV, databaseId: TGT });
    const res = await DELETE(del({ columnId: COL, alsoDeleteInverse: true }) as never, params(SRC));
    expect(res.status).toBe(404);
    expect(h.deleteWithPair).not.toHaveBeenCalled();
  });
});

describe("DELETE /databases/[id]", () => {
  it("dé-jumelle les colonnes inverses avant la suppression", async () => {
    const res = await deleteDatabase(new Request("http://x", { method: "DELETE" }), params(SRC));
    expect(res.status).toBe(200);
    expect(h.unpairDeleted).toHaveBeenCalledWith(expect.anything(), SRC);
    expect(tx.execute).toHaveBeenCalled(); // verrou advisory de la base
    expect(tx.execute.mock.invocationCallOrder[0]).toBeLessThan(h.unpairDeleted.mock.invocationCallOrder[0]);
    expect(tx.delete).toHaveBeenCalled();
  });
});
