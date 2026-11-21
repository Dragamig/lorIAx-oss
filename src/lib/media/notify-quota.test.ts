import { describe, it, expect, vi, beforeEach } from "vitest";

const h = vi.hoisted(() => ({
  sentinel: null as { tier: number } | null,
  admins: [] as { userId: string; locale: string | null }[],
  notifs: [] as Record<string, unknown>[],
  deleted: 0,
  used: 0,
  limit: 1000 as number | null,
}));
vi.mock("@/lib/media/quota", () => ({ getOrgStorageUsedBytes: async () => h.used }));

vi.mock("@/lib/logger", () => ({ default: { error: vi.fn(), info: vi.fn(), warn: vi.fn() } }));
vi.mock("@/lib/media/library-settings", () => ({
  getLibrarySettings: async () => ({ trashRetentionDays: 30 }),
}));
vi.mock("@/lib/notifications", () => ({
  createNotification: async (p: Record<string, unknown>) => {
    h.notifs.push(p);
  },
}));
vi.mock("@/lib/db", () => {
  const chain = () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const c: any = {};
    for (const k of ["from", "where", "innerJoin", "orderBy", "limit"]) c[k] = () => c;
    c.then = (res: (v: unknown) => unknown, rej?: (e: unknown) => unknown) =>
      Promise.resolve(h.admins).then(res, rej);
    return c;
  };
  return {
    db: {
      select: () => chain(),
      delete: () => ({
        where: () => {
          h.deleted += 1;
          h.sentinel = null;
          return Promise.resolve();
        },
      }),
      insert: () => ({
        values: (v: { value: { tier: number } }) => ({
          onConflictDoNothing: () => ({
            returning: async () => {
              if (h.sentinel) return [];
              h.sentinel = v.value;
              return [{ key: "k" }];
            },
          }),
        }),
      }),
      update: () => ({
        set: (s: { value: { tier: number } }) => ({
          where: () => ({
            returning: async () => {
              if (h.sentinel && h.sentinel.tier < s.value.tier) {
                h.sentinel = s.value;
                return [{ key: "k" }];
              }
              return [];
            },
          }),
        }),
      }),
    },
  };
});

import { notifyQuotaThreshold, refreshQuotaSentinel } from "@/lib/media/notify";
import { registerHooks, resetHooksForTests } from "@/lib/modules/hooks";
import { beforeEach as hooksBeforeEach } from "vitest";
hooksBeforeEach(() => {
  resetHooksForTests();
  registerHooks({ usage: { checkUsersLimit: async () => { throw new Error('unused'); }, checkSpacesLimit: async () => { throw new Error('unused'); }, getOrgStorageLimitBytes: async (...a: unknown[]) => h.limit } });
});


beforeEach(() => {
  h.sentinel = null;
  h.admins = [
    { userId: "a1", locale: "fr" },
    { userId: "a2", locale: "en" },
  ];
  h.notifs = [];
  h.deleted = 0;
  h.used = 0;
  h.limit = 1000;
});

describe("notifyQuotaThreshold", () => {
  it("79 vers 81 : une notification à chaque admin", async () => {
    await notifyQuotaThreshold("org", 79, 81);
    expect(h.notifs.map((n) => n.userId).sort()).toEqual(["a1", "a2"]);
    expect(h.notifs[0]).toMatchObject({ type: "media" });
  });

  it("81 vers 85 : aucune notification", async () => {
    await notifyQuotaThreshold("org", 79, 81);
    h.notifs = [];
    await notifyQuotaThreshold("org", 81, 85);
    expect(h.notifs).toHaveLength(0);
  });

  it("85 vers 100 : une notification (palier 100)", async () => {
    await notifyQuotaThreshold("org", 79, 81);
    h.notifs = [];
    await notifyQuotaThreshold("org", 85, 100);
    expect(h.notifs).toHaveLength(2);
    h.notifs = [];
    await notifyQuotaThreshold("org", 100, 100);
    expect(h.notifs).toHaveLength(0);
  });

  it("retour sous 75 % puis 81 % : de nouveau une notification", async () => {
    await notifyQuotaThreshold("org", 79, 81);
    await notifyQuotaThreshold("org", 81, 70);
    expect(h.sentinel).toBeNull();
    h.notifs = [];
    await notifyQuotaThreshold("org", 70, 81);
    expect(h.notifs).toHaveLength(2);
  });

  it("sous 80 % : rien", async () => {
    await notifyQuotaThreshold("org", 10, 50);
    expect(h.notifs).toHaveLength(0);
  });

  it("un échec de notification ne lève pas", async () => {
    h.admins = [{ userId: "a1", locale: "zz" }];
    await expect(notifyQuotaThreshold("org", 79, 81)).resolves.toBeUndefined();
  });

  it("sous 75 % : la sentinelle est supprimée même si l'état avant était déjà sous 75 %", async () => {
    h.sentinel = { tier: 80 };
    await notifyQuotaThreshold("org", 40, 50);
    expect(h.sentinel).toBeNull();
  });
});

describe("refreshQuotaSentinel", () => {
  it("usage sous 75 % après libération : sentinelle supprimée", async () => {
    h.sentinel = { tier: 80 };
    h.used = 500;
    await refreshQuotaSentinel("org");
    expect(h.sentinel).toBeNull();
  });

  it("usage encore à 80 % : sentinelle conservée", async () => {
    h.sentinel = { tier: 80 };
    h.used = 800;
    await refreshQuotaSentinel("org");
    expect(h.sentinel).toEqual({ tier: 80 });
  });

  it("sans limite : rien, et ne lève jamais", async () => {
    h.sentinel = { tier: 80 };
    h.limit = null;
    await expect(refreshQuotaSentinel("org")).resolves.toBeUndefined();
    expect(h.sentinel).toEqual({ tier: 80 });
  });
});
