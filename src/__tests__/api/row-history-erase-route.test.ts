import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

const h = vi.hoisted(() => ({ denied: null as null | 404 | 403, admin: false }));

vi.mock("@/lib/auth/require-org-scoped", () => {
  class OrgScopeError extends Error {
    constructor(public response: Response) {
      super("scope");
    }
  }
  return {
    OrgScopeError,
    requireOrgScoped: vi.fn(async () => {
      if (h.denied) {
        throw new OrgScopeError(
          new Response(JSON.stringify({ error: h.denied === 404 ? "Introuvable" : "Accès refusé" }), { status: h.denied })
        );
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
  return { ...actual, eraseRowHistory: vi.fn(async () => ({ erased: 3, comments: 2, tasks: 1, taskEvents: 4 })) };
});

import { DELETE } from "@/app/api/databases/[databaseId]/rows/[rowId]/history/route";
import { eraseRowHistory } from "@/lib/databases/row-history-read";

const DB = "11111111-1111-4111-8111-111111111111";
const ROW = "22222222-2222-4222-8222-222222222222";

function call(ids = { databaseId: DB, rowId: ROW }) {
  return DELETE(
    new NextRequest(`http://localhost/api/databases/${ids.databaseId}/rows/${ids.rowId}/history`, { method: "DELETE" }),
    { params: Promise.resolve(ids) }
  );
}

beforeEach(() => {
  h.denied = null;
  h.admin = false;
  vi.mocked(eraseRowHistory).mockClear();
});

describe("DELETE row history", () => {
  it("autre organisation : 404 sans suppression", async () => {
    h.denied = 404;
    h.admin = true;
    const res = await call();
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: "Introuvable" });
    expect(eraseRowHistory).not.toHaveBeenCalled();
  });

  it("sans permission sur la base : 404 identique", async () => {
    h.denied = 403;
    const res = await call();
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: "Introuvable" });
    expect(eraseRowHistory).not.toHaveBeenCalled();
  });

  it("membre non admin : 403 sans suppression", async () => {
    const res = await call();
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: "Accès refusé" });
    expect(eraseRowHistory).not.toHaveBeenCalled();
  });

  it("admin : 200 JSON et eraseRowHistory appelé avec databaseId, rowId, userId", async () => {
    h.admin = true;
    const res = await call();
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ erased: 3, comments: 2, tasks: 1, taskEvents: 4 });
    expect(eraseRowHistory).toHaveBeenCalledWith({}, { databaseId: DB, rowId: ROW, userId: "u1" });
  });

  it("rowId non uuid : 404", async () => {
    h.admin = true;
    const res = await call({ databaseId: DB, rowId: "nope" });
    expect(res.status).toBe(404);
    expect(eraseRowHistory).not.toHaveBeenCalled();
  });

  it("base inexistante : 404", async () => {
    h.denied = 404;
    const res = await call();
    expect(res.status).toBe(404);
  });
});
