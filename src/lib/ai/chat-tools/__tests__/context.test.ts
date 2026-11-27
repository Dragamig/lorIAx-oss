import { describe, it, expect, vi, beforeEach } from "vitest";
import type { NextRequest } from "next/server";

const requireOrgScoped = vi.fn();
const dbLimit = vi.fn();

vi.mock("@/lib/auth/require-org-scoped", () => {
  class OrgScopeError extends Error {
    constructor(public response: unknown, public reason: string) {
      super(reason);
    }
  }
  return { requireOrgScoped: (...a: unknown[]) => requireOrgScoped(...a), OrgScopeError };
});
vi.mock("@/lib/db", () => ({
  db: {
    select: () => ({ from: () => ({ where: () => ({ limit: () => dbLimit() }) }) }),
  },
}));
vi.mock("@/lib/db/schema", () => ({
  userDatabases: { id: "id", archivedAt: "archivedAt", deletedAt: "deletedAt" },
}));

import { requireDatabaseAccess, ToolAccessError, type ChatToolContext } from "../context";
import { OrgScopeError } from "@/lib/auth/require-org-scoped";

const req = {} as NextRequest;
const ctx = { user: { id: "u1" }, orgId: "org1", spaceIds: ["s1"], admin: false, req } as unknown as ChatToolContext;

beforeEach(() => {
  requireOrgScoped.mockReset();
  dbLimit.mockReset();
  dbLimit.mockResolvedValue([{ id: "db1" }]);
});

async function code(p: Promise<unknown>) {
  try {
    await p;
  } catch (e) {
    expect(e).toBeInstanceOf(ToolAccessError);
    return { code: (e as ToolAccessError).code, message: (e as Error).message };
  }
  throw new Error("no throw");
}

describe("requireDatabaseAccess", () => {
  it("accepte une base de la même organisation en viewer et passe req", async () => {
    requireOrgScoped.mockResolvedValue({ orgId: "org1", spaceId: "s1", permission: "viewer" });
    await expect(requireDatabaseAccess(ctx, "db1", "viewer")).resolves.toEqual({
      databaseId: "db1",
      spaceId: "s1",
    });
    expect(requireOrgScoped).toHaveBeenCalledWith(
      { resource: { type: "database", id: "db1" }, minPermission: "viewer" },
      req,
      { user: ctx.user, orgId: "org1" },
    );
  });

  it("OrgScopeError devient not_found", async () => {
    requireOrgScoped.mockRejectedValue(new OrgScopeError({} as never, "permission-denied"));
    expect((await code(requireDatabaseAccess(ctx, "db1", "viewer"))).code).toBe("not_found");
  });

  it("autre organisation (super_admin) : not_found", async () => {
    requireOrgScoped.mockResolvedValue({ orgId: "org2", spaceId: "s9", permission: "admin" });
    expect((await code(requireDatabaseAccess({ ...ctx, admin: true }, "db1", "viewer"))).code).toBe("not_found");
  });

  it("editor requis avec viewer : forbidden", async () => {
    requireOrgScoped.mockResolvedValue({ orgId: "org1", spaceId: "s1", permission: "viewer" });
    expect((await code(requireDatabaseAccess(ctx, "db1", "editor"))).code).toBe("forbidden");
  });

  it("base archivée ou supprimée : not_found", async () => {
    requireOrgScoped.mockResolvedValue({ orgId: "org1", spaceId: "s1", permission: "editor" });
    dbLimit.mockResolvedValue([]);
    expect((await code(requireDatabaseAccess(ctx, "db1", "viewer"))).code).toBe("not_found");
  });

  it("message identique pour inexistante et autre organisation", async () => {
    requireOrgScoped.mockRejectedValue(new OrgScopeError({} as never, "resource-not-found"));
    const a = await code(requireDatabaseAccess(ctx, "x", "viewer"));
    requireOrgScoped.mockResolvedValue({ orgId: "org2", spaceId: "s9", permission: "admin" });
    const b = await code(requireDatabaseAccess(ctx, "x", "viewer"));
    expect(a.message).toBe(b.message);
    expect(a.message).toBe("Base introuvable ou accès refusé");
  });
});
