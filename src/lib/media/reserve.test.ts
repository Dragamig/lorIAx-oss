import { describe, it, expect, vi, beforeEach } from "vitest";

const h = vi.hoisted(() => ({
  existing: null as Record<string, unknown> | null,
  used: 0,
  limit: 1000 as number | null,
  inserted: [] as Record<string, unknown>[],
  updated: [] as Record<string, unknown>[],
  order: [] as string[],
  versionInserted: [] as Record<string, unknown>[],
  versionUpdated: [] as Record<string, unknown>[],
  forArgs: [] as unknown[][],
  calls: 0,
  oldVersion: null as Record<string, unknown> | null,
  parent: null as Record<string, unknown> | null,
}));

vi.mock("@/lib/db", async () => {
  const { mediaVersions: versionsTable, mediaMultipartUploads: multipartTable } = await vi.importActual<
    typeof import("@/lib/db/schema")
  >("@/lib/db/schema");
  const tx = {
    execute: () => {
      h.order.push("lock");
      return Promise.resolve();
    },
    select: (cols?: unknown) => ({
      from: (t: unknown) => ({
        innerJoin: () => ({ where: () => Promise.resolve([{ total: "0" }]) }),
        where: () => {
          if (cols) return Promise.resolve([{ total: t === multipartTable ? "0" : String(h.used) }]);
          const src = t === versionsTable ? h.oldVersion : h.calls++ === 0 ? h.existing : h.parent;
          const rows = () => Promise.resolve(src ? [src] : []);
          return Object.assign(rows(), {
            for: (...a: unknown[]) => {
              h.forArgs.push(a);
              return rows();
            },
          });
        },
      }),
    }),
    insert: (t: unknown) => ({
      values: (v: Record<string, unknown>) => {
        if (t === versionsTable) {
          h.versionInserted.push(v);
          return Promise.resolve();
        }
        return {
          returning: () => {
            h.inserted.push(v);
            return Promise.resolve([{ id: "new", currentVersion: 1, ...v }]);
          },
        };
      },
    }),
    update: (t: unknown) => ({
      set: (v: Record<string, unknown>) => {
        if (t === versionsTable) {
          h.versionUpdated.push(v);
          return { where: () => Promise.resolve() };
        }
        h.updated.push(v);
        return {
          where: () => ({
            returning: () => Promise.resolve([{ ...h.existing, ...v }]),
            then: (r: (x: unknown) => unknown) => r(undefined),
          }),
        };
      },
    }),
  };
  return { db: { transaction: (fn: (t: unknown) => unknown) => fn(tx) } };
});

import { reserveMediaRow, restoreMediaRow } from "./reserve";
import { registerHooks, resetHooksForTests } from "@/lib/modules/hooks";
import { beforeEach as hooksBeforeEach } from "vitest";
hooksBeforeEach(() => {
  resetHooksForTests();
  registerHooks({ usage: { checkUsersLimit: async () => { throw new Error('unused'); }, checkSpacesLimit: async () => { throw new Error('unused'); }, getOrgStorageLimitBytes: async (...a: unknown[]) => h.limit } });
});


const values = {
  storageKey: "video-editor/p/exports/j.mp4",
  filename: "a.mp4",
  mimeType: "video/mp4",
  kind: "video" as const,
  uploadedBy: "u1",
};

beforeEach(() => {
  h.existing = null;
  h.oldVersion = null;
  h.parent = null;
  h.calls = 0;
  h.used = 0;
  h.limit = 1000;
  h.inserted.length = 0;
  h.updated.length = 0;
  h.versionInserted.length = 0;
  h.versionUpdated.length = 0;
  h.order.length = 0;
  h.forArgs.length = 0;
});

describe("reserveMediaRow", () => {
  it("insère sous verrou et force l'organisation et la taille", async () => {
    const r = await reserveMediaRow({ orgId: "o1", sizeBytes: 100, values });
    expect(r.ok).toBe(true);
    expect(h.order[0]).toBe("lock");
    expect(h.inserted[0]).toMatchObject({ organizationId: "o1", sizeBytes: 100 });
  });

  it("insère la version 1 dans la même transaction, même clé et même taille", async () => {
    await reserveMediaRow({ orgId: "o1", sizeBytes: 100, values });
    expect(h.versionInserted).toHaveLength(1);
    expect(h.versionInserted[0]).toMatchObject({
      mediaId: "new",
      version: 1,
      storageKey: values.storageKey,
      sizeBytes: 100,
      filename: "a.mp4",
      createdBy: "u1",
    });
  });

  it("refus de quota : aucune version insérée", async () => {
    h.used = 950;
    await reserveMediaRow({ orgId: "o1", sizeBytes: 100, values });
    expect(h.versionInserted).toHaveLength(0);
  });

  it("réécriture : la version courante est mise à jour, aucune version ajoutée", async () => {
    h.existing = { id: "m1", organizationId: "o1", sizeBytes: 400, currentVersion: 1 };
    await reserveMediaRow({ orgId: "o1", sizeBytes: 500, values, replaceExisting: true });
    expect(h.versionInserted).toHaveLength(0);
    expect(h.versionUpdated[0]).toMatchObject({ sizeBytes: 500 });
  });

  it("refuse en 507 au-delà du quota, sans insertion", async () => {
    h.used = 950;
    const r = await reserveMediaRow({ orgId: "o1", sizeBytes: 100, values });
    expect(r).toMatchObject({ ok: false, status: 507, error: "Quota de stockage atteint" });
    expect(h.inserted).toHaveLength(0);
  });

  it("réécriture d'une clé connue : met à jour au lieu de dupliquer, quota sur la différence", async () => {
    h.existing = { id: "m1", organizationId: "o1", sizeBytes: 400 };
    h.used = 900; // 900 + 100 (delta) = 1000, accepté ; 900 + 500 (taille brute) aurait été refusé
    const r = await reserveMediaRow({ orgId: "o1", sizeBytes: 500, values, replaceExisting: true });
    expect(r).toMatchObject({ ok: true, previous: { id: "m1", sizeBytes: 400 } });
    expect(h.inserted).toHaveLength(0);
    expect(h.updated[0]).toMatchObject({ sizeBytes: 500 });
    expect(h.updated[0].updatedAt).toBeInstanceOf(Date);
  });

  it("réécriture dépassant le quota avec son surplus : refusée", async () => {
    h.existing = { id: "m1", organizationId: "o1", sizeBytes: 400 };
    h.used = 950;
    const r = await reserveMediaRow({ orgId: "o1", sizeBytes: 500, values, replaceExisting: true });
    expect(r.ok).toBe(false);
    expect(h.updated).toHaveLength(0);
  });

  it("clé existante d'une autre organisation : erreur, aucune écriture", async () => {
    h.existing = { id: "m1", organizationId: "o2", sizeBytes: 1 };
    await expect(
      reserveMediaRow({ orgId: "o1", sizeBytes: 5, values, replaceExisting: true }),
    ).rejects.toThrow();
    expect(h.updated).toHaveLength(0);
  });

  it("réécriture : la ligne est verrouillée FOR UPDATE (face à une purge concurrente)", async () => {
    h.existing = { id: "m1", organizationId: "o1", sizeBytes: 400, deletedAt: null };
    await reserveMediaRow({ orgId: "o1", sizeBytes: 500, values, replaceExisting: true });
    expect(h.forArgs).toEqual([["update"]]);
  });

  it("réécriture visant une ligne en corbeille : refusée, aucune écriture", async () => {
    h.existing = { id: "m1", organizationId: "o1", sizeBytes: 400, deletedAt: new Date("2026-01-01") };
    await expect(
      reserveMediaRow({ orgId: "o1", sizeBytes: 5, values, replaceExisting: true }),
    ).rejects.toThrow(/corbeille/);
    expect(h.updated).toHaveLength(0);
    expect(h.inserted).toHaveLength(0);
  });

  it("réécriture d'une clé d'ancienne version : met à jour la version, aucune insertion", async () => {
    h.existing = null;
    h.oldVersion = { id: "v1", mediaId: "m1", version: 1, sizeBytes: 400 };
    h.parent = { id: "m1", organizationId: "o1", sizeBytes: 900, currentVersion: 2, deletedAt: null };
    const r = await reserveMediaRow({ orgId: "o1", sizeBytes: 500, values, replaceExisting: true });
    expect(r).toMatchObject({ ok: true, media: { id: "m1" } });
    expect(h.inserted).toHaveLength(0);
    expect(h.versionInserted).toHaveLength(0);
    expect(h.versionUpdated[0]).toMatchObject({ sizeBytes: 500 });
    expect(h.updated).toHaveLength(0);
  });

  it("replaceExisting sans ligne : insère", async () => {
    const r = await reserveMediaRow({ orgId: "o1", sizeBytes: 5, values, replaceExisting: true });
    expect(r).toMatchObject({ ok: true, previous: null });
    expect(h.inserted).toHaveLength(1);
  });

  it("restoreMediaRow : rétablit taille, checksum et updatedAt sous le verrou", async () => {
    const previous = {
      id: "m1",
      organizationId: "o1",
      sizeBytes: 400,
      checksumSha256: "c".repeat(64),
      updatedAt: new Date("2026-01-01"),
    };
    await restoreMediaRow(previous as never);
    expect(h.order).toEqual(["lock"]);
    expect(h.updated[0]).toEqual({
      sizeBytes: 400,
      checksumSha256: previous.checksumSha256,
      updatedAt: previous.updatedAt,
    });
  });
});
