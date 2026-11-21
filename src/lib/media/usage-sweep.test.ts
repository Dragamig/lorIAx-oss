import { describe, it, expect, vi, beforeEach } from "vitest";

const h = vi.hoisted(() => ({
  selects: [] as unknown[],
  upserts: [] as unknown[],
  deletes: 0,
  gate: null as null | Promise<void>,
}));

vi.mock("@/lib/logger", () => ({ default: { error: vi.fn(), info: vi.fn(), warn: vi.fn() } }));

vi.mock("@/lib/db", () => {
  const chain = () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const c: any = {};
    for (const k of ["from", "where", "innerJoin", "orderBy"]) c[k] = () => c;
    const next = async () => {
      const r = h.selects.shift();
      if (r instanceof Error) throw r;
      return r ?? [];
    };
    c.limit = () => next();
    c.then = (res: (v: unknown) => unknown, rej?: (e: unknown) => unknown) => next().then(res, rej);
    return c;
  };
  return {
    db: {
      select: () => chain(),
      insert: () => ({
        values: (v: unknown) => ({
          onConflictDoUpdate: () => {
            h.upserts.push(v);
            return Promise.resolve();
          },
        }),
      }),
      delete: () => ({
        where: () => {
          h.deletes += 1;
          return Promise.resolve();
        },
      }),
    },
  };
});

const syncContentUsages = vi.fn(async (..._a: unknown[]) => {
  if (h.gate) await h.gate;
  return { added: 0, removed: 0, ignored: 0 };
});
vi.mock("./usages", async () => {
  const actual = await vi.importActual<typeof import("./usages")>("./usages");
  return { ...actual, syncContentUsages: (...a: unknown[]) => syncContentUsages(...a) };
});

import { runMediaUsageSweep } from "./usage-sweep";

const ORG = "11111111-1111-4111-8111-111111111111";
const SPACE = "22222222-2222-4222-8222-222222222222";
const MID = "3f2a1b4c-5d6e-4f70-8a9b-0c1d2e3f4a5b";
const NOW = new Date("2026-11-14T12:00:00Z");
const ts = (s: number) => new Date(NOW.getTime() - 60_000 + s * 1000);

const doc = (id: string, s: number, text = "") => ({
  id,
  updatedAt: ts(s),
  organizationId: ORG,
  spaceId: SPACE,
  payload: text,
});

/** Ordre des lectures : filigrane, documents, lignes, vidéos, kits. */
function queue(...sources: unknown[]) {
  h.selects = [[], ...sources];
}

beforeEach(() => {
  h.selects = [];
  h.upserts = [];
  h.deletes = 0;
  h.gate = null;
  syncContentUsages.mockClear();
});

describe("runMediaUsageSweep", () => {
  it("traite un document modifié et avance le filigrane", async () => {
    queue([doc("d1", 1, `![a](/api/media/${MID})`)], [], [], []);
    const r = await runMediaUsageSweep({ now: NOW });
    expect(r).toMatchObject({ documents: 1, rows: 0, videos: 0, brandKits: 0, hasMore: false });
    const [target, refs] = syncContentUsages.mock.calls[0] as [Record<string, unknown>, unknown];
    expect(target).toMatchObject({ targetType: "document", targetId: "d1", organizationId: ORG });
    expect(refs).toEqual([{ mediaId: MID }]);
    expect(h.upserts).toHaveLength(1);
    expect((h.upserts[0] as { value: { documents: { ts: string } } }).value.documents.ts).toBe(ts(1).toISOString());
  });

  it("n'écrit rien et ne retraite rien quand aucune ligne ne dépasse le filigrane", async () => {
    queue([], [], [], []);
    const r = await runMediaUsageSweep({ now: NOW });
    expect(r.documents).toBe(0);
    expect(syncContentUsages).not.toHaveBeenCalled();
    expect(h.upserts).toHaveLength(0);
  });

  it("batchSize 2 sur 5 documents : hasMore et filigrane au deuxième", async () => {
    queue([doc("d1", 1), doc("d2", 2), doc("d3", 3)], [], [], []);
    const r = await runMediaUsageSweep({ now: NOW, batchSize: 2 });
    expect(r.hasMore).toBe(true);
    expect(r.documents).toBe(2);
    expect((h.upserts[0] as { value: { documents: { ts: string } } }).value.documents.ts).toBe(ts(2).toISOString());
  });

  it("5 lignes au même updated_at, batchSize 2 : trois tours, chacune traitée une seule fois", async () => {
    const all = ["a1", "a2", "a3", "a4", "a5"].map((id) => doc(id, 1));
    let stored: unknown = undefined;
    const seen: string[] = [];
    const rounds: boolean[] = [];
    for (let i = 0; i < 3; i++) {
      const wm = (stored as Record<string, { ts: string; id: string }> | undefined)?.documents;
      const after = all.filter(
        (d) => !wm || d.id > wm.id || d.updatedAt.toISOString() > wm.ts,
      );
      h.selects = [stored ? [{ value: stored }] : [], after.slice(0, 3), [], [], []];
      syncContentUsages.mockClear();
      const r = await runMediaUsageSweep({ now: NOW, batchSize: 2 });
      for (const c of syncContentUsages.mock.calls) seen.push((c[0] as { targetId: string }).targetId);
      rounds.push(r.hasMore);
      stored = (h.upserts.at(-1) as { value: unknown }).value;
    }
    expect(seen).toEqual(["a1", "a2", "a3", "a4", "a5"]);
    expect(rounds).toEqual([true, true, false]);
  });

  it("relit un filigrane ancien format (horodatage seul) avec l'uuid nul", async () => {
    h.selects = [[{ value: { documents: ts(0).toISOString() } }], [doc("d1", 1)], [], [], []];
    await runMediaUsageSweep({ now: NOW });
    const wm = (h.upserts[0] as { value: Record<string, { ts: string; id: string }> }).value;
    expect(wm.rows.id).toBe("00000000-0000-0000-0000-000000000000");
    expect(wm.documents.id).toBe("d1");
  });

  it("l'échec d'une source n'avance pas son filigrane et n'arrête pas les autres", async () => {
    queue(new Error("boom"), [], [{ id: "v1", updatedAt: ts(3), organizationId: ORG, spaceId: SPACE, payload: {} }], []);
    const r = await runMediaUsageSweep({ now: NOW });
    expect(r.videos).toBe(1);
    const wm = (h.upserts[0] as { value: Record<string, { ts: string }> }).value;
    expect(wm.documents.ts).toBe(new Date(0).toISOString());
    expect(wm.videos.ts).toBe(ts(3).toISOString());
  });

  it("deux appels simultanés : le second retourne sans traiter", async () => {
    let release!: () => void;
    h.gate = new Promise<void>((r) => (release = r));
    queue([doc("d1", 1)], [], [], []);
    const first = runMediaUsageSweep({ now: NOW });
    await Promise.resolve();
    const second = await runMediaUsageSweep({ now: NOW });
    expect(second).toEqual({ documents: 0, rows: 0, videos: 0, brandKits: 0, hasMore: false });
    release();
    expect((await first).documents).toBe(1);
  });

  it("une cellule de base avec /api/attachments crée un usage database_row par colonne", async () => {
    const key = `${MID}/photo.png`;
    queue(
      [],
      [{ id: "r1", updatedAt: ts(1), organizationId: ORG, spaceId: SPACE, payload: { colA: `/api/attachments/${key}`, colB: "texte" } }],
      [],
      [],
    );
    await runMediaUsageSweep({ now: NOW });
    const calls = syncContentUsages.mock.calls as [Record<string, unknown>, unknown][];
    expect(calls).toHaveLength(2);
    expect(calls[0][0]).toMatchObject({ targetType: "database_row", targetId: "r1", context: "colA" });
    expect(calls[0][1]).toEqual([{ storageKey: key }]);
    expect(calls[1][0]).toMatchObject({ context: "colB" });
    expect(h.deletes).toBe(1);
  });

  it("une timeline vidéo avec mediaId crée un usage video_project", async () => {
    queue([], [], [{ id: "v1", updatedAt: ts(1), organizationId: ORG, spaceId: SPACE, payload: { tracks: [{ clips: [{ mediaId: MID }] }] } }], []);
    await runMediaUsageSweep({ now: NOW });
    const [target, refs] = syncContentUsages.mock.calls[0] as [Record<string, unknown>, unknown];
    expect(target).toMatchObject({ targetType: "video_project", targetId: "v1" });
    expect(refs).toEqual([{ mediaId: MID }]);
  });

  it("un kit de marque est traité avec son propre id et sans espace", async () => {
    queue([], [], [], [{ id: "k1", updatedAt: ts(1), organizationId: ORG, payload: [{ url: `/api/media/${MID}`, name: "l" }] }]);
    const r = await runMediaUsageSweep({ now: NOW });
    expect(r.brandKits).toBe(1);
    const [target] = syncContentUsages.mock.calls[0] as [Record<string, unknown>];
    expect(target).toMatchObject({ targetType: "brand_kit", targetId: "k1", spaceId: null });
  });
});
