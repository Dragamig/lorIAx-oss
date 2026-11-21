import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest, NextResponse } from "next/server";

const h = vi.hoisted(() => ({
  scope: "ok" as "ok" | 404,
  permission: "viewer" as "viewer" | "editor" | "admin",
  admin: false,
  list: vi.fn(),
}));

vi.mock("@/lib/auth/require-org-scoped", () => {
  class OrgScopeError extends Error {
    constructor(public response: Response) {
      super("scope");
    }
  }
  return {
    OrgScopeError,
    requireOrgScoped: vi.fn(async () => {
      if (h.scope === 404) throw new OrgScopeError(NextResponse.json({ error: "Introuvable" }, { status: 404 }));
      return { user: { id: "u1", name: "Ana" }, orgId: "org1", spaceId: "space1", permission: h.permission };
    }),
  };
});
vi.mock("@/lib/db", () => ({ db: {} }));
vi.mock("@/lib/media/access", () => ({ isOrgAdminOrOwner: vi.fn(async () => h.admin) }));
vi.mock("@/lib/databases/row-activity-read", () => ({ listRowActivity: h.list }));

import { InvalidHistoryCursorError } from "@/lib/databases/row-history-read";
import { GET } from "@/app/api/databases/[databaseId]/rows/[rowId]/activity/route";

const DB = "11111111-1111-4111-8111-111111111111";
const ROW = "22222222-2222-4222-8222-222222222222";
const call = (qs = "", db = DB) =>
  GET(new NextRequest(`http://localhost/api/x${qs}`), {
    params: Promise.resolve({ databaseId: db, rowId: ROW }),
  });

beforeEach(() => {
  h.scope = "ok";
  h.permission = "viewer";
  h.admin = false;
  h.list.mockReset();
  h.list.mockResolvedValue({ items: [], nextCursor: null });
});

describe("GET activity", () => {
  it("autre organisation et base inexistante : mêmes 404", async () => {
    h.scope = 404;
    const a = await call();
    const b = await call("", "not-a-uuid");
    expect(a.status).toBe(404);
    expect(b.status).toBe(404);
    expect(await a.json()).toEqual(await b.json());
    expect(h.list).not.toHaveBeenCalled();
  });

  it("viewer lit, limite par défaut 20", async () => {
    const res = await call();
    expect(res.status).toBe(200);
    expect(h.list.mock.calls[0][1]).toMatchObject({ databaseId: DB, rowId: ROW, orgId: "org1", limit: 20 });
  });

  it.each(["0", "51", "abc"])("limit=%s : 400", async (l) => {
    expect((await call(`?limit=${l}`)).status).toBe(400);
    expect(h.list).not.toHaveBeenCalled();
  });

  it("cursor=zzz : 400", async () => {
    h.list.mockRejectedValue(new InvalidHistoryCursorError());
    const res = await call("?cursor=zzz");
    expect(res.status).toBe(400);
  });

  it("réponse avec permission, viewerId, canClear", async () => {
    h.admin = true;
    h.list.mockResolvedValue({ items: [], nextCursor: "c" });
    const body = await (await call("?limit=50")).json();
    expect(body).toEqual({ items: [], nextCursor: "c", permission: "viewer", viewerId: "u1", canClear: true });
  });
});
