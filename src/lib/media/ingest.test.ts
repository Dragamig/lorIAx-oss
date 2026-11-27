import { describe, it, expect, vi, beforeEach } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const h = vi.hoisted(() => ({
  uploadFile: vi.fn(),
  checkSpaceWriteAccess: vi.fn(),
  isOrgMember: vi.fn(),
  canWriteLibrary: vi.fn(),
  validateUpload: vi.fn(),
  processImage: vi.fn(),
  limit: { bytes: 1000 as number | null },
  used: { bytes: 0 },
  inserted: [] as Record<string, unknown>[],
  versionInserted: [] as Record<string, unknown>[],
  deleted: [] as unknown[],
  order: [] as string[],
  chain: { p: Promise.resolve() as Promise<unknown> },
  logActivity: vi.fn(),
  folderRows: [] as unknown[],
  tagLinks: [] as unknown[],
  ensureTags: vi.fn(),
  emitMediaUploaded: vi.fn(),
  enqueue: vi.fn(),
  getMediaForAccess: vi.fn(),
  resolveMediaAccess: vi.fn(),
}));
vi.mock("./access", () => ({
  getMediaForAccess: (...a: unknown[]) => h.getMediaForAccess(...a),
  resolveMediaAccess: (...a: unknown[]) => h.resolveMediaAccess(...a),
}));
vi.mock("./events", () => ({ emitMediaUploaded: h.emitMediaUploaded }));
vi.mock("./ai/enqueue", () => ({ enqueueMediaIndex: (...a: unknown[]) => h.enqueue(...a) }));
vi.mock("./tags", () => ({ ensureTags: h.ensureTags }));
vi.mock("@/lib/logger", () => ({ default: { warn: vi.fn() } }));

vi.mock("@/lib/storage/s3", () => ({ uploadFile: h.uploadFile }));
vi.mock("@/lib/auth/check-access", () => ({ checkSpaceWriteAccess: h.checkSpaceWriteAccess }));
vi.mock("@/lib/org/resolve-request-org", () => ({ isOrgMember: h.isOrgMember }));
vi.mock("./folders", () => ({ canWriteLibrary: (...a: unknown[]) => h.canWriteLibrary(...a) }));
vi.mock("./validate-upload", () => ({ validateUpload: h.validateUpload }));
vi.mock("./image-processing", () => ({
  processImage: h.processImage,
  sha256Hex: () => "a".repeat(64),
}));
vi.mock("@/lib/activity", () => ({ logActivity: h.logActivity }));

vi.mock("@/lib/db", async () => {
  const { media: mediaTable, mediaVersions: versionsTable, mediaMultipartUploads: multipartTable } = await vi.importActual<typeof import("@/lib/db/schema")>("@/lib/db/schema");
  const makeTx = () => ({
    execute: () => {
      h.order.push("lock");
      return Promise.resolve({ rows: [] });
    },
    select: () => ({
      from: (t: unknown) => ({
        where: () => Promise.resolve([{ total: t === multipartTable ? "0" : String(h.used.bytes) }]),
        innerJoin: () => ({ where: () => Promise.resolve([{ total: "0" }]) }),
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
            h.order.push("insert");
            h.used.bytes += Number(v.sizeBytes);
            const row = { id: "media-1", currentVersion: 1, ...v };
            h.inserted.push(row);
            return Promise.resolve([row]);
          },
        };
      },
    }),
  });
  return {
    db: {
      // Sérialise les transactions comme le verrou consultatif
      transaction: (fn: (tx: unknown) => Promise<unknown>) => {
        const run = h.chain.p.then(() => fn(makeTx()));
        h.chain.p = run.catch(() => undefined);
        return run;
      },
      delete: () => ({
        where: () => {
          h.deleted.push(true);
          return Promise.resolve();
        },
      }),
      update: () => ({ set: () => ({ where: () => Promise.resolve() }) }),
      select: () => ({
        from: (t: unknown) => ({
          innerJoin: () => ({ where: () => Promise.resolve([{ total: "0" }]) }),
          where: () =>
            Promise.resolve(
              t === mediaTable
                ? [{ total: String(h.used.bytes) }]
                : t === multipartTable
                  ? [{ total: "0" }]
                  : h.folderRows,
            ),
        }),
      }),
      insert: () => ({
        values: (v: unknown) => ({
          onConflictDoNothing: () => {
            h.tagLinks.push(v);
            return Promise.resolve();
          },
        }),
      }),
    },
  };
});

import { ingestMedia, type IngestInput } from "./ingest";
import { registerHooks, resetHooksForTests } from "@/lib/modules/hooks";
import { beforeEach as hooksBeforeEach } from "vitest";
hooksBeforeEach(() => {
  resetHooksForTests();
  registerHooks({ usage: { checkUsersLimit: async () => { throw new Error('unused'); }, checkSpacesLimit: async () => { throw new Error('unused'); }, getOrgStorageLimitBytes: async (...a: unknown[]) => h.limit.bytes } });
});


const ORG = "org-1";
const user = { id: "u1", email: "", name: "", globalRole: "editor", capabilities: [] } as never;

function input(over: Partial<IngestInput> = {}, size = 100): IngestInput {
  return {
    user,
    orgId: ORG,
    spaceId: "space-1",
    file: { name: "photo.png", size, type: "image/png" },
    buffer: Buffer.alloc(size),
    ...over,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  h.emitMediaUploaded.mockResolvedValue(undefined);
  h.enqueue.mockReset().mockResolvedValue(undefined);
  h.inserted.length = 0;
  h.versionInserted.length = 0;
  h.deleted.length = 0;
  h.order.length = 0;
  h.used.bytes = 0;
  h.limit.bytes = 1000;
  h.chain.p = Promise.resolve();
  h.folderRows = [];
  h.tagLinks.length = 0;
  h.ensureTags.mockResolvedValue([]);
  h.checkSpaceWriteAccess.mockResolvedValue(true);
  h.isOrgMember.mockResolvedValue(false);
  h.canWriteLibrary.mockResolvedValue(true);
  h.uploadFile.mockResolvedValue("k");
  h.validateUpload.mockImplementation(async (f: { name: string; type: string }) => ({
    ok: true,
    ext: f.name.split(".").pop(),
    safeName: f.name,
    mime: f.type,
  }));
  h.processImage.mockResolvedValue({
    width: 10,
    height: 20,
    thumbnail: Buffer.from("t"),
    thumbnailMime: "image/webp",
    hasLocationExif: false,
  });
});

describe("ingestMedia : dossier et tags", () => {
  const FOLDER = "11111111-1111-4111-8111-111111111111";

  it("folderId d'une autre organisation : 400, aucune ligne, aucun envoi", async () => {
    h.folderRows = [];
    const r = await ingestMedia(input({ folderId: FOLDER }));
    expect(r).toMatchObject({ ok: false, status: 400 });
    expect(h.inserted).toHaveLength(0);
    expect(h.uploadFile).not.toHaveBeenCalled();
  });

  it("folderId mal formé : 400 sans requête", async () => {
    const r = await ingestMedia(input({ folderId: "pas-un-uuid" }));
    expect(r).toMatchObject({ ok: false, status: 400 });
    expect(h.inserted).toHaveLength(0);
  });

  it("folderId de l'organisation : stocké sur la ligne", async () => {
    h.folderRows = [{ id: FOLDER }];
    const r = await ingestMedia(input({ folderId: FOLDER }));
    expect(r.ok).toBe(true);
    expect(h.inserted[0].folderId).toBe(FOLDER);
  });

  it("tags : le média reçoit un lien par tag", async () => {
    h.ensureTags.mockResolvedValue([{ id: "t1", label: "Logo" }]);
    const r = await ingestMedia(input({ tags: ["Logo"] }));
    expect(r.ok).toBe(true);
    expect(h.ensureTags).toHaveBeenCalledWith(ORG, ["Logo"]);
    expect(h.tagLinks).toEqual([[{ mediaId: "media-1", tagId: "t1" }]]);
  });

  it("échec de liaison de tag : l'upload réussit quand même", async () => {
    h.ensureTags.mockRejectedValue(new Error("boom"));
    const r = await ingestMedia(input({ tags: ["Logo"] }));
    expect(r.ok).toBe(true);
    expect(h.tagLinks).toHaveLength(0);
  });
});

describe("ingestMedia : lien d'origine", () => {
  const SRC = "22222222-2222-4222-8222-222222222222";
  const srcRow = { id: SRC, organizationId: ORG, spaceId: "space-1", uploadedBy: "u2", deletedAt: null, origin: "upload", mimeType: "image/png" };

  it("sourceMediaId lisible de la même organisation : la ligne porte le lien", async () => {
    h.getMediaForAccess.mockResolvedValue(srcRow);
    h.resolveMediaAccess.mockResolvedValue({ allowed: true });
    const r = await ingestMedia(input({ sourceMediaId: SRC }));
    expect(r.ok).toBe(true);
    expect(h.resolveMediaAccess).toHaveBeenCalledWith(user, srcRow, "read", { orgId: ORG });
    expect(h.inserted[0].sourceMediaId).toBe(SRC);
  });

  it("sans sourceMediaId : lien nul, aucune lecture de source", async () => {
    await ingestMedia(input());
    expect(h.getMediaForAccess).not.toHaveBeenCalled();
    expect(h.inserted[0].sourceMediaId).toBeNull();
  });

  it("source d'une autre organisation : 400, rien créé", async () => {
    h.getMediaForAccess.mockResolvedValue({ ...srcRow, organizationId: "org-2" });
    h.resolveMediaAccess.mockResolvedValue({ allowed: true });
    const r = await ingestMedia(input({ sourceMediaId: SRC }));
    expect(r).toMatchObject({ ok: false, status: 400 });
    expect(h.inserted).toHaveLength(0);
    expect(h.uploadFile).not.toHaveBeenCalled();
  });

  it("source illisible par l'appelant : 400 identique à une source absente", async () => {
    h.getMediaForAccess.mockResolvedValue(srcRow);
    h.resolveMediaAccess.mockResolvedValue({ allowed: false, reason: "space" });
    const denied = await ingestMedia(input({ sourceMediaId: SRC }));
    h.getMediaForAccess.mockResolvedValue(null);
    const missing = await ingestMedia(input({ sourceMediaId: SRC }));
    expect(denied).toMatchObject({ ok: false, status: 400 });
    expect(denied).toEqual(missing);
    expect(h.inserted).toHaveLength(0);
  });

  it("source en corbeille : 400 même si l'appelant peut l'écrire", async () => {
    h.getMediaForAccess.mockResolvedValue({ ...srcRow, deletedAt: new Date() });
    h.resolveMediaAccess.mockResolvedValue({ allowed: true });
    const r = await ingestMedia(input({ sourceMediaId: SRC }));
    expect(r).toMatchObject({ ok: false, status: 400 });
    expect(h.inserted).toHaveLength(0);
  });

  it("sourceMediaId mal formé : 400 sans lecture", async () => {
    const r = await ingestMedia(input({ sourceMediaId: "pas-un-uuid" }));
    expect(r).toMatchObject({ ok: false, status: 400 });
    expect(h.getMediaForAccess).not.toHaveBeenCalled();
  });
});

describe("ingestMedia", () => {
  it("image valide : ligne insérée, original puis miniature envoyés", async () => {
    const r = await ingestMedia(input());
    expect(r.ok).toBe(true);
    expect(h.inserted).toHaveLength(1);
    const row = h.inserted[0];
    expect(row.kind).toBe("image");
    expect((row.checksumSha256 as string).length).toBe(64);
    expect(row.organizationId).toBe(ORG);
    expect(row.origin).toBe("upload");
    expect(row.storageKey).toMatch(/^space-1\/[0-9a-f-]+\.png$/);
    expect(row.thumbnailKey).toBe(`${row.storageKey}.thumb.webp`);
    expect(h.uploadFile).toHaveBeenCalledTimes(2);
    expect(h.logActivity).toHaveBeenCalledWith(
      expect.objectContaining({ entityType: "media", action: "upload" }),
    );
  });

  it("émet « média ajouté » après le succès, sans bloquer si l'émission échoue", async () => {
    h.emitMediaUploaded.mockRejectedValueOnce(new Error("boom"));
    const r = await ingestMedia(input());
    expect(r.ok).toBe(true);
    expect(h.emitMediaUploaded).toHaveBeenCalledTimes(1);
  });

  it("met le média en file d'indexation IA après le succès, et un échec de la file n'annule pas l'ingestion", async () => {
    const r = await ingestMedia(input());
    expect(r.ok).toBe(true);
    expect(h.enqueue).toHaveBeenCalledWith(h.inserted[0].id ?? expect.anything(), "ingest");
    h.enqueue.mockRejectedValueOnce(new Error("db"));
    expect((await ingestMedia(input())).ok).toBe(true);
  });

  it("ne met rien en file quand l'envoi S3 échoue", async () => {
    h.uploadFile.mockRejectedValueOnce(new Error("s3"));
    await ingestMedia(input());
    expect(h.enqueue).not.toHaveBeenCalled();
  });

  it("n'émet rien quand l'envoi S3 échoue", async () => {
    h.uploadFile.mockRejectedValueOnce(new Error("s3"));
    const r = await ingestMedia(input());
    expect(r.ok).toBe(false);
    expect(h.emitMediaUploaded).not.toHaveBeenCalled();
  });

  it("crée la ligne media_versions v1 avec la même clé et la même taille", async () => {
    await ingestMedia(input({}, 100));
    expect(h.versionInserted).toHaveLength(1);
    expect(h.versionInserted[0]).toMatchObject({
      mediaId: "media-1",
      version: 1,
      storageKey: h.inserted[0].storageKey,
      sizeBytes: 100,
    });
  });

  it("PDF : un seul envoi S3, pas de miniature", async () => {
    h.processImage.mockResolvedValue({
      width: null, height: null, thumbnail: null, thumbnailMime: null, hasLocationExif: false,
    });
    const r = await ingestMedia(
      input({ file: { name: "a.pdf", size: 100, type: "application/pdf" } }),
    );
    expect(r.ok).toBe(true);
    expect(h.uploadFile).toHaveBeenCalledTimes(1);
    expect(h.inserted[0].kind).toBe("pdf");
    expect(h.inserted[0].thumbnailKey).toBeNull();
  });

  it("processImage qui échoue : l'envoi continue sans miniature", async () => {
    h.processImage.mockRejectedValue(new Error("corrupt"));
    const r = await ingestMedia(input());
    expect(r.ok).toBe(true);
    expect(h.uploadFile).toHaveBeenCalledTimes(1);
    expect(h.inserted[0].thumbnailKey).toBeNull();
    expect(h.inserted[0].width).toBeNull();
  });

  it("validation refusée : statut propagé, rien d'écrit", async () => {
    h.validateUpload.mockResolvedValue({ ok: false, status: 415, error: "Type non reconnu" });
    const r = await ingestMedia(input());
    expect(r).toMatchObject({ ok: false, status: 415 });
    expect(h.uploadFile).not.toHaveBeenCalled();
    expect(h.inserted).toHaveLength(0);
  });

  it("ingestMedia hors espace par un membre simple réussit, clé org-<id>", async () => {
    h.isOrgMember.mockResolvedValue(true);
    const r = await ingestMedia(input({ spaceId: null }));
    expect(r.ok).toBe(true);
    expect(h.inserted[0].storageKey).toMatch(/^org-org-1\//);
    expect(h.inserted[0].spaceId).toBeNull();
  });

  it("ingestMedia hors espace sans droit d'écriture (viewer membre) : 403, rien d'envoyé ni émis", async () => {
    h.isOrgMember.mockResolvedValue(true);
    h.canWriteLibrary.mockResolvedValue(false);
    const r = await ingestMedia(input({ spaceId: null }));
    expect(r).toMatchObject({ ok: false, status: 403 });
    expect(h.uploadFile).not.toHaveBeenCalled();
    expect(h.inserted).toHaveLength(0);
    expect(h.emitMediaUploaded).not.toHaveBeenCalled();
  });

  it("ingestMedia hors espace par un non-membre échoue en 403, rien d'envoyé", async () => {
    h.isOrgMember.mockResolvedValue(false);
    h.canWriteLibrary.mockResolvedValue(false);
    const r = await ingestMedia(input({ spaceId: null }));
    expect(r).toMatchObject({ ok: false, status: 403 });
    expect(h.uploadFile).not.toHaveBeenCalled();
    expect(h.inserted).toHaveLength(0);
  });

  it("clé et nom imposés, origin studio, sans espace", async () => {
    h.isOrgMember.mockResolvedValue(true);
    const r = await ingestMedia(
      input({ spaceId: null, origin: "studio", storageKey: "studio/org-1/org/x.png", displayName: "Mon logo" })
    );
    expect(r.ok).toBe(true);
    expect(h.inserted[0]).toMatchObject({ storageKey: "studio/org-1/org/x.png", filename: "Mon logo", origin: "studio" });
  });

  it("transmet le profil de validation demandé", async () => {
    await ingestMedia(input({ validation: "video" }));
    expect(h.validateUpload.mock.calls.at(-1)![2]).toBe("video");
    await ingestMedia(input({}));
    expect(h.validateUpload.mock.calls.at(-1)![2]).toBe("default");
  });

  it("viewer : 403", async () => {
    h.checkSpaceWriteAccess.mockResolvedValue(false);
    const r = await ingestMedia(input());
    expect(r).toMatchObject({ ok: false, status: 403 });
    expect(h.uploadFile).not.toHaveBeenCalled();
  });

  it("refus de droit : aucune préparation (validation, miniature) n'est lancée", async () => {
    h.checkSpaceWriteAccess.mockResolvedValue(false);
    const r = await ingestMedia(input());
    expect(r).toMatchObject({ ok: false, status: 403 });
    expect(h.validateUpload).not.toHaveBeenCalled();
    expect(h.processImage).not.toHaveBeenCalled();
  });

  it("quota dépassé : aucune préparation n'est lancée", async () => {
    h.used.bytes = 950;
    const r = await ingestMedia(input());
    expect(r).toMatchObject({ ok: false, status: 507 });
    expect(h.validateUpload).not.toHaveBeenCalled();
    expect(h.processImage).not.toHaveBeenCalled();
  });

  it("quota dépassé : 507, aucun envoi, aucune ligne", async () => {
    h.used.bytes = 950;
    const r = await ingestMedia(input());
    expect(r).toMatchObject({ ok: false, status: 507, error: "Quota de stockage atteint" });
    expect(h.uploadFile).not.toHaveBeenCalled();
    expect(h.inserted).toHaveLength(0);
  });

  it("échec S3 : la ligne est supprimée, 500, aucun import de deleteFile", async () => {
    h.uploadFile.mockRejectedValue(new Error("s3 down"));
    const r = await ingestMedia(input());
    expect(r).toMatchObject({ ok: false, status: 500 });
    expect(h.deleted).toHaveLength(1);
    const src = readFileSync(join(__dirname, "ingest.ts"), "utf8");
    expect(src).not.toMatch(/deleteFile|DeleteObjectCommand/);
  });

  it("quota à 85 % : ok avec warn", async () => {
    h.used.bytes = 750;
    const r = await ingestMedia(input());
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.quota.warn).toBe(true);
  });

  it("deux appels concurrents à 99 % : un seul passe, le second voit l'usage du premier", async () => {
    h.used.bytes = 990;
    const [a, b] = await Promise.all([ingestMedia(input({}, 5)), ingestMedia(input({}, 5))]);
    const statuses = [a, b].map((r) => (r.ok ? 201 : r.status)).sort();
    expect(statuses).toEqual([201, 201]);
    // 990 + 5 + 5 = 1000 passe ; un troisième refuse
    const c = await ingestMedia(input({}, 5));
    expect(c).toMatchObject({ ok: false, status: 507 });
    // le troisième est refusé par le pré-contrôle, sans entrer dans la section critique
    expect(h.order.filter((o) => o === "lock")).toHaveLength(2);
    expect(h.order.slice(0, 4)).toEqual(["lock", "insert", "lock", "insert"]);
  });

  it("deux appels concurrents à 99 % dont un seul passe", async () => {
    h.used.bytes = 995;
    const [a, b] = await Promise.all([ingestMedia(input({}, 5)), ingestMedia(input({}, 5))]);
    const oks = [a, b].filter((r) => r.ok).length;
    expect(oks).toBe(1);
    expect([a, b].find((r) => !r.ok)).toMatchObject({ status: 507 });
  });
});
