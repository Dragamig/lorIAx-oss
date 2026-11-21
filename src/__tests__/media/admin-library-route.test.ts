import { describe, it, expect, vi, beforeEach } from "vitest";

const h = vi.hoisted(() => ({
  user: { id: "u1", globalRole: "super_admin" } as unknown,
  settings: { trashRetentionDays: 30 },
  setSettings: vi.fn(),
  auditLog: vi.fn(),
  getSettingsFails: false,
}));

vi.mock("@/lib/auth/get-user", () => ({ getSessionUser: () => Promise.resolve(h.user) }));
vi.mock("@/lib/auth/require-org-scoped", () => {
  class OrgScopeError extends Error {
    response = new Response(null, { status: 404 });
  }
  return { OrgScopeError, requireOrgScoped: async () => ({ orgId: "org1" }) };
});
vi.mock("@/lib/rate-limit", () => ({ getClientIp: () => "203.0.113.4" }));
vi.mock("@/lib/audit/log", () => ({ auditLog: h.auditLog }));
vi.mock("@/lib/media/library-settings", () => {
  class LibrarySettingsError extends Error {}
  return {
    MIN_TRASH_RETENTION_DAYS: 7,
    MAX_TRASH_RETENTION_DAYS: 365,
    LibrarySettingsError,
    getLibrarySettings: async () => {
      if (h.getSettingsFails) throw new Error("db");
      return h.settings;
    },
    setLibrarySettings: h.setSettings,
  };
});
vi.mock("@/lib/media/quota", () => ({ getOrgStorageUsedBytes: async () => 500 }));
vi.mock("@/lib/media/list", () => ({
  getLibraryStats: async () => ({
    total: 12,
    trash: 3,
    orphan: 2,
    unused: 5,
    byTag: [{ id: "t", label: "secret-name" }],
    byFolder: { f: 1 },
  }),
}));

import { NextRequest } from "next/server";
import { registerHooks, resetHooksForTests } from "@/lib/modules/hooks";
import { beforeEach as hooksBeforeEach } from "vitest";
hooksBeforeEach(() => {
  resetHooksForTests();
  registerHooks({ usage: { checkUsersLimit: async () => { throw new Error('unused'); }, checkSpacesLimit: async () => { throw new Error('unused'); }, getOrgStorageLimitBytes: async (...a: unknown[]) => 1000 } });
});


const patch = async (body: unknown) => {
  const r = await import("@/app/api/admin/library/route");
  return r.PATCH(
    new NextRequest("http://x", { method: "PATCH", body: JSON.stringify(body), headers: { "content-type": "application/json" } })
  );
};
const get = async () => (await import("@/app/api/admin/library/route")).GET();

beforeEach(() => {
  vi.clearAllMocks();
  h.user = { id: "u1", globalRole: "super_admin" };
  h.settings = { trashRetentionDays: 30 };
  h.getSettingsFails = false;
  h.setSettings.mockImplementation(async (p: { trashRetentionDays: number }) => p);
});

describe("GET /api/admin/library", () => {
  it("401 sans session, 403 pour un non admin", async () => {
    h.user = null;
    expect((await get()).status).toBe(401);
    h.user = { id: "u1", globalRole: "user" };
    expect((await get()).status).toBe(403);
  });

  it("rend réglages, stockage et comptes, sans nom de média", async () => {
    h.user = { id: "u1", globalRole: "admin" };
    const res = await get();
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.settings).toEqual({ trashRetentionDays: 30 });
    expect(body.storage).toEqual({ usedBytes: 500, limitBytes: 1000, percent: 50 });
    expect(body.counts).toEqual({ media: 12, trash: 3, orphan: 2, unused: 5 });
    expect(body.canEdit).toBe(false);
    expect(JSON.stringify(body)).not.toContain("secret-name");
  });

  it("500 si les réglages sont illisibles (jamais de valeur par défaut présentée comme lue)", async () => {
    h.getSettingsFails = true;
    expect((await get()).status).toBe(500);
  });
});

describe("PATCH /api/admin/library", () => {
  it("403 pour un admin d'organisation (réglage d'instance)", async () => {
    h.user = { id: "u1", globalRole: "admin" };
    expect((await patch({ trashRetentionDays: 45 })).status).toBe(403);
    expect(h.setSettings).not.toHaveBeenCalled();
  });

  it("400 hors bornes, non entier, champ inconnu ou corps invalide", async () => {
    for (const body of [{ trashRetentionDays: 400 }, { trashRetentionDays: 5 }, { trashRetentionDays: 10.5 }, { trashRetentionDays: "45" }, {}, { trashRetentionDays: 45, quota: 1 }]) {
      expect((await patch(body)).status).toBe(400);
    }
    expect(h.setSettings).not.toHaveBeenCalled();
  });

  it("45 : écrit et journalise", async () => {
    const res = await patch({ trashRetentionDays: 45 });
    expect(res.status).toBe(200);
    expect((await res.json()).settings).toEqual({ trashRetentionDays: 45 });
    expect(h.setSettings).toHaveBeenCalledWith({ trashRetentionDays: 45 });
    expect(h.auditLog).toHaveBeenCalledWith(
      "media.settings",
      "u1",
      { previous: { trashRetentionDays: 30 }, next: { trashRetentionDays: 45 } },
      "203.0.113.4"
    );
  });

  it("500 si l'écriture échoue : aucun audit", async () => {
    h.setSettings.mockRejectedValueOnce(new Error("db"));
    expect((await patch({ trashRetentionDays: 45 })).status).toBe(500);
    expect(h.auditLog).not.toHaveBeenCalled();
  });
});
