import { describe, it, expect, vi, beforeEach } from "vitest";

type Decision = Record<string, unknown>;

const h = vi.hoisted(() => ({
  listed: [] as unknown[],
  visible: null as Record<string, unknown> | null,
  updateDecision: { ok: true } as Decision,
  deleteDecision: { ok: true, promoteDefault: false } as Decision,
  insertError: null as unknown,
  inserted: [] as Record<string, unknown>[],
  updates: [] as Record<string, unknown>[],
  deletes: 0,
  directTableReads: 0,
  txCount: 0,
  newDefault: { id: "v-next" } as { id: string } | null,
  wheres: [] as unknown[],
}));

vi.mock("@/lib/auth/require-org-scoped", () => {
  class OrgScopeError extends Error {
    constructor(public response: Response) {
      super("scope");
    }
  }
  return {
    OrgScopeError,
    requireOrgScoped: vi.fn(async () => ({ user: { id: "u1" }, orgId: "o", spaceId: "s", permission: "editor" })),
  };
});

vi.mock("@/lib/databases/view-access", () => ({
  listVisibleViews: vi.fn(async () => h.listed),
  getVisibleView: vi.fn(async () => h.visible),
  decideViewCreate: (a: { scope: string; isDefault?: boolean; isPublic?: boolean }) =>
    a.scope === "personal" && (a.isDefault || a.isPublic)
      ? { ok: false, status: 400, error: "Une vue personnelle ne peut être ni par défaut ni publique" }
      : { ok: true },
  decideViewUpdate: vi.fn(async () => h.updateDecision),
  decideViewDelete: vi.fn(async () => h.deleteDecision),
}));

function chain(result: () => unknown) {
  const c: Record<string, unknown> = {};
  for (const k of ["from", "orderBy", "limit", "set", "values"]) c[k] = () => c;
  c.where = (w: unknown) => {
    h.wheres.push(w);
    return c;
  };
  c.then = (res: (v: unknown) => unknown) => Promise.resolve(result()).then(res);
  c.returning = async () => {
    if (h.insertError) throw h.insertError;
    return [{ id: "new", ...h.inserted[h.inserted.length - 1], ...h.updates[h.updates.length - 1] }];
  };
  return c;
}

vi.mock("@/lib/db", () => {
  const tx = {
    select: () => chain(() => [{ max: 2, id: h.newDefault?.id }].filter(() => true).slice(0, 1)),
    insert: () => ({
      values: (v: Record<string, unknown>) => {
        h.inserted.push(v);
        return chain(() => []);
      },
    }),
    update: () => ({
      set: (v: Record<string, unknown>) => {
        h.updates.push(v);
        return chain(() => []);
      },
    }),
    delete: () => {
      h.deletes++;
      return chain(() => []);
    },
  };
  return {
    db: {
      select: () => {
        h.directTableReads++;
        return chain(() => []);
      },
      transaction: async (fn: (t: typeof tx) => unknown) => {
        h.txCount++;
        return fn(tx);
      },
    },
  };
});

import { GET, POST } from "@/app/api/databases/[databaseId]/views/route";
import { PATCH, DELETE } from "@/app/api/databases/[databaseId]/views/[viewId]/route";

const DB = "11111111-1111-4111-8111-111111111111";
const VID = "22222222-2222-4222-8222-222222222222";
const P = { params: Promise.resolve({ databaseId: DB }) };
const PV = { params: Promise.resolve({ databaseId: DB, viewId: VID }) };
const req = (body?: unknown, method = "POST") =>
  new Request("http://x", { method, body: body === undefined ? undefined : JSON.stringify(body) });

const baseView = { id: VID, databaseId: DB, scope: "shared", createdBy: "u1", isDefault: false, publicToken: null, config: { a: 1 } };

beforeEach(() => {
  h.listed = [];
  h.visible = baseView;
  h.updateDecision = { ok: true, revokePublicToken: false, unsetDefaultOthers: false, view: baseView };
  h.deleteDecision = { ok: true, promoteDefault: false };
  h.insertError = null;
  h.inserted = [];
  h.updates = [];
  h.deletes = 0;
  h.directTableReads = 0;
  h.txCount = 0;
  h.newDefault = { id: "v-next" };
  h.wheres = [];
});

describe("GET views", () => {
  it("renvoie ce que listVisibleViews renvoie, sans appel direct à la table", async () => {
    h.listed = [{ id: "a" }, { id: "b" }];
    const res = await GET(req(undefined, "GET"), P);
    expect(await res.json()).toEqual([{ id: "a" }, { id: "b" }]);
    expect(h.directTableReads).toBe(0);
  });
});

describe("POST views", () => {
  it("sans scope crée une vue shared", async () => {
    const res = await POST(req({ name: "V", type: "grid" }), P);
    expect(res.status).toBe(201);
    expect(h.inserted[0].scope).toBe("shared");
  });

  it("scope personal : createdBy = appelant", async () => {
    const res = await POST(req({ name: "V", type: "grid", scope: "personal" }), P);
    expect(res.status).toBe(201);
    expect(h.inserted[0]).toMatchObject({ scope: "personal", createdBy: "u1" });
  });

  it("personal avec isPublic : 400", async () => {
    const res = await POST(req({ name: "V", type: "grid", scope: "personal", isPublic: true }), P);
    expect(res.status).toBe(400);
    expect(h.inserted).toHaveLength(0);
  });

  it("createdBy dans le corps : ignoré", async () => {
    await POST(req({ name: "V", type: "grid", createdBy: "intrus" }), P);
    expect(h.inserted[0].createdBy).toBe("u1");
  });

  it("isDefault ne démarque que les vues partagées", async () => {
    await POST(req({ name: "V", type: "grid", isDefault: true }), P);
    expect(h.updates[0]).toEqual({ isDefault: false });
  });

  it("une vue personnelle de même nom qu'une personnelle d'un autre : 201 (aucune violation)", async () => {
    const res = await POST(req({ name: "Mes deals", type: "kanban", scope: "personal" }), P);
    expect(res.status).toBe(201);
  });

  it("personal : le MAX(position) est restreint à l'appelant (aucune fuite des vues d'autrui)", async () => {
    await POST(req({ name: "V", type: "grid", scope: "personal" }), P);
    const walk = (n: unknown, seen = new Set<unknown>()): string[] => {
      if (n === null || typeof n !== "object" || seen.has(n)) return [];
      seen.add(n);
      const out: string[] = [];
      for (const v of Object.values(n as Record<string, unknown>)) {
        if (typeof v === "string") out.push(v);
        else out.push(...walk(v, seen));
      }
      return out;
    };
    expect(walk(h.wheres[0])).toContain("u1");
  });

  it("shared : le MAX(position) ne dépend pas de l'appelant", async () => {
    await POST(req({ name: "V", type: "grid" }), P);
    const walk = (n: unknown, seen = new Set<unknown>()): string[] => {
      if (n === null || typeof n !== "object" || seen.has(n)) return [];
      seen.add(n);
      const out: string[] = [];
      for (const v of Object.values(n as Record<string, unknown>)) {
        if (typeof v === "string") out.push(v);
        else out.push(...walk(v, seen));
      }
      return out;
    };
    expect(walk(h.wheres[0])).not.toContain("u1");
  });

  it("violation d'unicité 23505 : 409 Nom déjà utilisé", async () => {
    h.insertError = Object.assign(new Error("dup"), { code: "23505" });
    const res = await POST(req({ name: "V", type: "grid" }), P);
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ error: "Nom déjà utilisé" });
  });

  it("violation 23505 portée par cause : 409", async () => {
    h.insertError = Object.assign(new Error("wrapped"), { cause: { code: "23505" } });
    const res = await POST(req({ name: "V", type: "grid" }), P);
    expect(res.status).toBe(409);
  });
});

describe("PATCH views", () => {
  it("personnelle d'un autre : 404 et même corps qu'une vue inexistante", async () => {
    h.visible = null;
    const a = await PATCH(req({ name: "x" }, "PATCH"), PV);
    const bodyA = await a.json();
    expect(a.status).toBe(404);
    expect(bodyA).toEqual({ error: "Introuvable" });
    expect(h.updates).toHaveLength(0);
  });

  it("scope par un non-auteur : 403 et aucun UPDATE", async () => {
    h.updateDecision = { ok: false, status: 403, error: "Accès refusé" };
    const res = await PATCH(req({ scope: "personal" }, "PATCH"), PV);
    expect(res.status).toBe(403);
    expect(h.updates).toHaveLength(0);
  });

  it("createdBy et databaseId du corps ne sont jamais écrits", async () => {
    await PATCH(req({ name: "n", createdBy: "intrus", databaseId: "autre" }, "PATCH"), PV);
    expect(h.updates[0]).not.toHaveProperty("createdBy");
    expect(h.updates[0]).not.toHaveProperty("databaseId");
  });

  it("isPublic false : publicToken mis à null", async () => {
    await PATCH(req({ isPublic: false }, "PATCH"), PV);
    expect(h.updates[0].publicToken).toBeNull();
  });

  it("revokePublicToken de la décision : publicToken mis à null", async () => {
    h.updateDecision = { ok: true, revokePublicToken: true, unsetDefaultOthers: false, view: baseView };
    await PATCH(req({ scope: "personal" }, "PATCH"), PV);
    expect(h.updates[0]).toMatchObject({ publicToken: null, isPublic: false, scope: "personal" });
  });

  it("isPublic true génère un token", async () => {
    await PATCH(req({ isPublic: true }, "PATCH"), PV);
    expect(typeof h.updates[0].publicToken).toBe("string");
  });

  it("unsetDefaultOthers : démarque les partagées avant l'écriture", async () => {
    h.updateDecision = { ok: true, revokePublicToken: false, unsetDefaultOthers: true, view: baseView };
    await PATCH(req({ isDefault: true }, "PATCH"), PV);
    expect(h.updates[0]).toEqual({ isDefault: false });
    expect(h.updates[1].isDefault).toBe(true);
  });

  it("fusionne config en surface avec la vue relue sous verrou", async () => {
    await PATCH(req({ config: { b: 2 } }, "PATCH"), PV);
    expect(h.updates[0].config).toMatchObject({ a: 1, b: 2 });
  });

  it("corps invalide : 400", async () => {
    const res = await PATCH(req({ name: "" }, "PATCH"), PV);
    expect(res.status).toBe(400);
  });

  it("décision exécutée dans une transaction", async () => {
    await PATCH(req({ name: "n" }, "PATCH"), PV);
    expect(h.txCount).toBe(1);
  });

  it("23505 sur le renommage : 409", async () => {
    h.insertError = Object.assign(new Error("dup"), { code: "23505" });
    const res = await PATCH(req({ name: "n" }, "PATCH"), PV);
    expect(res.status).toBe(409);
  });
});

describe("DELETE views", () => {
  it("vue invisible : 404 Introuvable", async () => {
    h.visible = null;
    const res = await DELETE(req(undefined, "DELETE"), PV);
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: "Introuvable" });
  });

  it("dernière partagée : 400, rien supprimé", async () => {
    h.deleteDecision = { ok: false, status: 400, error: "Impossible de supprimer la dernière vue partagée d'une base" };
    const res = await DELETE(req(undefined, "DELETE"), PV);
    expect(res.status).toBe(400);
    expect(h.deletes).toBe(0);
  });

  it("partagée isDefault : la première vue partagée est promue", async () => {
    h.deleteDecision = { ok: true, promoteDefault: true };
    const res = await DELETE(req(undefined, "DELETE"), PV);
    expect(res.status).toBe(200);
    expect(h.deletes).toBe(1);
    expect(h.updates).toEqual([{ isDefault: true }]);
  });

  it("sans promoteDefault : aucune promotion", async () => {
    await DELETE(req(undefined, "DELETE"), PV);
    expect(h.updates).toHaveLength(0);
  });
});
