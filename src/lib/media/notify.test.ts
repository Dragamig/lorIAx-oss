import { describe, it, expect, vi, beforeEach } from "vitest";

const h = vi.hoisted(() => ({
  selects: [] as unknown[],
  inserted: [] as unknown[][],
  insertReturn: [] as unknown[],
  notifs: [] as Record<string, unknown>[],
  retention: 30,
  policy: null as null | { previousDays: number; noticeEndsAt: Date },
  deletes: 0,
  notifyFails: false,
}));

vi.mock("@/lib/logger", () => ({ default: { error: vi.fn(), info: vi.fn(), warn: vi.fn() } }));
vi.mock("@/lib/media/library-settings", () => ({
  getTrashRetentionPolicy: async () => ({
    trashRetentionDays: h.retention,
    effectiveDays: h.policy ? Math.max(h.retention, h.policy.previousDays) : h.retention,
    previousDays: h.policy?.previousDays ?? null,
    noticeEndsAt: h.policy?.noticeEndsAt ?? null,
  }),
}));
vi.mock("@/lib/notifications", () => ({
  createNotification: async (p: Record<string, unknown>) => {
    if (h.notifyFails) throw new Error("smtp");
    h.notifs.push(p);
  },
}));
vi.mock("@/lib/db", () => {
  const chain = () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const c: any = {};
    for (const k of ["from", "where", "orderBy"]) c[k] = () => c;
    const next = async () => h.selects.shift() ?? [];
    c.limit = () => next();
    c.then = (res: (v: unknown) => unknown, rej?: (e: unknown) => unknown) => next().then(res, rej);
    return c;
  };
  return {
    db: {
      select: () => chain(),
      delete: () => ({ where: () => { h.deletes += 1; return Promise.resolve(); } }),
      insert: () => ({
        values: (v: unknown[]) => ({
          onConflictDoNothing: () => ({
            returning: async () => {
              h.inserted.push(v);
              // Renvoie seulement les clés "nouvelles" déclarées par le test.
              const fresh = new Set(h.insertReturn as string[]);
              return v.filter((r) => fresh.has((r as { key: string }).key)).map((r) => ({ key: (r as { key: string }).key }));
            },
          }),
        }),
      }),
    },
  };
});

import { notifyTrashNearPurge, trashSentinelKey } from "@/lib/media/notify";

const DAY = 86_400_000;
const NOW = new Date("2026-11-15T04:00:00Z");
const ago = (d: number) => new Date(NOW.getTime() - d * DAY);

function row(id: string, by: string, days: number) {
  return { id, deletedBy: by, deletedAt: ago(days) };
}

beforeEach(() => {
  h.selects = [];
  h.inserted = [];
  h.insertReturn = [];
  h.notifs = [];
  h.retention = 30;
  h.policy = null;
  h.deletes = 0;
  h.notifyFails = false;
});

describe("notifyTrashNearPurge", () => {
  it("une seule notification groupée par auteur pour trois médias à J-6", async () => {
    const rows = [row("m1", "u1", 24), row("m2", "u1", 24), row("m3", "u1", 24)];
    h.selects = [rows, [{ locale: "fr" }]];
    h.insertReturn = rows.map((r) => trashSentinelKey(r.id, r.deletedAt, 30));
    const r = await notifyTrashNearPurge(NOW);
    expect(r.notified).toBe(1);
    expect(h.notifs).toHaveLength(1);
    expect(h.notifs[0]).toMatchObject({ userId: "u1", type: "media" });
    expect(String(h.notifs[0].message)).toContain("3");
    expect(String(h.notifs[0].message)).toContain("6");
  });

  it("un second passage n'envoie rien (sentinelles déjà posées)", async () => {
    h.selects = [[row("m1", "u1", 24)]];
    h.insertReturn = [];
    const r = await notifyTrashNearPurge(NOW);
    expect(r.notified).toBe(0);
    expect(h.notifs).toHaveLength(0);
  });

  it("deux auteurs : deux notifications", async () => {
    const rows = [row("m1", "u1", 25), row("m2", "u2", 25)];
    h.selects = [rows, [{ locale: "fr" }], [{ locale: "en" }]];
    h.insertReturn = rows.map((r) => trashSentinelKey(r.id, r.deletedAt, 30));
    const r = await notifyTrashNearPurge(NOW);
    expect(r.notified).toBe(2);
    expect(h.notifs.map((n) => n.userId).sort()).toEqual(["u1", "u2"]);
  });

  it("rien à notifier : aucune écriture", async () => {
    h.selects = [[]];
    const r = await notifyTrashNearPurge(NOW);
    expect(r.notified).toBe(0);
    expect(h.inserted).toHaveLength(0);
  });

  it("la clé de sentinelle change quand le média est remis puis re-mis en corbeille", () => {
    expect(trashSentinelKey("m1", ago(24), 30)).not.toBe(trashSentinelKey("m1", ago(2), 30));
  });

  it("le délai de rétention fait partie de la clé de sentinelle", () => {
    expect(trashSentinelKey("m1", ago(24), 30)).not.toBe(trashSentinelKey("m1", ago(24), 10));
  });

  it("échec d'envoi : les sentinelles de l'auteur sont supprimées pour permettre un nouvel essai", async () => {
    const rows = [row("m1", "u1", 24)];
    h.selects = [rows, [{ locale: "fr" }]];
    h.insertReturn = rows.map((r) => trashSentinelKey(r.id, r.deletedAt, 30));
    h.notifyFails = true;
    const before = h.deletes;
    const r = await notifyTrashNearPurge(NOW);
    expect(r.notified).toBe(0);
    // une suppression de sentinelles échouées, plus le nettoyage périodique
    expect(h.deletes - before).toBeGreaterThanOrEqual(2);
  });

  it("préavis de réduction : le jour restant suit la date de purge réelle", async () => {
    h.retention = 10;
    h.policy = { previousDays: 30, noticeEndsAt: new Date(NOW.getTime() + 4 * DAY) };
    const rows = [row("m1", "u1", 20)]; // 10 j nominal mais purgé à la fin du préavis : J-4
    h.selects = [rows, [{ locale: "fr" }]];
    h.insertReturn = rows.map((r) => trashSentinelKey(r.id, r.deletedAt, 10));
    await notifyTrashNearPurge(NOW);
    expect(String(h.notifs[0].message)).toContain("4");
  });
});
