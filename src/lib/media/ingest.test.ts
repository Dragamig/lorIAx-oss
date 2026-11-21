import { describe, it, expect, vi, beforeEach } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const h = vi.hoisted(() => ({
  uploadFile: vi.fn(),
  checkSpaceWriteAccess: vi.fn(),
  isOrgAdminOrOwner: vi.fn(),
  validateUpload: vi.fn(),
  processImage: vi.fn(),
  limit: { bytes: 1000 as number | null },
  used: { bytes: 0 },
  inserted: [] as Record<string, unknown>[],
  deleted: [] as unknown[],
  order: [] as string[],
  chain: { p: Promise.resolve() as Promise<unknown> },
  logActivity: vi.fn(),
  folderRows: [] as unknown[],
  tagLinks: [] as unknown[],
  ensureTags: vi.fn(),
}));
vi.mock("./tags", () => ({ ensureTags: h.ensureTags }));
vi.mock("@/lib/logger", () => ({ default: { warn: vi.fn() } }));

vi.mock("@/lib/storage/s3", () => ({ uploadFile: h.uploadFile }));
vi.mock("@/lib/auth/check-access", () => ({ checkSpaceWriteAccess: h.checkSpaceWriteAccess }));
vi.mock("./access", () => ({ isOrgAdminOrOwner: h.isOrgAdminOrOwner }));
vi.mock("./validate-upload", () => ({ validateUpload: h.validateUpload }));
vi.mock("./image-processing", () => ({
  processImage: h.processImage,
  sha256Hex: () => "a".repeat(64),
}));
vi.mock("@/lib/activity", () => ({ logActivity: h.logActivity }));

vi.mock("@/lib/db", () => {
  const makeTx = () => ({
    execute: () => {
      h.order.push("lock");
      return Promise.resolve({ rows: [] });
    },
    select: () => ({
      from: () => ({ where: () => Promise.resolve([{ total: String(h.used.bytes) }]) }),
    }),
    insert: () => ({
      values: (v: Record<string, unknown>) => ({
        returning: () => {
          h.order.push("insert");
          h.used.bytes += Number(v.sizeBytes);
          const row = { id: "media-1", ...v };
          h.inserted.push(row);
          return Promise.resolve([row]);
        },
      }),
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
      select: () => ({ from: () => ({ where: () => Promise.resolve(h.folderRows) }) }),
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
  h.inserted.length = 0;
  h.deleted.length = 0;
  h.order.length = 0;
  h.used.bytes = 0;
  h.limit.bytes = 1000;
  h.chain.p = Promise.resolve();
  h.folderRows = [];
  h.tagLinks.length = 0;
  h.ensureTags.mockResolvedValue([]);
  h.checkSpaceWriteAccess.mockResolvedValue(true);
  h.isOrgAdminOrOwner.mockResolvedValue(false);
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

  it("spaceId null par un non-admin : 403, rien d'envoyé", async () => {
    const r = await ingestMedia(input({ spaceId: null }));
    expect(r).toMatchObject({ ok: false, status: 403 });
    expect(h.uploadFile).not.toHaveBeenCalled();
    expect(h.inserted).toHaveLength(0);
  });

  it("spaceId null par un admin d'organisation : accepté, clé org-<id>", async () => {
    h.isOrgAdminOrOwner.mockResolvedValue(true);
    const r = await ingestMedia(input({ spaceId: null }));
    expect(r.ok).toBe(true);
    expect(h.inserted[0].storageKey).toMatch(/^org-org-1\//);
    expect(h.inserted[0].spaceId).toBeNull();
  });

  it("allowOrgLevel : un membre dépose sans espace, clé et nom imposés, origin studio", async () => {
    const r = await ingestMedia(
      input({ spaceId: null, allowOrgLevel: true, origin: "studio", storageKey: "studio/org-1/org/x.png", displayName: "Mon logo" })
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
    expect(h.order.filter((o) => o === "lock")).toHaveLength(3);
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
