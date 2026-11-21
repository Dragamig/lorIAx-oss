/**
 * H10 : un changement de rôle ou une suppression de compte doit couper les
 * sessions de la cible (borne `tokenInvalidatedAt` et cache d'état purgé), et
 * la révocation d'une clé d'API doit faire répondre 401 au porteur.
 * Il n'existe pas de désactivation de compte dans cette édition : le seul
 * équivalent est la suppression, couverte ici.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

const state = vi.hoisted(() => ({
  updates: [] as Record<string, unknown>[],
  keyRow: [] as unknown[],
}));

const clearCache = vi.hoisted(() => vi.fn());

vi.mock("@/lib/db", () => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const self: any = {
    update: vi.fn(() => self),
    set: vi.fn((v: Record<string, unknown>) => {
      state.updates.push(v);
      return self;
    }),
    where: vi.fn(() => self),
    select: vi.fn(() => self),
    from: vi.fn(() => self),
    innerJoin: vi.fn(() => self),
    limit: vi.fn(async () => state.keyRow),
    execute: vi.fn(async () => undefined),
    delete: vi.fn(() => self),
    transaction: async (fn: (tx: unknown) => Promise<void>) => fn(self),
  };
  return { db: self };
});
vi.mock("@/lib/auth", () => ({ clearAuthUserStateCache: clearCache }));
vi.mock("@/lib/auth/get-user", () => ({ getSessionUser: async () => ({ id: "admin", globalRole: "super_admin" }) }));
vi.mock("@/lib/auth/rbac", () => ({ hasGlobalRole: () => true }));
vi.mock("@/lib/org/get-request-org", () => ({ getRequestOrgId: async () => "org" }));
vi.mock("@/lib/org/org-members", () => ({ getOrgMemberIds: async () => ["victim"] }));
vi.mock("@/lib/databases/view-cleanup", () => ({ deletePersonalViewsOf: vi.fn() }));
vi.mock("@/lib/email/send", () => ({ sendEmail: vi.fn() }));
vi.mock("@/lib/git/repository", () => ({ initRepository: vi.fn() }));
vi.mock("@/lib/calendar/auto-provision", () => ({ ensurePersonalCalendar: vi.fn() }));
vi.mock("@/lib/logger", () => ({
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

import { PATCH, DELETE } from "@/app/api/admin/users/route";
import { resolveApiKey } from "@/lib/auth/api-key";

const req = (method: string, body: unknown) =>
  new NextRequest("http://x/api/admin/users", { method, body: JSON.stringify(body) });

beforeEach(() => {
  state.updates = [];
  state.keyRow = [];
  clearCache.mockClear();
});

describe("révocation de session par l'administration", () => {
  it("role_change_sets_token_invalidated_at", async () => {
    const before = Date.now();
    const res = await PATCH(req("PATCH", { id: "victim", globalRole: "viewer" }));
    expect(res.status).toBe(200);
    const stamp = state.updates.find((u) => "tokenInvalidatedAt" in u);
    expect(stamp).toBeDefined();
    expect((stamp!.tokenInvalidatedAt as Date).getTime()).toBeGreaterThanOrEqual(before);
    expect(clearCache).toHaveBeenCalledWith("victim");
  });

  it("un renommage seul ne coupe pas les sessions", async () => {
    await PATCH(req("PATCH", { id: "victim", name: "Nouveau nom" }));
    expect(state.updates.some((u) => "tokenInvalidatedAt" in u)).toBe(false);
  });

  it("deactivation_and_deletion_invalidate_sessions : la suppression purge l'état de session", async () => {
    const res = await DELETE(req("DELETE", { id: "victim" }));
    expect(res.status).toBe(200);
    expect(clearCache).toHaveBeenCalledWith("victim");
  });

  it("une clé lrx_ révoquée n'est plus résolue (401 côté API)", async () => {
    state.keyRow = [{ keyId: "k", userId: "victim", revokedAt: new Date(), expiresAt: null }];
    expect(await resolveApiKey("lrx_ancienne")).toBeNull();
  });
});
