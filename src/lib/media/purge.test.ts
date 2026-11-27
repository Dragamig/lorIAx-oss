import { describe, it, expect, vi, beforeEach } from "vitest";

const h = vi.hoisted(() => ({
  /** Sélections hors transaction (liste des lots). */
  selects: [] as unknown[],
  /** Sélections dans la transaction : verrou, usages, puis par clé (média partagé, alias). */
  txSelects: [] as unknown[],
  forArgs: [] as unknown[][],
  txDeletes: [] as unknown[],
  events: [] as string[],
  deleteFile: vi.fn(),
  audit: vi.fn(),
  activity: vi.fn(),
  full: vi.fn(),
  admin: vi.fn(),
  refresh: vi.fn(),
  warn: vi.fn(),
  txFails: false,
  retention: 30,
}));

function chain(queue: () => unknown[], recordFor = false) {
  const next = () => queue().shift() ?? [];
  const c: Record<string, unknown> = {};
  for (const k of ["from", "where", "orderBy"]) c[k] = () => c;
  c.limit = () => Promise.resolve(next());
  c.for = (...a: unknown[]) => {
    if (recordFor) h.forArgs.push(a);
    return Promise.resolve(next());
  };
  c.then = (res: (v: unknown) => unknown) => Promise.resolve(next()).then(res);
  return c;
}

vi.mock("@/lib/db", () => ({
  db: {
    select: () => chain(() => h.selects),
    transaction: async (fn: (tx: unknown) => Promise<unknown>) => {
      if (h.txFails) throw new Error("db down");
      const tx = {
        select: () => chain(() => h.txSelects, true),
        delete: (table: unknown) => ({
          where: () => {
            h.txDeletes.push(table);
            return Promise.resolve();
          },
        }),
      };
      const out = await fn(tx);
      h.events.push("commit");
      return out;
    },
  },
}));
vi.mock("@/lib/storage/s3", () => ({
  deleteFile: (k: string) => {
    h.events.push(`s3:${k}`);
    return h.deleteFile(k);
  },
}));
vi.mock("@/lib/logger", () => ({ default: { error: vi.fn(), info: vi.fn(), warn: (...a: unknown[]) => h.warn(...a) } }));
vi.mock("@/lib/audit/log", () => ({ auditLog: (...a: unknown[]) => h.audit(...a) }));
vi.mock("@/lib/activity", () => ({ logActivity: (a: unknown) => h.activity(a) }));
vi.mock("@/lib/media/access", () => ({
  getMediaFull: (id: string) => h.full(id),
  isOrgAdminOrOwner: (...a: unknown[]) => h.admin(...a),
}));
vi.mock("@/lib/media/library-settings", () => ({
  getTrashRetentionPolicy: () => Promise.resolve({ trashRetentionDays: h.retention, effectiveDays: h.retention }),
}));
vi.mock("@/lib/media/notify", () => ({ refreshQuotaSentinel: (...a: unknown[]) => h.refresh(...a) }));

import { media } from "@/lib/db/schema";
import { PurgeError, eraseMediaForever, purgeExpiredTrash } from "./purge";

const row = (id: string, over: Record<string, unknown> = {}) => ({
  id,
  organizationId: "org1",
  filename: `${id}.png`,
  sizeBytes: 10,
  storageKey: `k/${id}.png`,
  thumbnailKey: null,
  deletedAt: new Date("2026-01-01"),
  ...over,
});
const usages = (n: number) => [{ n }];
const none: unknown[] = [];
/** Séquence transactionnelle d'une ligne à une clé : verrou, usages, média partagé. */
const tx1 = (r: unknown, n = 0, versions: unknown[] = none) => [[r], usages(n), versions, none, none];
/** Sélections d'une clé non partagée : ni `media` ni `media_versions`. */
const free = [none, none];

beforeEach(() => {
  vi.clearAllMocks();
  h.selects = [];
  h.txSelects = [];
  h.forArgs = [];
  h.txDeletes = [];
  h.events = [];
  h.txFails = false;
  h.retention = 30;
  h.deleteFile.mockResolvedValue(undefined);
  h.admin.mockResolvedValue(true);
  h.refresh.mockResolvedValue(undefined);
});

describe("purgeExpiredTrash", () => {
  it("supprime la ligne media, puis l'objet S3 seulement après le commit", async () => {
    h.selects = [[row("a")]];
    h.txSelects = tx1(row("a"));
    const r = await purgeExpiredTrash();
    expect(r).toEqual({ purged: 1, versions: 0, skipped: 0, failed: [] });
    expect(h.txDeletes).toEqual([media]);
    expect(h.events).toEqual(["commit", "s3:k/a.png"]);
  });

  it("verrouille la ligne en SKIP LOCKED", async () => {
    h.selects = [[row("a")]];
    h.txSelects = tx1(row("a"));
    await purgeExpiredTrash();
    expect(h.forArgs).toEqual([["update", { skipLocked: true }]]);
  });

  it("restauration entre la sélection et la suppression : ligne et objet conservés", async () => {
    h.selects = [[row("a")]];
    h.txSelects = [[row("a", { deletedAt: null })]]; // la ligne verrouillée n'est plus en corbeille
    const r = await purgeExpiredTrash();
    expect(r).toEqual({ purged: 0, versions: 0, skipped: 1, failed: [] });
    expect(h.txDeletes).toEqual([]);
    expect(h.deleteFile).not.toHaveBeenCalled();
    expect(h.audit).not.toHaveBeenCalled();
  });

  it("ligne verrouillée ailleurs ou restaurée (verrou vide) : ignorée", async () => {
    h.selects = [[row("a")]];
    h.txSelects = [[]];
    const r = await purgeExpiredTrash();
    expect(r).toEqual({ purged: 0, versions: 0, skipped: 1, failed: [] });
    expect(h.txDeletes).toEqual([]);
    expect(h.deleteFile).not.toHaveBeenCalled();
  });

  it("remise à la corbeille récente entre-temps : échéance revérifiée sous verrou", async () => {
    h.selects = [[row("a")]];
    h.txSelects = [[row("a", { deletedAt: new Date() })]];
    const r = await purgeExpiredTrash({ now: new Date() });
    expect(r.skipped).toBe(1);
    expect(h.txDeletes).toEqual([]);
  });

  it("clé partagée par une autre ligne : objet conservé, ligne supprimée", async () => {
    h.selects = [[row("a")]];
    h.txSelects = [[row("a")], usages(0), none, [{ id: "b" }]];
    const r = await purgeExpiredTrash();
    expect(r.purged).toBe(1);
    expect(h.deleteFile).not.toHaveBeenCalled();
    expect(h.txDeletes).toEqual([media]);
  });

  it("clé de miniature partagée par une autre ligne (même à la corbeille) : objet conservé", async () => {
    h.selects = [[row("a", { thumbnailKey: "k/t.webp" })]];
    h.txSelects = [[row("a", { thumbnailKey: "k/t.webp" })], usages(0), none, ...free, [{ id: "b" }]];
    await purgeExpiredTrash();
    expect(h.deleteFile).toHaveBeenCalledTimes(1);
    expect(h.deleteFile).toHaveBeenCalledWith("k/a.png");
  });

  it("ne référence plus la table attachments", async () => {
    const src = (await import("node:fs")).readFileSync(new URL("./purge.ts", import.meta.url), "utf8");
    expect(src).not.toMatch(/attachments/);
  });

  it("échec S3 après commit : ligne supprimée, journalisé, ni failed ni exception", async () => {
    h.selects = [[row("a")]];
    h.txSelects = tx1(row("a"));
    h.deleteFile.mockRejectedValue(new Error("s3 down"));
    const r = await purgeExpiredTrash();
    expect(r).toEqual({ purged: 1, versions: 0, skipped: 0, failed: [] });
    expect(h.warn).toHaveBeenCalled();
  });

  it("échec de la transaction : listé dans failed, aucun objet supprimé", async () => {
    h.selects = [[row("a")]];
    h.txFails = true;
    const r = await purgeExpiredTrash();
    expect(r.failed).toEqual([{ id: "a", error: "db down" }]);
    expect(h.deleteFile).not.toHaveBeenCalled();
  });

  it("média encore utilisé : purgé quand même, audit sans contenu", async () => {
    h.selects = [[row("a")]];
    h.txSelects = tx1(row("a"), 3);
    await purgeExpiredTrash();
    expect(h.audit).toHaveBeenCalledWith("media.purge", null, {
      mediaId: "a",
      filename: "a.png",
      sizeBytes: 10,
      usages: 3,
      versions: 0,
    });
  });

  it("réarme la sentinelle de quota de l'organisation après la purge", async () => {
    h.selects = [[row("a")]];
    h.txSelects = tx1(row("a"));
    await purgeExpiredTrash();
    expect(h.refresh).toHaveBeenCalledWith("org1");
  });

  it("par lots : enchaîne tant que le lot est plein", async () => {
    h.selects = [[row("a"), row("b")], [row("c")]];
    h.txSelects = [...tx1(row("a")), ...tx1(row("b")), ...tx1(row("c"))];
    const r = await purgeExpiredTrash({ batch: 2 });
    expect(r.purged).toBe(3);
  });
});

describe("eraseMediaForever", () => {
  const admin = { id: "u1" } as never;

  it("éditeur : 403 et aucun deleteFile", async () => {
    h.full.mockResolvedValue(row("a"));
    h.admin.mockResolvedValue(false);
    await expect(eraseMediaForever(admin, "org1", "a")).rejects.toMatchObject({ status: 403 });
    expect(h.deleteFile).not.toHaveBeenCalled();
  });

  it("admin d'une autre organisation : 404", async () => {
    h.full.mockResolvedValue(row("a", { organizationId: "org2" }));
    await expect(eraseMediaForever(admin, "org1", "a")).rejects.toBeInstanceOf(PurgeError);
    await expect(eraseMediaForever(admin, "org1", "a")).rejects.toMatchObject({ status: 404 });
    expect(h.deleteFile).not.toHaveBeenCalled();
  });

  it("média inconnu : 404", async () => {
    h.full.mockResolvedValue(null);
    await expect(eraseMediaForever(admin, "org1", "a")).rejects.toMatchObject({ status: 404 });
  });

  it("supprimé entre-temps (verrou vide) : 404, rien d'écrit", async () => {
    h.full.mockResolvedValue(row("a"));
    h.txSelects = [[]];
    await expect(eraseMediaForever(admin, "org1", "a")).rejects.toMatchObject({ status: 404 });
    expect(h.deleteFile).not.toHaveBeenCalled();
    expect(h.audit).not.toHaveBeenCalled();
  });

  it("admin : efface hors corbeille sous FOR UPDATE, audit, activité et sentinelle", async () => {
    h.full.mockResolvedValue(row("a", { deletedAt: null }));
    h.txSelects = tx1(row("a", { deletedAt: null }), 2);
    await eraseMediaForever(admin, "org1", "a");
    expect(h.forArgs).toEqual([["update"]]);
    expect(h.events).toEqual(["commit", "s3:k/a.png"]);
    expect(h.txDeletes).toEqual([media]);
    expect(h.audit).toHaveBeenCalledWith(
      "media.erase",
      "u1",
      expect.objectContaining({ mediaId: "a", usages: 2, wasTrashed: false })
    );
    expect(h.activity).toHaveBeenCalledWith(expect.objectContaining({ action: "media.erased", entityId: "a" }));
    expect(h.refresh).toHaveBeenCalledWith("org1");
  });

  it("échec S3 : ligne supprimée quand même, erreur journalisée seulement", async () => {
    h.full.mockResolvedValue(row("a"));
    h.txSelects = tx1(row("a"));
    h.deleteFile.mockRejectedValue(new Error("s3 down"));
    await expect(eraseMediaForever(admin, "org1", "a")).resolves.toBeUndefined();
    expect(h.warn).toHaveBeenCalled();
  });
});

describe("versions", () => {
  const vs = [
    { storageKey: "k/a.png", thumbnailKey: null },
    { storageKey: "k/a2.png", thumbnailKey: "k/a2.png.thumb.webp" },
    { storageKey: "k/a3.png", thumbnailKey: null },
  ];

  it("purge d'un média de 3 versions : tous les objets (et vignettes) supprimés après commit", async () => {
    h.selects = [[row("a")]];
    h.txSelects = [[row("a")], usages(0), vs, ...free, ...free, ...free, ...free];
    const r = await purgeExpiredTrash();
    expect(r).toEqual({ purged: 1, versions: 3, skipped: 0, failed: [] });
    expect(h.deleteFile.mock.calls.map((c) => c[0]).sort()).toEqual(
      ["k/a.png", "k/a2.png", "k/a2.png.thumb.webp", "k/a3.png"].sort()
    );
    expect(h.events[0]).toBe("commit");
    expect(h.audit).toHaveBeenCalledWith("media.purge", null, expect.objectContaining({ versions: 3 }));
  });

  it("effacement définitif : mêmes objets", async () => {
    h.full.mockResolvedValue(row("a"));
    h.txSelects = [[row("a")], usages(0), vs, ...free, ...free, ...free, ...free];
    await eraseMediaForever({ id: "u1" } as never, "org1", "a");
    expect(h.deleteFile).toHaveBeenCalledTimes(4);
    expect(h.audit).toHaveBeenCalledWith("media.erase", "u1", expect.objectContaining({ versions: 3 }));
  });

  it("clé de version partagée par la version d'un autre média : objet conservé", async () => {
    h.selects = [[row("a")]];
    // k/a.png libre ; k/a2.png libre côté media mais portée par une version d'un autre média
    h.txSelects = [[row("a")], usages(0), vs.slice(0, 2), ...free, none, [{ id: "vx" }], ...free];
    await purgeExpiredTrash();
    const deleted = h.deleteFile.mock.calls.map((c) => c[0]);
    expect(deleted).not.toContain("k/a2.png");
    expect(deleted).toContain("k/a.png");
    expect(deleted).toContain("k/a2.png.thumb.webp");
  });

  it("la restauration avant J+30 garde toutes les versions : aucune suppression", async () => {
    h.selects = [[row("a")]];
    h.txSelects = [[row("a", { deletedAt: null })]];
    await purgeExpiredTrash();
    expect(h.txDeletes).toEqual([]);
    expect(h.deleteFile).not.toHaveBeenCalled();
  });
});
