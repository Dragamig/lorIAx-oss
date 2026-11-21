import { describe, it, expect, vi, beforeEach } from "vitest";

const h = vi.hoisted(() => ({ calls: [] as unknown[][], i: 0 }));

vi.mock("@/lib/auth/rbac", () => ({
  hasGlobalRole: (role: string, min: string) =>
    min === "super_admin" ? role === "super_admin" : true,
}));
vi.mock("@/lib/db", () => ({
  db: {
    select: vi.fn(() => {
      const rows = h.calls[h.i] ?? [];
      h.i += 1;
      return {
        from: vi.fn().mockReturnThis(),
        where: vi.fn().mockReturnThis(),
        limit: vi.fn().mockResolvedValue(rows),
      };
    }),
  },
}));

import { resolveOrgAdmin } from "@/lib/org/require-org-admin";

function queue(...c: unknown[][]) {
  h.calls = c;
  h.i = 0;
}
beforeEach(() => {
  vi.clearAllMocks();
  queue();
});

const USER = { id: "u1", globalRole: "editor" } as never;
const SUPER = { id: "s1", globalRole: "super_admin" } as never;

describe("resolveOrgAdmin", () => {
  it("null si org introuvable", async () => {
    queue([]);
    expect(await resolveOrgAdmin(USER, "ghost")).toBeNull();
  });
  it("autorise un super_admin sans vérifier le membership", async () => {
    queue([{ id: "org-1" }]);
    expect(await resolveOrgAdmin(SUPER, "acme")).toEqual({
      orgId: "org-1",
      callerRole: "super_admin",
    });
  });
  it("autorise un owner d'org", async () => {
    queue([{ id: "org-1" }], [{ role: "owner" }]);
    expect(await resolveOrgAdmin(USER, "acme")).toEqual({
      orgId: "org-1",
      callerRole: "owner",
    });
  });
  it("autorise un admin d'org", async () => {
    queue([{ id: "org-1" }], [{ role: "admin" }]);
    expect(await resolveOrgAdmin(USER, "acme")).toEqual({
      orgId: "org-1",
      callerRole: "admin",
    });
  });
  it("refuse un simple member", async () => {
    queue([{ id: "org-1" }], [{ role: "member" }]);
    expect(await resolveOrgAdmin(USER, "acme")).toBeNull();
  });
});
