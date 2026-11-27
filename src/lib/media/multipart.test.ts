import { describe, it, expect, vi, beforeEach } from "vitest";
import { Readable } from "stream";

const MB = 1024 * 1024;

const h = vi.hoisted(() => ({
  uploads: [] as Record<string, unknown>[],
  links: [] as Record<string, unknown>[],
  medias: [] as Record<string, unknown>[],
  limit: null as number | null,
  chain: { p: Promise.resolve() as Promise<unknown> },
  seq: 0,
  head: { size: 300 * 1024 * 1024 } as { size: number } | null,
  detected: { mime: "video/mp4", ext: "mp4" } as { mime: string; ext: string } | undefined,
  writeOk: true,
  excludeSeen: [] as unknown[],
  s3: {
    createMultipart: vi.fn(),
    presignUploadPart: vi.fn(),
    listUploadedParts: vi.fn(),
    completeMultipart: vi.fn(),
    abortMultipart: vi.fn(),
    listMultipartUploads: vi.fn(),
    headObject: vi.fn(),
    getObjectRange: vi.fn(),
    getFileStream: vi.fn(),
    deleteFile: vi.fn(),
  },
  emit: vi.fn(),
  enqueue: vi.fn(),
  log: vi.fn(),
}));

const camel = (s: string) => s.replace(/_([a-z])/g, (_, c: string) => c.toUpperCase());
type Pred = (r: Record<string, unknown>) => boolean;

vi.mock("drizzle-orm", async () => {
  const actual = await vi.importActual<typeof import("drizzle-orm")>("drizzle-orm");
  const col = (c: unknown) => camel((c as { name: string }).name);
  return {
    ...actual,
    and: (...p: (Pred | undefined)[]) => ((r) => p.every((x) => !x || x(r))) as Pred,
    eq: (c: unknown, v: unknown) => ((r) => r[col(c)] === v) as Pred,
    lt: (c: unknown, v: Date) => ((r) => (r[col(c)] as Date) < v) as Pred,
    inArray: (c: unknown, v: unknown[]) => ((r) => v.includes(r[col(c)])) as Pred,
  };
});

vi.mock("@/lib/db", async () => {
  const schema = await vi.importActual<typeof import("@/lib/db/schema")>("@/lib/db/schema");
  const rowsOf = (t: unknown) =>
    t === schema.mediaMultipartUploads ? h.uploads : t === schema.mediaTagLinks ? h.links : h.medias;
  const exec = {
    select: (cols?: Record<string, unknown>) => ({
      from: (t: unknown) => ({
        where: (p: Pred) => {
          const rows = rowsOf(t).filter(p);
          if (!cols) return Promise.resolve(rows);
          return Promise.resolve(
            rows.map((r) =>
              Object.fromEntries(Object.entries(cols).map(([k, c]) => [k, r[camel((c as { name: string }).name)]])),
            ),
          );
        },
      }),
    }),
    insert: (t: unknown) => ({
      values: (v: Record<string, unknown> | Record<string, unknown>[]) => ({
        onConflictDoNothing: () => {
          const rows = Array.isArray(v) ? v : [v];
          rows.forEach((r) => rowsOf(t).push(r));
          return Promise.resolve();
        },
        returning: () => {
          if (Array.isArray(v)) throw new Error("returning attendu sur une ligne");
          const row = { id: `up-${++h.seq}`, status: "open", createdAt: new Date(), ...v };
          rowsOf(t).push(row);
          return Promise.resolve([row]);
        },
      }),
    }),
    update: (t: unknown) => ({
      set: (v: Record<string, unknown>) => ({
        where: (p: Pred) => {
          const hit = rowsOf(t).filter(p);
          hit.forEach((r) => Object.assign(r, v));
          return Object.assign(Promise.resolve(), { returning: () => Promise.resolve(hit.map((r) => ({ id: r.id }))) });
        },
      }),
    }),
    execute: () => Promise.resolve(),
    transaction: (fn: (tx: unknown) => Promise<unknown>) => {
      const run = h.chain.p.then(() => fn(exec));
      h.chain.p = run.catch(() => undefined);
      return run;
    },
  };
  return { db: exec };
});

vi.mock("./tags", async () => {
  const actual = await vi.importActual<typeof import("./tags")>("./tags");
  return {
    ...actual,
    ensureTags: vi.fn(async (_org: string, labels: string[]) => labels.map((l) => ({ id: `tag-${l}`, label: l }))),
  };
});
vi.mock("@/lib/logger", () => ({ default: { warn: h.log, error: h.log } }));
vi.mock("@/lib/activity", () => ({ logActivity: vi.fn().mockResolvedValue(undefined) }));
vi.mock("@/lib/storage/s3", () => h.s3);
vi.mock("file-type", () => ({ fileTypeFromBuffer: () => Promise.resolve(h.detected) }));
vi.mock("./events", () => ({ emitMediaUploaded: h.emit }));
vi.mock("./ai/enqueue", () => ({ enqueueMediaIndex: (...a: unknown[]) => h.enqueue(...a) }));
vi.mock("./notify", () => ({ notifyQuotaThreshold: vi.fn().mockResolvedValue(undefined) }));
vi.mock("./ingest", () => ({
  assertIngestTarget: vi.fn(async (_u: unknown, _o: string, spaceId: string | null, folderId?: string | null) =>
    h.writeOk ? { ok: true, folderId: folderId || null } : { ok: false, status: 403, error: spaceId ? "Accès refusé à cet espace" : "Accès refusé" },
  ),
}));

const usedBytes = (excludeId?: unknown) =>
  h.medias.reduce((n, m) => n + (m.sizeBytes as number), 0) +
  h.uploads
    .filter((u) => u.status === "open" && (u.expiresAt as Date) > new Date() && u.id !== excludeId)
    .reduce((n, u) => n + (u.sizeBytes as number), 0);
const verdict = (incoming: number, excludeId?: unknown) => ({
  allowed: h.limit === null || usedBytes(excludeId) + incoming <= h.limit,
  warn: false,
  percentAfter: 0,
  usedBytes: usedBytes(excludeId),
  limitBytes: h.limit,
});
vi.mock("./quota", () => ({
  checkUploadQuota: (_o: string, incoming: number, _tx?: unknown, opts?: { excludeUploadId?: string }) => {
    h.excludeSeen.push(opts?.excludeUploadId);
    return Promise.resolve(verdict(incoming, opts?.excludeUploadId));
  },
}));
vi.mock("./reserve", () => ({
  lockOrgQuota: () => Promise.resolve(),
  reserveMediaRow: async (input: {
    sizeBytes: number;
    values: Record<string, unknown>;
    excludeUploadId?: string;
    afterInsert?: (tx: unknown, row: Record<string, unknown>) => Promise<void>;
  }) => {
    const { db } = await import("@/lib/db");
    return (db as unknown as { transaction: (f: (tx: unknown) => Promise<unknown>) => Promise<unknown> }).transaction(
      async (tx) => {
        const quota = verdict(input.sizeBytes, input.excludeUploadId);
        h.excludeSeen.push(input.excludeUploadId);
        if (!quota.allowed) return { ok: false, status: 507, error: "Quota de stockage atteint", quota };
        const row = { id: `media-${++h.seq}`, currentVersion: 1, organizationId: "o1", ...input.values, sizeBytes: input.sizeBytes };
        h.medias.push(row);
        if (input.afterInsert) await input.afterInsert(tx, row);
        return { ok: true, media: row, quota, previous: null };
      },
    );
  },
}));

import {
  openMultipart,
  signParts,
  getUploadState,
  completeMultipart,
  abortUpload,
  abortStaleMultipartUploads,
  MultipartInputError,
  MULTIPART_PART_SIZE,
} from "./multipart";

const user = { id: "u1" } as never;
const other = { id: "u2" } as never;
const input: { spaceId: string | null; name: string; size: number; type: string; tags?: string[] } = { spaceId: "s1", name: "film.mp4", size: 300 * MB, type: "video/mp4" };
const partCount = Math.ceil((300 * MB) / MULTIPART_PART_SIZE);
const allParts = Array.from({ length: partCount }, (_, i) => ({ partNumber: i + 1, etag: `"e${i + 1}"` }));

async function open(over: Partial<typeof input> = {}) {
  const r = await openMultipart(user, "o1", { ...input, ...over });
  if (!r.ok) throw new Error(`ouverture refusée ${r.status}`);
  return r;
}

beforeEach(() => {
  process.env.S3_PUBLIC_URL = "https://garage.test";
  h.uploads.length = 0;
  h.medias.length = 0;
  h.links.length = 0;
  h.limit = null;
  h.seq = 0;
  h.head = { size: 300 * MB };
  h.detected = { mime: "video/mp4", ext: "mp4" };
  h.writeOk = true;
  h.excludeSeen.length = 0;
  Object.values(h.s3).forEach((f) => f.mockReset());
  h.s3.createMultipart.mockImplementation(async () => `s3-${++h.seq}`);
  h.s3.presignUploadPart.mockImplementation(
    async (_k: string, _u: string, n: number) => `https://garage.test/loriax-files/k?partNumber=${n}`,
  );
  h.s3.listUploadedParts.mockResolvedValue([]);
  h.s3.completeMultipart.mockResolvedValue(undefined);
  h.s3.abortMultipart.mockResolvedValue(undefined);
  h.s3.listMultipartUploads.mockResolvedValue([]);
  h.s3.headObject.mockImplementation(async () => h.head);
  h.s3.getObjectRange.mockResolvedValue(Buffer.alloc(16));
  h.s3.getFileStream.mockImplementation(async () => Readable.from([Buffer.from("abc"), Buffer.from("def")]));
  h.s3.deleteFile.mockResolvedValue(undefined);
  h.emit.mockReset().mockResolvedValue(undefined);
  h.enqueue.mockReset().mockResolvedValue(undefined);
});

describe("openMultipart", () => {
  it("désactivé sans S3_PUBLIC_URL", async () => {
    delete process.env.S3_PUBLIC_URL;
    expect(await openMultipart(user, "o1", input)).toMatchObject({ ok: false, status: 400 });
    expect(h.uploads).toHaveLength(0);
  });

  it("plus de 5 Go : 413 ; 200 Mo ou moins : 400 ; taille non entière : 400", async () => {
    expect(await openMultipart(user, "o1", { ...input, size: 5 * 1024 * MB + 1 })).toMatchObject({ status: 413 });
    expect(await openMultipart(user, "o1", { ...input, size: 200 * MB })).toMatchObject({ status: 400 });
    expect(await openMultipart(user, "o1", { ...input, size: 300 * MB + 0.5 })).toMatchObject({ status: 400 });
  });

  it("type ou extension non vidéo : 415, aucune session S3", async () => {
    expect(await openMultipart(user, "o1", { ...input, type: "application/pdf" })).toMatchObject({ status: 415 });
    expect(await openMultipart(user, "o1", { ...input, name: "film.exe" })).toMatchObject({ status: 415 });
    expect(await openMultipart(user, "o1", { ...input, name: "film" })).toMatchObject({ status: 415 });
    expect(h.s3.createMultipart).not.toHaveBeenCalled();
  });

  it("droit d'écriture refusé : 403, aucune ligne ni session", async () => {
    h.writeOk = false;
    expect(await openMultipart(user, "o1", input)).toMatchObject({ ok: false, status: 403 });
    expect(h.uploads).toHaveLength(0);
    expect(h.s3.createMultipart).not.toHaveBeenCalled();
  });

  it("la clé S3 est choisie par le serveur, sous l'espace, extension validée", async () => {
    await open();
    expect(h.uploads[0].storageKey).toMatch(/^s1\/[0-9a-f-]{36}\.mp4$/);
    expect(h.uploads[0].partSize).toBe(MULTIPART_PART_SIZE);
    await open({ spaceId: null, name: "autre.MOV", size: 301 * MB });
    expect(h.uploads[1].storageKey).toMatch(/^org-o1\/[0-9a-f-]{36}\.mov$/);
  });

  it("deux ouvertures simultanées dont la somme dépasse le quota : une seule passe (507)", async () => {
    h.limit = 500 * MB;
    const [a, b] = await Promise.all([
      openMultipart(user, "o1", input),
      openMultipart(user, "o1", { ...input, name: "autre.mp4" }),
    ]);
    expect([a.ok, b.ok].sort()).toEqual([false, true]);
    expect([a, b].find((r) => !r.ok)).toMatchObject({ status: 507 });
    expect(h.uploads).toHaveLength(1);
    // La session S3 du refusé est refermée.
    expect(h.s3.abortMultipart).toHaveBeenCalledTimes(1);
  });

  it("même fichier, même utilisateur : l'envoi ouvert est repris, pas dupliqué", async () => {
    const a = await open();
    const b = await open();
    expect(b.uploadId).toBe(a.uploadId);
    expect(h.uploads).toHaveLength(1);
    expect(h.s3.createMultipart).toHaveBeenCalledTimes(1);
  });

  it("ouvertures concurrentes du même fichier : une seule session retenue", async () => {
    const [a, b] = await Promise.all([openMultipart(user, "o1", input), openMultipart(user, "o1", input)]);
    expect(a.ok && b.ok && a.uploadId === b.uploadId).toBe(true);
    expect(h.uploads).toHaveLength(1);
  });

  it("un autre utilisateur n'hérite pas de l'envoi", async () => {
    const a = await open();
    const b = await openMultipart(other, "o1", input);
    expect(b.ok && b.uploadId !== a.uploadId).toBe(true);
    expect(h.uploads).toHaveLength(2);
  });

  it("un envoi expiré ne compte plus au quota et n'est pas repris", async () => {
    h.limit = 400 * MB;
    const a = await open();
    h.uploads.find((u) => u.id === a.uploadId)!.expiresAt = new Date(Date.now() - 1000);
    const b = await open({ name: "autre.mp4" });
    expect(b.uploadId).not.toBe(a.uploadId);
  });
});

describe("tags à l'ouverture et à la finalisation", () => {
  it("tags validés à l'ouverture (normalisés, dédoublonnés), posés à la finalisation", async () => {
    const o = await open({ tags: ["  Pub ", "pub", "Été"] } as never);
    expect(h.uploads[0].tags).toEqual(["Pub", "Été"]);
    const r = await completeMultipart(user, "o1", o.uploadId, allParts);
    expect(r.ok).toBe(true);
    expect(h.links).toEqual([
      { mediaId: h.medias[0].id, tagId: "tag-Pub" },
      { mediaId: h.medias[0].id, tagId: "tag-Été" },
    ]);
  });

  it("tag trop long ou trop nombreux : 400, aucune session S3", async () => {
    expect(await openMultipart(user, "o1", { ...input, tags: ["x".repeat(121)] })).toMatchObject({ ok: false, status: 400 });
    expect(await openMultipart(user, "o1", { ...input, tags: Array.from({ length: 21 }, (_, i) => `t${i}`) })).toMatchObject({
      ok: false,
      status: 400,
    });
    expect(h.s3.createMultipart).not.toHaveBeenCalled();
  });

  it("reprise du même fichier : les tags de la nouvelle ouverture remplacent les anciens", async () => {
    await open({ tags: ["a"] } as never);
    await open({ tags: ["b", "c"] } as never);
    expect(h.uploads).toHaveLength(1);
    expect(h.uploads[0].tags).toEqual(["b", "c"]);
  });

  it("sans tags : aucun lien ; un échec de liaison n'annule pas l'envoi", async () => {
    const o = await open();
    expect((await completeMultipart(user, "o1", o.uploadId, allParts)).ok).toBe(true);
    expect(h.links).toHaveLength(0);
    h.uploads.length = 0;
    h.medias.length = 0;
    const o2 = await open({ tags: ["a"] } as never);
    const { ensureTags } = await import("./tags");
    vi.mocked(ensureTags).mockRejectedValueOnce(new Error("db"));
    expect((await completeMultipart(user, "o1", o2.uploadId, allParts)).ok).toBe(true);
    expect(h.medias).toHaveLength(1);
  });
});

describe("signParts / getUploadState", () => {
  it("rend des URL sur l'hôte public, au plus 20 parts", async () => {
    const o = await open();
    const urls = await signParts(user, "o1", o.uploadId, [1, 2, 3]);
    expect(urls).toHaveLength(3);
    expect(urls![0].url.startsWith("https://garage.test/")).toBe(true);
    await expect(
      signParts(user, "o1", o.uploadId, Array.from({ length: 21 }, (_, i) => i + 1)),
    ).rejects.toBeInstanceOf(MultipartInputError);
  });

  it("la taille de chaque part est signée : pleine, et le reste pour la dernière", async () => {
    const o = await open();
    await signParts(user, "o1", o.uploadId, [1, o.partCount]);
    const calls = h.s3.presignUploadPart.mock.calls;
    expect(calls[0][3]).toBe(MULTIPART_PART_SIZE);
    expect(calls[1][3]).toBe(300 * MB - (o.partCount - 1) * MULTIPART_PART_SIZE);
  });

  it("numéros hors 1..partCount ou non entiers : erreur d'entrée", async () => {
    const o = await open();
    await expect(signParts(user, "o1", o.uploadId, [0])).rejects.toBeInstanceOf(MultipartInputError);
    await expect(signParts(user, "o1", o.uploadId, [o.partCount + 1])).rejects.toBeInstanceOf(MultipartInputError);
    await expect(signParts(user, "o1", o.uploadId, [1.5])).rejects.toBeInstanceOf(MultipartInputError);
  });

  it("autre utilisateur, autre organisation, envoi expiré ou clos : null, aucune signature", async () => {
    const o = await open();
    expect(await signParts(other, "o1", o.uploadId, [1])).toBeNull();
    expect(await signParts(user, "o2", o.uploadId, [1])).toBeNull();
    expect(await getUploadState(other, "o1", o.uploadId)).toBeNull();
    expect(await getUploadState(user, "o2", o.uploadId)).toBeNull();
    h.uploads[0].expiresAt = new Date(Date.now() - 1);
    expect(await signParts(user, "o1", o.uploadId, [1])).toBeNull();
    h.uploads[0].expiresAt = new Date(Date.now() + 1e6);
    h.uploads[0].status = "aborted";
    expect(await signParts(user, "o1", o.uploadId, [1])).toBeNull();
    expect(h.s3.presignUploadPart).not.toHaveBeenCalled();
  });

  it("l'état rend les parts déjà reçues", async () => {
    const o = await open();
    h.s3.listUploadedParts.mockResolvedValue([{ partNumber: 2, etag: '"x"', size: 1 }]);
    expect(await getUploadState(user, "o1", o.uploadId)).toEqual({
      status: "open",
      partSize: MULTIPART_PART_SIZE,
      partCount,
      done: [{ partNumber: 2, etag: '"x"' }],
    });
  });
});

describe("getUploadState selon le statut", () => {
  it("en finalisation : statut seul ; terminé : identifiant du média ; abandonné : null", async () => {
    const o = await open();
    expect(await getUploadState(user, "o1", o.uploadId)).toMatchObject({ status: "open" });
    h.uploads[0].status = "completing";
    expect(await getUploadState(user, "o1", o.uploadId)).toEqual({ status: "completing" });
    h.uploads[0].status = "completed";
    h.medias.push({ id: "m1", storageKey: h.uploads[0].storageKey, organizationId: "o1" });
    expect(await getUploadState(user, "o1", o.uploadId)).toEqual({ status: "completed", mediaId: "m1" });
    h.uploads[0].status = "aborted";
    expect(await getUploadState(user, "o1", o.uploadId)).toBeNull();
    expect(await getUploadState(other, "o1", o.uploadId)).toBeNull();
  });
});

describe("completeMultipart", () => {
  it("succès : ligne media à la clé déjà écrite, SHA-256 en flux, événement émis, réservation non doublée", async () => {
    h.limit = 300 * MB;
    const o = await open();
    const key = h.uploads[0].storageKey;
    const r = await completeMultipart(user, "o1", o.uploadId, allParts);
    expect(r.ok).toBe(true);
    expect(h.medias).toHaveLength(1);
    expect(h.medias[0]).toMatchObject({
      storageKey: key,
      sizeBytes: 300 * MB,
      kind: "video",
      checksumSha256: "bef57ec7f53a6d40beb640a780a639c83bc29ac8a9816f1fc6c5c6dcd93c4721",
      uploadedBy: "u1",
      spaceId: "s1",
    });
    expect(h.uploads[0].status).toBe("completed");
    expect(h.excludeSeen).toContain(o.uploadId);
    expect(h.emit).toHaveBeenCalledTimes(1);
    expect(h.enqueue).toHaveBeenCalledWith(h.medias[0].id ?? expect.anything(), "ingest");
    expect(h.s3.deleteFile).not.toHaveBeenCalled();
  });

  it("un second complete est idempotent : même média, rien de créé", async () => {
    const o = await open();
    const a = await completeMultipart(user, "o1", o.uploadId, allParts);
    const b = await completeMultipart(user, "o1", o.uploadId, allParts);
    expect(a.ok && b.ok && a.media.id === b.media.id).toBe(true);
    expect(h.medias).toHaveLength(1);
    expect(h.s3.completeMultipart).toHaveBeenCalledTimes(1);
  });

  it("deux complete simultanés : un seul assemblage, le second reçoit 409, aucun objet supprimé", async () => {
    const o = await open();
    let release: () => void = () => undefined;
    const gate = new Promise<void>((r) => (release = r));
    h.s3.getFileStream.mockImplementation(async () => {
      await gate;
      return Readable.from([Buffer.from("abc")]);
    });
    const first = completeMultipart(user, "o1", o.uploadId, allParts);
    await vi.waitFor(() => expect(h.uploads[0].status).toBe("completing"));
    const second = await completeMultipart(user, "o1", o.uploadId, allParts);
    expect(second).toMatchObject({ ok: false, status: 409 });
    release();
    expect((await first).ok).toBe(true);
    expect(h.s3.completeMultipart).toHaveBeenCalledTimes(1);
    expect(h.s3.deleteFile).not.toHaveBeenCalled();
    expect(h.medias).toHaveLength(1);
    expect(h.uploads[0].status).toBe("completed");
  });

  it("jamais de suppression de l'objet si une ligne media existe pour la clé", async () => {
    const o = await open();
    const { logActivity } = await import("@/lib/activity");
    vi.mocked(logActivity).mockRejectedValueOnce(new Error("boom"));
    const r = await completeMultipart(user, "o1", o.uploadId, allParts);
    expect(r).toMatchObject({ ok: false, status: 500 });
    expect(h.medias).toHaveLength(1);
    expect(h.s3.deleteFile).not.toHaveBeenCalled();
    expect(h.uploads[0].status).toBe("completed");
  });

  it("parts incomplètes ou en double : 400, S3 non appelé, l'envoi reste ouvert", async () => {
    const o = await open();
    expect(await completeMultipart(user, "o1", o.uploadId, allParts.slice(1))).toMatchObject({ ok: false, status: 400 });
    const dup = allParts.map((p, i) => (i === 1 ? { ...p, partNumber: 1 } : p));
    expect(await completeMultipart(user, "o1", o.uploadId, dup)).toMatchObject({ ok: false, status: 400 });
    expect(h.s3.completeMultipart).not.toHaveBeenCalled();
    expect(h.uploads[0].status).toBe("open");
  });

  it("S3 refuse l'assemblage : 400, l'envoi reste ouvert, aucune ligne", async () => {
    const o = await open();
    h.s3.completeMultipart.mockRejectedValue(new Error("InvalidPart"));
    expect(await completeMultipart(user, "o1", o.uploadId, allParts)).toMatchObject({ ok: false, status: 400 });
    expect(h.medias).toHaveLength(0);
    expect(h.uploads[0].status).toBe("open");
  });

  it("taille réelle différente de la déclarée : objet supprimé, envoi clos, aucune ligne, quota libéré", async () => {
    h.limit = 300 * MB;
    const o = await open();
    h.head = { size: 301 * MB };
    expect(await completeMultipart(user, "o1", o.uploadId, allParts)).toMatchObject({ ok: false, status: 400 });
    expect(h.s3.deleteFile).toHaveBeenCalledWith(h.uploads[0].storageKey);
    expect(h.uploads[0].status).toBe("aborted");
    expect(h.medias).toHaveLength(0);
    expect(usedBytes()).toBe(0);
  });

  it("contenu qui n'est pas un média : 415, objet supprimé, aucune ligne", async () => {
    const o = await open();
    h.detected = { mime: "application/pdf", ext: "pdf" };
    expect(await completeMultipart(user, "o1", o.uploadId, allParts)).toMatchObject({ ok: false, status: 415 });
    h.detected = undefined;
    expect(h.s3.deleteFile).toHaveBeenCalledTimes(1);
    expect(h.medias).toHaveLength(0);
    expect(h.uploads[0].status).toBe("aborted");
  });

  it("quota dépassé entre-temps : 507, objet supprimé, aucune ligne", async () => {
    h.limit = 400 * MB;
    const o = await open();
    h.medias.push({ id: "x", sizeBytes: 200 * MB });
    expect(await completeMultipart(user, "o1", o.uploadId, allParts)).toMatchObject({ ok: false, status: 507 });
    expect(h.s3.deleteFile).toHaveBeenCalledTimes(1);
    expect(h.medias).toHaveLength(1);
    expect(h.uploads[0].status).toBe("aborted");
  });

  it("droit d'écriture retiré pendant l'envoi : 403, session S3 abandonnée", async () => {
    const o = await open();
    h.writeOk = false;
    expect(await completeMultipart(user, "o1", o.uploadId, allParts)).toMatchObject({ ok: false, status: 403 });
    expect(h.s3.abortMultipart).toHaveBeenCalled();
    expect(h.s3.completeMultipart).not.toHaveBeenCalled();
  });

  it("envoi d'un autre utilisateur ou d'une autre organisation : refusé, S3 non appelé", async () => {
    const o = await open();
    expect(await completeMultipart(other, "o1", o.uploadId, allParts)).toMatchObject({ ok: false });
    expect(await completeMultipart(user, "o2", o.uploadId, allParts)).toMatchObject({ ok: false });
    expect(h.s3.completeMultipart).not.toHaveBeenCalled();
  });

  it("envoi expiré : refusé et abandonné", async () => {
    const o = await open();
    h.uploads[0].expiresAt = new Date(Date.now() - 1);
    expect(await completeMultipart(user, "o1", o.uploadId, allParts)).toMatchObject({ ok: false, status: 400 });
    expect(h.uploads[0].status).toBe("aborted");
  });
});

describe("abortUpload", () => {
  it("abandonne un envoi ouvert du propriétaire seulement", async () => {
    const o = await open();
    expect(await abortUpload(other, "o1", o.uploadId)).toBe(false);
    expect(await abortUpload(user, "o1", o.uploadId)).toBe(true);
    expect(h.uploads[0].status).toBe("aborted");
    expect(await abortUpload(user, "o1", o.uploadId)).toBe(false);
  });
});

describe("abandon S3 en échec", () => {
  it("la ligne n'est marquée aborted qu'après un abandon S3 réussi", async () => {
    const o = await open();
    h.s3.abortMultipart.mockRejectedValueOnce(new Error("s3 down"));
    expect(await abortUpload(user, "o1", o.uploadId)).toBe(true);
    expect(h.uploads[0].status).not.toBe("aborted");
    expect(h.uploads[0].status).not.toBe("open");
  });

  it("le balayage retente l'abandon et clôt la ligne", async () => {
    const o = await open();
    h.s3.abortMultipart.mockRejectedValueOnce(new Error("s3 down"));
    await abortUpload(user, "o1", o.uploadId);
    h.s3.abortMultipart.mockClear();
    await abortStaleMultipartUploads(new Date());
    expect(h.s3.abortMultipart).toHaveBeenCalledTimes(1);
    expect(h.uploads[0].status).toBe("aborted");
  });

  it("une session S3 de plus de 48 h dont la ligne n'est plus ouverte est annulée", async () => {
    const o = await open();
    const now = new Date();
    h.uploads[0].status = "aborted";
    h.s3.listMultipartUploads.mockResolvedValue([
      { key: K1, uploadId: h.uploads[0].s3UploadId, initiated: new Date(now.getTime() - 72 * 3600_000) },
    ]);
    const r = await abortStaleMultipartUploads(now);
    expect(r.orphans).toBe(1);
    expect(h.s3.abortMultipart).toHaveBeenCalledWith(K1, h.uploads[0].s3UploadId);
    expect(o.uploadId).toBeTruthy();
  });

  it("une finalisation figée et expirée : objet supprimé faute de média, envoi clos", async () => {
    await open();
    h.uploads[0].status = "completing";
    h.uploads[0].expiresAt = new Date(Date.now() - 1);
    await abortStaleMultipartUploads(new Date());
    expect(h.s3.deleteFile).toHaveBeenCalledWith(h.uploads[0].storageKey);
    expect(h.uploads[0].status).toBe("aborted");
  });
});

const U1 = "11111111-1111-4111-8111-111111111111";
const U2 = "22222222-2222-4222-8222-222222222222";
const K1 = `${U1}/${U2}.mp4`;
const K2 = `${U1}/33333333-3333-4333-8333-333333333333.mov`;
const K3 = `org-${U1}/44444444-4444-4444-8444-444444444444.webm`;

describe("abortStaleMultipartUploads", () => {
  it("annule les ouverts expirés, jamais un récent ni un complété", async () => {
    const old = await open();
    const recent = await open({ name: "b.mp4" });
    const done = await open({ name: "c.mp4" });
    h.uploads.find((u) => u.id === old.uploadId)!.expiresAt = new Date(Date.now() - 1);
    h.uploads.find((u) => u.id === done.uploadId)!.expiresAt = new Date(Date.now() - 1);
    h.uploads.find((u) => u.id === done.uploadId)!.status = "completed";
    const r = await abortStaleMultipartUploads(new Date());
    expect(r.aborted).toBe(1);
    expect(h.uploads.find((u) => u.id === old.uploadId)!.status).toBe("aborted");
    expect(h.uploads.find((u) => u.id === recent.uploadId)!.status).toBe("open");
    expect(h.uploads.find((u) => u.id === done.uploadId)!.status).toBe("completed");
  });

  it("ne touche pas aux sessions orphelines hors du préfixe de clés de ce service", async () => {
    const now = new Date();
    const old = new Date(now.getTime() - 72 * 3600_000);
    h.s3.listMultipartUploads.mockResolvedValue([
      { key: "backups/db-2026.dump", uploadId: "other-1", initiated: old },
      { key: "k1", uploadId: "other-2", initiated: old },
      { key: `${U1}/${U2}.pdf`, uploadId: "other-3", initiated: old },
      { key: `${U1}/../${U2}.mp4`, uploadId: "other-4", initiated: old },
      { key: `org-${U1}/${U2}.mp4`, uploadId: "ours-org", initiated: old },
    ]);
    const r = await abortStaleMultipartUploads(now);
    expect(r.orphans).toBe(1);
    expect(h.s3.abortMultipart).toHaveBeenCalledTimes(1);
    expect(h.s3.abortMultipart).toHaveBeenCalledWith(`org-${U1}/${U2}.mp4`, "ours-org");
  });

  it("annule les sessions S3 orphelines de plus de 48 h, pas les récentes ni les connues", async () => {
    const o = await open();
    const known = h.uploads[0].s3UploadId as string;
    const now = new Date();
    const ago = (hours: number) => new Date(now.getTime() - hours * 3600_000);
    h.s3.listMultipartUploads.mockResolvedValue([
      { key: K1, uploadId: "orph-old", initiated: ago(49) },
      { key: K2, uploadId: "orph-new", initiated: ago(2) },
      { key: K3, uploadId: known, initiated: ago(72) },
    ]);
    const r = await abortStaleMultipartUploads(now);
    expect(r).toEqual({ aborted: 0, orphans: 1 });
    expect(h.s3.abortMultipart).toHaveBeenCalledTimes(1);
    expect(h.s3.abortMultipart).toHaveBeenCalledWith(K1, "orph-old");
    expect(h.uploads.find((u) => u.id === o.uploadId)!.status).toBe("open");
  });

  it("un échec du balayage S3 n'empêche pas le rapport", async () => {
    h.s3.listMultipartUploads.mockRejectedValue(new Error("down"));
    expect(await abortStaleMultipartUploads(new Date())).toEqual({ aborted: 0, orphans: 0 });
  });
});
