import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  getMediaForAccess: vi.fn(),
  resolveMediaAccess: vi.fn(),
  getMediaFull: vi.fn(),
  assertIngestTarget: vi.fn(),
  ingestMedia: vi.fn(),
  replaceMediaFile: vi.fn(),
  findDuplicates: vi.fn(),
  checkUploadQuota: vi.fn(),
  validateImageUpload: vi.fn(),
  metadata: vi.fn(),
}));
vi.mock("./access", () => ({
  getMediaForAccess: h.getMediaForAccess,
  resolveMediaAccess: h.resolveMediaAccess,
  getMediaFull: h.getMediaFull,
}));
vi.mock("./ingest", () => ({ assertIngestTarget: h.assertIngestTarget, ingestMedia: h.ingestMedia }));
vi.mock("./versions", () => ({ replaceMediaFile: h.replaceMediaFile }));
vi.mock("./duplicates", () => ({ findDuplicates: h.findDuplicates }));
vi.mock("./quota", () => ({ checkUploadQuota: h.checkUploadQuota }));
vi.mock("@/lib/images/validate-upload", () => ({ validateImageUpload: h.validateImageUpload }));
vi.mock("sharp", () => ({ default: () => ({ metadata: h.metadata }) }));

import { saveRetouch } from "./retouch";

const SRC = "11111111-1111-4111-8111-111111111111";
const user = { id: "u1", globalRole: "member" } as never;
const source = { id: SRC, organizationId: "org1", deletedAt: null, spaceId: "sp1" };
const buffer = Buffer.from("png-bytes");
const base = {
  user,
  orgId: "org1",
  sourceId: SRC,
  mode: "derived" as const,
  spaceId: "sp1",
  name: "photo retouchée",
  file: { name: "r.png", size: buffer.length, type: "image/png" },
  buffer,
};
const quota = { allowed: true, warn: false, percentAfter: 10, usedBytes: 1, limitBytes: 100 };

beforeEach(() => {
  vi.clearAllMocks();
  h.getMediaForAccess.mockResolvedValue(source);
  h.resolveMediaAccess.mockResolvedValue({ allowed: true });
  h.validateImageUpload.mockResolvedValue({ ok: true, buffer, contentType: "image/png", ext: "png" });
  h.metadata.mockResolvedValue({ width: 800, height: 600 });
  h.assertIngestTarget.mockResolvedValue({ ok: true, folderId: null });
  h.findDuplicates.mockResolvedValue({});
  h.checkUploadQuota.mockResolvedValue(quota);
  h.ingestMedia.mockResolvedValue({ ok: true, media: { id: "new" }, quota, hasLocationExif: false });
  h.replaceMediaFile.mockResolvedValue({ ok: true, media: { id: SRC }, version: { id: "ver-row-1" }, quota, usages: 0 });
});

describe("saveRetouch : accès à l'original", () => {
  it("404 : original absent, autre organisation, corbeille", async () => {
    for (const row of [null, { ...source, organizationId: "org2" }, { ...source, deletedAt: new Date() }]) {
      h.getMediaForAccess.mockResolvedValue(row);
      const r = await saveRetouch(base);
      expect(r).toMatchObject({ ok: false, status: 404 });
    }
    expect(h.ingestMedia).not.toHaveBeenCalled();
  });
  it("404 muet quand la lecture est refusée", async () => {
    h.resolveMediaAccess.mockResolvedValue({ allowed: false, reason: "space" });
    expect(await saveRetouch(base)).toMatchObject({ ok: false, status: 404 });
    expect(h.resolveMediaAccess).toHaveBeenCalledWith(user, source, "read", { orgId: "org1" });
  });
  it("404 : original qui n'est pas une image", async () => {
    h.getMediaForAccess.mockResolvedValue({ ...source, mimeType: "application/pdf" });
    expect(await saveRetouch(base)).toMatchObject({ ok: false, status: 404 });
  });
});

describe("saveRetouch : fichier rendu", () => {
  it("415 : octets qui ne sont pas une image", async () => {
    h.validateImageUpload.mockResolvedValue({ ok: false, status: 415, error: "Type de fichier non reconnu" });
    expect(await saveRetouch(base)).toMatchObject({ ok: false, status: 415 });
    expect(h.ingestMedia).not.toHaveBeenCalled();
  });
  it("415 : SVG refusé en sortie", async () => {
    h.validateImageUpload.mockResolvedValue({ ok: true, buffer, contentType: "image/svg+xml", ext: "svg" });
    expect(await saveRetouch(base)).toMatchObject({ ok: false, status: 415 });
  });
  it("413 : dimensions réelles hors plafond (côté 8192 ou 24 Mpx)", async () => {
    h.metadata.mockResolvedValue({ width: 8193, height: 10 });
    expect(await saveRetouch(base)).toMatchObject({ ok: false, status: 413 });
    h.metadata.mockResolvedValue({ width: 6000, height: 4001 });
    expect(await saveRetouch(base)).toMatchObject({ ok: false, status: 413 });
    h.metadata.mockResolvedValue({ width: 6000, height: 4000 });
    expect((await saveRetouch(base)).ok).toBe(true);
  });
  it("415 : dimensions illisibles", async () => {
    h.metadata.mockRejectedValue(new Error("bad"));
    expect(await saveRetouch(base)).toMatchObject({ ok: false, status: 415 });
  });
});

describe("saveRetouch : mode derived", () => {
  it("crée un dérivé lié à l'original, origine studio, sans toucher l'original", async () => {
    const r = await saveRetouch(base);
    expect(r).toMatchObject({ ok: true, duplicate: false, media: { id: "new" } });
    expect(h.ingestMedia).toHaveBeenCalledWith(
      expect.objectContaining({
        orgId: "org1",
        spaceId: "sp1",
        sourceMediaId: SRC,
        origin: "studio",
        displayName: "photo retouchée",
        validation: "default",
      }),
    );
    expect(h.replaceMediaFile).not.toHaveBeenCalled();
  });
  it("403 sans écriture sur l'espace cible", async () => {
    h.assertIngestTarget.mockResolvedValue({ ok: false, status: 403, error: "Accès refusé à cet espace" });
    expect(await saveRetouch(base)).toMatchObject({ ok: false, status: 403 });
    expect(h.ingestMedia).not.toHaveBeenCalled();
  });
  it("contenu identique : duplicate true, aucun nouveau média", async () => {
    h.findDuplicates.mockImplementation(async (_u: unknown, _o: unknown, sums: string[]) => ({ [sums[0]]: { id: "dup1" } }));
    h.getMediaFull.mockResolvedValue({ id: "dup1" });
    const r = await saveRetouch(base);
    expect(r).toMatchObject({ ok: true, duplicate: true, media: { id: "dup1" } });
    expect(h.ingestMedia).not.toHaveBeenCalled();
  });
  it("relaie 507 du quota", async () => {
    h.ingestMedia.mockResolvedValue({ ok: false, status: 507, error: "Quota de stockage atteint" });
    expect(await saveRetouch(base)).toMatchObject({ ok: false, status: 507 });
  });
});

describe("saveRetouch : mode version", () => {
  const v = { ...base, mode: "version" as const, expectedVersion: 2, comment: "retouche" };
  it("400 sans expectedVersion", async () => {
    expect(await saveRetouch({ ...v, expectedVersion: undefined })).toMatchObject({ ok: false, status: 400 });
  });
  it("403 sans écriture sur l'original", async () => {
    h.resolveMediaAccess.mockImplementation(async (_u: unknown, _r: unknown, mode: string) =>
      mode === "read" ? { allowed: true } : { allowed: false, reason: "space" });
    expect(await saveRetouch(v)).toMatchObject({ ok: false, status: 403 });
    expect(h.replaceMediaFile).not.toHaveBeenCalled();
  });
  it("remplace via replaceMediaFile", async () => {
    const r = await saveRetouch(v);
    expect(r).toMatchObject({ ok: true, duplicate: false, versionId: "ver-row-1" });
    expect(h.replaceMediaFile).toHaveBeenCalledWith(
      expect.objectContaining({ orgId: "org1", mediaId: SRC, expectedVersion: 2, comment: "retouche" }),
    );
    expect(h.ingestMedia).not.toHaveBeenCalled();
  });
  it("relaie 409 (version périmée, corbeille)", async () => {
    h.replaceMediaFile.mockResolvedValue({ ok: false, status: 409, error: "Version périmée" });
    expect(await saveRetouch(v)).toMatchObject({ ok: false, status: 409 });
  });
});
