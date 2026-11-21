import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

const h = vi.hoisted(() => ({
  denied: null as null | 404 | 403,
  admin: false,
  list: [] as unknown[],
  scopeCalls: [] as unknown[],
}));

vi.mock("@/lib/auth/require-org-scoped", () => {
  class OrgScopeError extends Error {
    constructor(public response: Response) {
      super("scope");
    }
  }
  return {
    OrgScopeError,
    requireOrgScoped: vi.fn(async (opts: unknown) => {
      h.scopeCalls.push(opts);
      if (h.denied === 404) {
        throw new OrgScopeError(new Response(JSON.stringify({ error: "Introuvable" }), { status: 404 }));
      }
      if (h.denied === 403) {
        throw new OrgScopeError(new Response(JSON.stringify({ error: "Accès refusé" }), { status: 403 }));
      }
      return { user: { id: "u1" }, orgId: "org1", orgSlug: "o" };
    }),
  };
});
vi.mock("@/lib/db", () => ({ db: {} }));
vi.mock("@/lib/media/access", () => ({ isOrgAdminOrOwner: vi.fn(async () => h.admin) }));
vi.mock("@/lib/databases/row-history-read", async () => {
  const actual = await vi.importActual<typeof import("@/lib/databases/row-history-read")>(
    "@/lib/databases/row-history-read"
  );
  return {
    ...actual,
    listRowHistory: vi.fn(async (_e: unknown, args: { cursor?: string }) => {
      h.list.push(args);
      if (args.cursor) actual.decodeHistoryCursor(args.cursor);
      return { items: [], nextCursor: null };
    }),
  };
});

import { GET } from "@/app/api/databases/[databaseId]/rows/[rowId]/history/route";
import { listRowHistory } from "@/lib/databases/row-history-read";

const DB = "11111111-1111-4111-8111-111111111111";
const ROW = "22222222-2222-4222-8222-222222222222";

function call(qs = "", ids: { databaseId: string; rowId: string } = { databaseId: DB, rowId: ROW }) {
  return GET(new NextRequest(`http://localhost/api/databases/${ids.databaseId}/rows/${ids.rowId}/history${qs}`), {
    params: Promise.resolve(ids),
  });
}

beforeEach(() => {
  h.denied = null;
  h.admin = false;
  h.list = [];
  h.scopeCalls = [];
  vi.mocked(listRowHistory).mockClear();
});

describe("GET row history", () => {
  it("autre organisation, sans permission et base inexistante : 404 au corps identique", async () => {
    h.denied = 404;
    const other = await call();
    expect(other.status).toBe(404);
    const body404 = await other.json();
    expect(body404).toEqual({ error: "Introuvable" });

    h.denied = 403;
    const noPerm = await call();
    expect(noPerm.status).toBe(404);
    expect(await noPerm.json()).toEqual(body404);
    expect(listRowHistory).not.toHaveBeenCalled();
  });

  it("requireOrgScoped est appelé avec la base et le seuil viewer", async () => {
    await call();
    expect(h.scopeCalls[0]).toEqual({ resource: { type: "database", id: DB }, minPermission: "viewer" });
  });

  it("databaseId non uuid : 404 sans requête base", async () => {
    const res = await call("", { databaseId: "nope", rowId: ROW });
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: "Introuvable" });
    expect(h.scopeCalls).toHaveLength(0);
    expect(listRowHistory).not.toHaveBeenCalled();
  });

  it("rowId non uuid : 404", async () => {
    const res = await call("", { databaseId: DB, rowId: "nope" });
    expect(res.status).toBe(404);
    expect(listRowHistory).not.toHaveBeenCalled();
  });

  it.each(["limit=0", "limit=51", "limit=abc", "limit=-1", "limit=1.5", "limit="])("%s : 400", async (qs) => {
    const res = await call(`?${qs}`);
    expect(res.status).toBe(400);
    expect(listRowHistory).not.toHaveBeenCalled();
  });

  it("cursor=zzz : 400", async () => {
    const res = await call("?cursor=zzz");
    expect(res.status).toBe(400);
  });

  it("limit par défaut 20, limite 50 acceptée", async () => {
    await call();
    expect((h.list[0] as { limit: number }).limit).toBe(20);
    await call("?limit=50");
    expect((h.list[1] as { limit: number }).limit).toBe(50);
  });

  it("canClear vrai pour admin d'organisation, faux pour un membre", async () => {
    h.admin = true;
    expect((await (await call()).json()).canClear).toBe(true);
    h.admin = false;
    expect((await (await call()).json()).canClear).toBe(false);
  });
});
