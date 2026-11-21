import { beforeEach, describe, expect, it, vi } from "vitest";

const NOW = new Date("2026-11-20T12:00:00Z");
const ago = (days: number) => new Date(NOW.getTime() - days * 86_400_000);

const h = vi.hoisted(() => ({
  rows: [] as { id: string; organizationId: string; updatedAt: Date; filename: string; origin: string; deletedAt: Date | null }[],
  used: new Set<string>(),
  updates: [] as { set: Record<string, unknown> }[],
  deleted: [] as string[],
  calls: 0,
  lastIds: [] as string[],
  health: { lagging: [] as string[], documentsWatermark: new Date("2026-11-20T11:00:00Z") },
  audit: [] as unknown[][],
}));

vi.mock("./usage-sweep", () => ({ getSweepHealth: async () => h.health }));
vi.mock("@/lib/audit/log", () => ({ auditLog: (...a: unknown[]) => h.audit.push(a) }));
vi.mock("@/lib/logger", () => ({ default: { warn: vi.fn(), error: vi.fn(), info: vi.fn() } }));

// Simule la requête : seules les lignes éligibles (studio, nom réservé, hors corbeille) sont rendues,
// le filtrage d'âge et d'usage restant à la charge du code testé.
vi.mock("@/lib/db", () => ({
  db: {
    select: (cols: Record<string, unknown>) => ({
      from: () => ({
        where: () => {
          if ("organizationId" in cols) {
            return {
              orderBy: () => ({
                limit: async () => {
                  h.calls += 1;
                  return h.calls > 1
                    ? []
                    : h.rows.filter((r) => r.origin === "studio" && r.filename === "Miniature de design" && !r.deletedAt);
                },
              }),
            };
          }
          return Promise.resolve([...h.used].map((mediaId) => ({ mediaId })));
        },
      }),
    }),
    update: () => ({
      set: (set: Record<string, unknown>) => ({
        where: () => ({
          returning: async () => {
            h.updates.push({ set });
            return h.rows.filter((r) => h.lastIds.includes(r.id)).map((r) => ({ id: r.id }));
          },
        }),
      }),
    }),
  },
}));
vi.mock("drizzle-orm", async (orig) => {
  const m = await orig<typeof import("drizzle-orm")>();
  return {
    ...m,
    inArray: (_c: unknown, ids: string[]) => {
      h.lastIds = ids;
      return m.sql`1=1`;
    },
  };
});

import { thumbnailBarrier, trashStaleDesignThumbnails } from "./stale-thumbnails";


const row = (id: string, days: number, extra: Partial<(typeof h.rows)[number]> = {}) => ({
  id, organizationId: "org1", updatedAt: ago(days), filename: "Miniature de design", origin: "studio", deletedAt: null, ...extra,
});

beforeEach(() => {
  h.rows = [];
  h.used = new Set();
  h.updates = [];
  h.calls = 0;
  h.lastIds = [];
  h.health = { lagging: [], documentsWatermark: new Date("2026-11-20T11:00:00Z") };
  h.audit = [];
});

describe("trashStaleDesignThumbnails", () => {
  it("sans usage depuis 8 jours : mise à la corbeille, sans suppression", async () => {
    h.rows = [row("a", 8)];
    expect(await trashStaleDesignThumbnails(NOW)).toEqual({ trashed: 1 });
    expect(h.updates[0].set).toMatchObject({ deletedAt: NOW });
  });
  it("sans usage depuis 6 jours : gardée", async () => {
    h.rows = [row("a", 6)];
    expect(await trashStaleDesignThumbnails(NOW)).toEqual({ trashed: 0 });
    expect(h.updates).toHaveLength(0);
  });
  it("utilisée : jamais retirée, même ancienne", async () => {
    h.rows = [row("a", 90)];
    h.used = new Set(["a"]);
    expect(await trashStaleDesignThumbnails(NOW)).toEqual({ trashed: 0 });
    expect(h.updates).toHaveLength(0);
  });
  it("média non miniature : intact", async () => {
    h.rows = [row("a", 30, { filename: "photo.jpg" }), row("b", 30, { origin: "upload" })];
    expect(await trashStaleDesignThumbnails(NOW)).toEqual({ trashed: 0 });
  });
  it("une mise à jour par organisation, ids jamais mélangés", async () => {
    h.rows = [row("a", 9), row("b", 9, { organizationId: "org2" })];
    await trashStaleDesignThumbnails(NOW);
    expect(h.updates).toHaveLength(2);
  });
  it("balayage en retard ou en échec : rien n'est ramassé, aucune requête", async () => {
    h.rows = [row("a", 30)];
    h.health = { ...h.health, lagging: ["documents"] };
    expect(await trashStaleDesignThumbnails(NOW)).toEqual({ trashed: 0, skipped: "sweep-lagging" });
    expect(h.calls).toBe(0);
    expect(h.updates).toHaveLength(0);
  });
  it("ramassage journalisé par organisation", async () => {
    h.rows = [row("a", 9)];
    await trashStaleDesignThumbnails(NOW);
    expect(h.audit).toHaveLength(1);
    expect(h.audit[0][0]).toBe("media.thumbnail_trashed");
    expect(h.audit[0][2]).toMatchObject({ organizationId: "org1", count: 1, mediaIds: ["a"] });
  });
  it("filigrane des documents en retard : candidat plus récent que le filigrane écarté", async () => {
    // filigrane il y a 10 jours, miniature de 8 jours : postérieure au filigrane, donc gardée
    h.health = { ...h.health, documentsWatermark: ago(10) };
    h.rows = [row("a", 8)];
    expect(await trashStaleDesignThumbnails(NOW)).toEqual({ trashed: 0 });
  });
});

describe("thumbnailBarrier", () => {
  it("prend la plus ancienne des deux bornes", () => {
    expect(thumbnailBarrier(ago(7), ago(10))).toEqual(ago(10));
    expect(thumbnailBarrier(ago(7), ago(1))).toEqual(ago(7));
  });
});
