import { describe, it, expect, vi, beforeEach } from "vitest";

const h = vi.hoisted(() => ({
  enqueue: vi.fn(),
  S: { media: null as Record<string, unknown> | null, versions: [] as Record<string, unknown>[] },
  order: [] as string[],
  chain: { p: Promise.resolve() as Promise<unknown> },
  uploadFile: vi.fn(),
  copyFile: vi.fn(),
  deleteTarget: { n: null as number | null },
  resolveMediaAccess: vi.fn(),
  prepareMediaFile: vi.fn(),
  checkUploadQuota: vi.fn(),
  removeVersionObjects: vi.fn(),
  findOrphanVersionKeys: vi.fn(),
  logActivity: vi.fn(),
  notify: vi.fn(),
  txCount: { n: 0 },
}));

vi.mock("@/lib/storage/s3", () => ({ uploadFile: h.uploadFile, copyFile: h.copyFile }));
vi.mock("./access", () => ({ resolveMediaAccess: h.resolveMediaAccess }));
vi.mock("./prepare-file", () => ({ prepareMediaFile: h.prepareMediaFile }));
vi.mock("./quota", () => ({ checkUploadQuota: h.checkUploadQuota }));
vi.mock("./reserve", () => ({ lockOrgQuota: () => Promise.resolve() }));
vi.mock("./purge", () => ({
  removeVersionObjects: h.removeVersionObjects,
  findOrphanVersionKeys: h.findOrphanVersionKeys,
}));
vi.mock("./notify", () => ({ notifyQuotaThreshold: h.notify }));
vi.mock("@/lib/activity", () => ({ logActivity: h.logActivity }));
vi.mock("@/lib/logger", () => ({ default: { warn: vi.fn() } }));
vi.mock("./ai/enqueue", () => ({ enqueueMediaIndex: (...a: unknown[]) => h.enqueue(...a) }));

vi.mock("@/lib/db", async () => {
  const { media, mediaUsages, mediaVersions } = await vi.importActual<typeof import("@/lib/db/schema")>(
    "@/lib/db/schema",
  );
  const mk = (rows: unknown[]) =>
    Object.assign(Promise.resolve(rows), {
      limit: () => Promise.resolve(rows),
      for: () => Promise.resolve(rows),
      orderBy: () => Promise.resolve(rows),
    });
  const rowsFor = (t: unknown) => {
    if (t === media) return h.S.media ? [h.S.media] : [];
    if (t === mediaUsages) return [{ n: 3 }];
    return [...h.S.versions].sort((a, b) => (a.version as number) - (b.version as number));
  };
  const select = () => ({ from: (t: unknown) => ({
      where: () => mk(rowsFor(t)),
      innerJoin: () => ({ where: () => mk(rowsFor(t)) }),
    }),
  });
  const makeTx = () => ({
    select,
    insert: () => ({
      values: (v: Record<string, unknown>) => ({
        returning: () => {
          const row = { id: `v${v.version}`, ...v };
          h.S.versions.push(row);
          return Promise.resolve([row]);
        },
      }),
    }),
    update: () => ({
      set: (v: Record<string, unknown>) => ({
        where: () => ({
          returning: () => {
            h.S.media = { ...h.S.media, ...v };
            return Promise.resolve([h.S.media]);
          },
        }),
      }),
    }),
    delete: () => ({
      where: () => {
        if (h.deleteTarget.n !== null) {
          h.S.versions = h.S.versions.filter((x) => x.version !== h.deleteTarget.n);
          return Promise.resolve();
        }
        // retire la plus ancienne version non courante
        const cur = h.S.media!.currentVersion;
        const old = h.S.versions.filter((x) => x.version !== cur).sort((a, b) => (a.version as number) - (b.version as number))[0];
        h.S.versions = h.S.versions.filter((x) => x !== old);
        return Promise.resolve();
      },
    }),
  });
  return {
    db: {
      select,
      transaction: (fn: (tx: unknown) => Promise<unknown>) => {
        h.txCount.n += 1;
        const run = h.chain.p.then(async () => {
          const snap = { media: h.S.media, versions: [...h.S.versions] };
          const r = await fn(makeTx());
          h.order.push("commit");
          void snap;
          return r;
        });
        h.chain.p = run.catch(() => undefined);
        return run;
      },
    },
  };
});

import { replaceMediaFile, listVersions, restoreVersion, deleteVersion, MEDIA_VERSIONS_MAX } from "./versions";

const user = { id: "u1" } as never;
const sha = (c: string) => c.repeat(64);

function baseMedia() {
  return {
    id: "m1",
    organizationId: "o1",
    spaceId: "s1",
    kind: "image",
    deletedAt: null,
    currentVersion: 1,
    storageKey: "s1/old.png",
    thumbnailKey: "s1/old.png.thumb.webp",
    filename: "old.png",
    sizeBytes: 10,
    checksumSha256: sha("a"),
    updatedAt: new Date("2026-01-01"),
  };
}

function input(over: Record<string, unknown> = {}) {
  return {
    user,
    orgId: "o1",
    mediaId: "m1",
    expectedVersion: 1,
    file: { name: "new.png", size: 20, type: "image/png" },
    buffer: Buffer.alloc(20),
    ...over,
  } as Parameters<typeof replaceMediaFile>[0];
}

beforeEach(() => {
  vi.clearAllMocks();
  h.S.media = baseMedia();
  h.S.versions = [{ id: "v1", mediaId: "m1", version: 1, storageKey: "s1/old.png", thumbnailKey: "s1/old.png.thumb.webp" }];
  h.order.length = 0;
  h.txCount.n = 0;
  h.deleteTarget.n = null;
  h.copyFile.mockResolvedValue(undefined);
  h.chain.p = Promise.resolve();
  h.resolveMediaAccess.mockResolvedValue({ allowed: true });
  h.prepareMediaFile.mockResolvedValue({
    ok: true, mime: "image/png", ext: "png", safeName: "new.png", kind: "image",
    width: 5, height: 6, thumbnail: Buffer.from("t"), checksum: sha("b"), hasLocationExif: false,
  });
  h.checkUploadQuota.mockResolvedValue({ allowed: true, warn: false, percentAfter: 10, usedBytes: 10, limitBytes: 1000 });
  h.uploadFile.mockResolvedValue("k");
  h.findOrphanVersionKeys.mockImplementation(async (_tx: unknown, keys: string[]) => keys);
  h.removeVersionObjects.mockImplementation(async () => {
    h.order.push("s3-delete");
  });
  h.enqueue.mockReset().mockResolvedValue(undefined);
  h.logActivity.mockResolvedValue(undefined);
  h.notify.mockResolvedValue(undefined);
});

describe("replaceMediaFile", () => {
  it("succès : version +1, nouvelle clé, colonnes de media à jour, updatedAt avancé, usages rendus", async () => {
    const r = await replaceMediaFile(input());
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.version).toMatchObject({ version: 2, sizeBytes: 20, createdBy: "u1" });
    expect(r.media).toMatchObject({ currentVersion: 2, sizeBytes: 20, filename: "old.png", width: 5, height: 6 });
    expect(r.media.storageKey).not.toBe("s1/old.png");
    expect(r.media.storageKey).toBe(r.version.storageKey);
    expect((r.media.updatedAt as Date).getTime()).toBeGreaterThan(new Date("2026-01-01").getTime());
    expect(r.usages).toBe(3);
    expect(h.uploadFile).toHaveBeenCalledTimes(2);
    expect(h.logActivity).toHaveBeenCalledWith(expect.objectContaining({ action: "media.version_created" }));
    expect(h.enqueue).toHaveBeenCalledWith("m1", "replace");
  });

  it("profil de validation : vidéo et audio en \"video\", le reste en \"default\"", async () => {
    h.S.media = { ...baseMedia(), kind: "video" };
    h.prepareMediaFile.mockResolvedValue({ ok: true, mime: "video/mp4", ext: "mp4", safeName: "n.mp4", kind: "video", width: null, height: null, thumbnail: null, checksum: sha("b") });
    await replaceMediaFile(input({ file: { name: "n.mp4", size: 20, type: "video/mp4" } }));
    expect(h.prepareMediaFile).toHaveBeenLastCalledWith(expect.anything(), expect.anything(), "video");
    h.S.media = baseMedia();
    await replaceMediaFile(input());
    expect(h.prepareMediaFile).toHaveBeenLastCalledWith(expect.anything(), expect.anything(), "default");
  });

  it("erreur avant tout commit : les objets neufs sont retirés", async () => {
    h.checkUploadQuota
      .mockResolvedValueOnce({ allowed: true, warn: false, percentAfter: 10, usedBytes: 10, limitBytes: 1000 })
      .mockRejectedValueOnce(new Error("boom"));
    const r = await replaceMediaFile(input());
    expect(r).toMatchObject({ ok: false, status: 500 });
    expect(h.removeVersionObjects).toHaveBeenCalledWith(expect.arrayContaining([expect.any(String)]), "m1");
  });

  it("erreur après un commit effectif : les objets référencés ne sont pas supprimés", async () => {
    h.S.versions = Array.from({ length: MEDIA_VERSIONS_MAX }, (_, i) => ({
      id: `v${i + 1}`, mediaId: "m1", version: i + 1, storageKey: `s1/k${i + 1}.png`, thumbnailKey: null,
    }));
    h.S.media = { ...baseMedia(), currentVersion: MEDIA_VERSIONS_MAX };
    h.findOrphanVersionKeys.mockRejectedValueOnce(new Error("après insertion"));
    const r = await replaceMediaFile(input({ expectedVersion: MEDIA_VERSIONS_MAX }));
    expect(r).toMatchObject({ ok: false, status: 500 });
    expect(h.S.versions.some((v) => v.version === MEDIA_VERSIONS_MAX + 1)).toBe(true);
    expect(h.removeVersionObjects).not.toHaveBeenCalled();
  });

  it("pageCount : celui du nouveau fichier au remplacement, recopié depuis la version à la restauration", async () => {
    h.S.media = { ...baseMedia(), pageCount: 12 };
    h.prepareMediaFile.mockResolvedValue({ ...(await h.prepareMediaFile()), pageCount: null });
    const r = await replaceMediaFile(input());
    expect(r.ok && r.media.pageCount).toBeNull();
    twoVersions();
    h.S.versions[0] = { ...h.S.versions[0], pageCount: 7 };
    const rr = await restoreVersion({ user, orgId: "o1", mediaId: "m1", version: 1, expectedVersion: 2 });
    expect(rr.ok && rr.media.pageCount).toBe(7);
    expect(rr.ok && rr.version.pageCount).toBe(7);
  });

  it("expectedVersion périmé : 409, rien envoyé", async () => {
    const r = await replaceMediaFile(input({ expectedVersion: 0 }));
    expect(r).toMatchObject({ ok: false, status: 409 });
    expect(h.uploadFile).not.toHaveBeenCalled();
    expect(h.prepareMediaFile).not.toHaveBeenCalled();
  });

  it("même SHA-256 : 409", async () => {
    h.prepareMediaFile.mockResolvedValue({ ...(await h.prepareMediaFile()), checksum: sha("a") });
    const r = await replaceMediaFile(input());
    expect(r).toMatchObject({ ok: false, status: 409 });
    expect(h.uploadFile).not.toHaveBeenCalled();
  });

  it("autre kind : 415", async () => {
    h.prepareMediaFile.mockResolvedValue({ ...(await h.prepareMediaFile()), kind: "pdf" });
    const r = await replaceMediaFile(input());
    expect(r).toMatchObject({ ok: false, status: 415 });
    expect(h.uploadFile).not.toHaveBeenCalled();
  });

  it("média en corbeille : 409", async () => {
    h.S.media = { ...baseMedia(), deletedAt: new Date() };
    const r = await replaceMediaFile(input());
    expect(r).toMatchObject({ ok: false, status: 409 });
    expect(h.prepareMediaFile).not.toHaveBeenCalled();
  });

  it("autre organisation : 404 muet, aucune préparation", async () => {
    // la requête filtre par organisation : la ligne d'une autre organisation n'est jamais lue
    h.S.media = null;
    const r = await replaceMediaFile(input());
    expect(r).toMatchObject({ ok: false, status: 404 });
    expect(h.prepareMediaFile).not.toHaveBeenCalled();
  });

  it("résolveur : refus de franchissement 404, refus d'espace 403, aucune préparation", async () => {
    h.resolveMediaAccess.mockResolvedValue({ allowed: false, reason: "org" });
    expect(await replaceMediaFile(input())).toMatchObject({ ok: false, status: 404 });
    h.resolveMediaAccess.mockResolvedValue({ allowed: false, reason: "space" });
    expect(await replaceMediaFile(input())).toMatchObject({ ok: false, status: 403 });
    expect(h.resolveMediaAccess.mock.calls[0][2]).toBe("write");
    expect(h.prepareMediaFile).not.toHaveBeenCalled();
  });

  it("quota : 507, media inchangé, aucun objet neuf conservé", async () => {
    const verdict = { allowed: false, warn: true, percentAfter: 120, usedBytes: 10, limitBytes: 1000 };
    h.checkUploadQuota.mockResolvedValueOnce({ ...verdict, allowed: true }).mockResolvedValueOnce(verdict);
    const r = await replaceMediaFile(input());
    expect(r).toMatchObject({ ok: false, status: 507 });
    expect(h.S.media).toMatchObject({ currentVersion: 1, sizeBytes: 10 });
    expect(h.S.versions).toHaveLength(1);
    expect(h.removeVersionObjects).toHaveBeenCalledTimes(1);
    expect((h.removeVersionObjects.mock.calls[0][0] as string[]).length).toBe(2);
  });

  it("quota refusé dès le pré-contrôle : aucune préparation", async () => {
    h.checkUploadQuota.mockResolvedValue({ allowed: false, warn: true, percentAfter: 200, usedBytes: 1, limitBytes: 1 });
    expect(await replaceMediaFile(input())).toMatchObject({ ok: false, status: 507 });
    expect(h.prepareMediaFile).not.toHaveBeenCalled();
  });

  it("échec de uploadFile : 500, aucune transaction, media et versions inchangés", async () => {
    h.uploadFile.mockRejectedValue(new Error("s3"));
    const r = await replaceMediaFile(input());
    expect(r).toMatchObject({ ok: false, status: 500 });
    expect(h.txCount.n).toBe(0);
    expect(h.S.media).toMatchObject({ currentVersion: 1 });
    expect(h.S.versions).toHaveLength(1);
  });

  it("échec de la vignette : version créée avec thumbnail_key null", async () => {
    h.uploadFile.mockResolvedValueOnce("k").mockRejectedValueOnce(new Error("thumb"));
    const r = await replaceMediaFile(input());
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.version.thumbnailKey).toBeNull();
      expect(r.media.thumbnailKey).toBeNull();
    }
  });

  it("au-delà de 20 versions : la plus ancienne non courante est retirée, objet S3 supprimé après commit", async () => {
    h.S.media = { ...baseMedia(), currentVersion: MEDIA_VERSIONS_MAX };
    h.S.versions = Array.from({ length: MEDIA_VERSIONS_MAX }, (_, i) => ({
      id: `v${i + 1}`, mediaId: "m1", version: i + 1, storageKey: `k${i + 1}`, thumbnailKey: null,
    }));
    const r = await replaceMediaFile(input({ expectedVersion: MEDIA_VERSIONS_MAX }));
    expect(r.ok).toBe(true);
    expect(h.S.versions).toHaveLength(MEDIA_VERSIONS_MAX);
    expect(h.S.versions.find((v) => v.version === 1)).toBeUndefined();
    expect(h.removeVersionObjects).toHaveBeenCalledWith(["k1"], "m1");
    expect(h.order).toEqual(["commit", "s3-delete"]);
  });

  it("20 versions exactement après ajout : rien n'est retiré", async () => {
    h.S.media = { ...baseMedia(), currentVersion: 19 };
    h.S.versions = Array.from({ length: 19 }, (_, i) => ({ id: `v${i + 1}`, mediaId: "m1", version: i + 1, storageKey: `k${i + 1}`, thumbnailKey: null }));
    const r = await replaceMediaFile(input({ expectedVersion: 19 }));
    expect(r.ok).toBe(true);
    expect(h.S.versions).toHaveLength(20);
    expect(h.removeVersionObjects).toHaveBeenCalledWith([], "m1");
  });

  it("deux remplacements concurrents : un seul réussit, l'autre 409", async () => {
    let n = 0;
    h.prepareMediaFile.mockImplementation(async () => ({
      ok: true, mime: "image/png", ext: "png", safeName: "n.png", kind: "image",
      width: 1, height: 1, thumbnail: null, checksum: sha(n++ === 0 ? "c" : "d"), hasLocationExif: false,
    }));
    const [a, b] = await Promise.all([replaceMediaFile(input()), replaceMediaFile(input())]);
    const statuses = [a, b].map((r) => (r.ok ? 200 : r.status)).sort();
    expect(statuses).toEqual([200, 409]);
    expect(h.S.media).toMatchObject({ currentVersion: 2 });
    expect(h.S.versions).toHaveLength(2);
  });
});

describe("listVersions", () => {
  it("rend les versions du média", async () => {
    const rows = await listVersions("m1", "o1");
    expect(rows).toHaveLength(1);
  });
});

function twoVersions() {
  h.S.media = {
    ...baseMedia(),
    currentVersion: 2,
    storageKey: "s1/v2.png",
    thumbnailKey: null,
    filename: "v2.png",
    sizeBytes: 20,
    checksumSha256: sha("b"),
  };
  h.S.versions = [
    { id: "v1", mediaId: "m1", version: 1, storageKey: "s1/v1.png", thumbnailKey: "s1/v1.png.thumb.webp", filename: "v1.png", mimeType: "image/png", sizeBytes: 10, checksumSha256: sha("a"), width: 1, height: 2, pageCount: null },
    { id: "v2", mediaId: "m1", version: 2, storageKey: "s1/v2.png", thumbnailKey: null, filename: "v2.png", mimeType: "image/png", sizeBytes: 20, checksumSha256: sha("b"), width: 3, height: 4, pageCount: null },
  ];
}

describe("restoreVersion", () => {
  const rin = (over: Record<string, unknown> = {}) =>
    ({ user, orgId: "o1", mediaId: "m1", version: 1, expectedVersion: 2, ...over }) as Parameters<typeof restoreVersion>[0];

  it("crée la version courante+1 avec restored_from, clé neuve, copie S3 (original et vignette)", async () => {
    twoVersions();
    const r = await restoreVersion(rin());
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.version).toMatchObject({ version: 3, restoredFrom: 1, filename: "v1.png", sizeBytes: 10 });
    expect(r.version.storageKey).not.toBe("s1/v1.png");
    expect(r.media).toMatchObject({ currentVersion: 3, storageKey: r.version.storageKey, sizeBytes: 10 });
    expect(h.copyFile).toHaveBeenCalledTimes(2);
    expect(h.copyFile).toHaveBeenCalledWith("s1/v1.png", r.version.storageKey);
    expect(h.logActivity).toHaveBeenCalledWith(expect.objectContaining({ action: "media.version_restored" }));
    expect(h.enqueue).toHaveBeenCalledWith("m1", "restore");
  });

  it("quota dépassé : 507, courante intacte, objets copiés retirés", async () => {
    twoVersions();
    const verdict = { allowed: false, warn: true, percentAfter: 120, usedBytes: 10, limitBytes: 1000 };
    h.checkUploadQuota.mockResolvedValueOnce({ ...verdict, allowed: true }).mockResolvedValueOnce(verdict);
    const r = await restoreVersion(rin());
    expect(r).toMatchObject({ ok: false, status: 507 });
    expect(h.S.media).toMatchObject({ currentVersion: 2 });
    expect(h.S.versions).toHaveLength(2);
    expect(h.removeVersionObjects).toHaveBeenCalledTimes(1);
  });

  it("échec de copyFile : 500, rien de créé, aucune transaction", async () => {
    twoVersions();
    h.copyFile.mockRejectedValue(new Error("s3"));
    const r = await restoreVersion(rin());
    expect(r).toMatchObject({ ok: false, status: 500 });
    expect(h.txCount.n).toBe(0);
    expect(h.S.versions).toHaveLength(2);
  });

  it("version inconnue 404, courante 409, périmée 409, corbeille 409, autre organisation 404", async () => {
    twoVersions();
    expect(await restoreVersion(rin({ version: 9 }))).toMatchObject({ ok: false, status: 404 });
    expect(await restoreVersion(rin({ version: 2 }))).toMatchObject({ ok: false, status: 409 });
    expect(await restoreVersion(rin({ expectedVersion: 1 }))).toMatchObject({ ok: false, status: 409 });
    h.S.media = { ...(h.S.media as object), deletedAt: new Date() };
    expect(await restoreVersion(rin())).toMatchObject({ ok: false, status: 409 });
    h.S.media = null;
    expect(await restoreVersion(rin())).toMatchObject({ ok: false, status: 404 });
    expect(h.copyFile).not.toHaveBeenCalled();
  });

  it("droits : refus d'espace 403, franchissement 404", async () => {
    twoVersions();
    h.resolveMediaAccess.mockResolvedValue({ allowed: false, reason: "space" });
    expect(await restoreVersion(rin())).toMatchObject({ ok: false, status: 403 });
    h.resolveMediaAccess.mockResolvedValue({ allowed: false, reason: "org" });
    expect(await restoreVersion(rin())).toMatchObject({ ok: false, status: 404 });
    expect(h.copyFile).not.toHaveBeenCalled();
  });
});

describe("deleteVersion", () => {
  const din = (over: Record<string, unknown> = {}) =>
    ({ user, orgId: "o1", mediaId: "m1", versionId: "v1", ...over }) as Parameters<typeof deleteVersion>[0];

  it("ancienne version : ligne retirée, objets (original et vignette) supprimés après commit, media inchangé", async () => {
    twoVersions();
    h.deleteTarget.n = 1;
    const r = await deleteVersion(din());
    expect(r.ok).toBe(true);
    expect(h.S.versions.map((v) => v.version)).toEqual([2]);
    expect(h.S.media).toMatchObject({ currentVersion: 2, storageKey: "s1/v2.png" });
    expect(h.findOrphanVersionKeys).toHaveBeenCalledWith(expect.anything(), ["s1/v1.png", "s1/v1.png.thumb.webp"]);
    expect(h.removeVersionObjects).toHaveBeenCalledWith(["s1/v1.png", "s1/v1.png.thumb.webp"], "m1");
    expect(h.order).toEqual(["commit", "s3-delete"]);
    expect(h.enqueue).toHaveBeenCalledWith("m1", "backfill");
  });

  it("clé encore référencée ailleurs : aucun objet supprimé", async () => {
    twoVersions();
    h.deleteTarget.n = 1;
    h.findOrphanVersionKeys.mockResolvedValue([]);
    await deleteVersion(din());
    expect(h.removeVersionObjects).toHaveBeenCalledWith([], "m1");
  });

  it("version courante : la précédente redevient courante et media reprend ses colonnes", async () => {
    twoVersions();
    h.deleteTarget.n = 2;
    const r = await deleteVersion(din({ versionId: "v2" }));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.media).toMatchObject({ currentVersion: 1, storageKey: "s1/v1.png", filename: "v1.png", sizeBytes: 10, width: 1 });
    expect(h.removeVersionObjects).toHaveBeenCalledWith(["s1/v2.png"].concat(), "m1");
  });

  it("Annuler (requireCurrent) sur une ligne qui n'est plus la courante : 409, rien supprimé", async () => {
    twoVersions();
    h.deleteTarget.n = 1;
    const r = await deleteVersion(din({ versionId: "v1", requireCurrent: true }));
    expect(r).toMatchObject({ ok: false, status: 409 });
    expect(h.S.versions).toHaveLength(2);
    expect(h.removeVersionObjects).not.toHaveBeenCalled();
  });

  it("numéro réutilisé : un id périmé n'efface pas la nouvelle version portant le même numéro", async () => {
    twoVersions();
    h.deleteTarget.n = 2;
    // la ligne v2 a été supprimée puis un autre utilisateur a recréé un numéro 2 sous un autre id
    h.S.versions = h.S.versions.map((v) => (v.version === 2 ? { ...v, id: "v2bis" } : v));
    const r = await deleteVersion(din({ versionId: "v2", requireCurrent: true }));
    expect(r).toMatchObject({ ok: false, status: 409 });
    expect(h.S.versions.map((v) => v.id)).toEqual(["v1", "v2bis"]);
  });

  it("dernière version restante : 409, rien supprimé", async () => {
    h.deleteTarget.n = 1;
    const r = await deleteVersion(din());
    expect(r).toMatchObject({ ok: false, status: 409 });
    expect(h.S.versions).toHaveLength(1);
    expect(h.removeVersionObjects).not.toHaveBeenCalled();
  });

  it("version inconnue 404, corbeille 409, autre organisation 404, refus d'espace 403", async () => {
    twoVersions();
    expect(await deleteVersion(din({ versionId: "inconnu" }))).toMatchObject({ ok: false, status: 409 });
    h.resolveMediaAccess.mockResolvedValue({ allowed: false, reason: "space" });
    expect(await deleteVersion(din())).toMatchObject({ ok: false, status: 403 });
    h.resolveMediaAccess.mockResolvedValue({ allowed: true });
    h.S.media = { ...(h.S.media as object), deletedAt: new Date() };
    expect(await deleteVersion(din())).toMatchObject({ ok: false, status: 409 });
    h.S.media = null;
    expect(await deleteVersion(din())).toMatchObject({ ok: false, status: 404 });
    expect(h.removeVersionObjects).not.toHaveBeenCalled();
  });
});
