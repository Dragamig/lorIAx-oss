import { describe, it, expect, vi, beforeEach } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const limitMock = vi.fn();

const whereMock = vi.fn();
const versionsWhereMock = vi.fn();
const reservedWhereMock = vi.fn();
const multipartTable = vi.hoisted(() => ({ marker: "multipart" }));
vi.mock("@/lib/db/schema", async () => {
  const actual = await vi.importActual<typeof import("@/lib/db/schema")>("@/lib/db/schema");
  return { ...actual, mediaMultipartUploads: Object.assign(actual.mediaMultipartUploads, multipartTable) };
});
const dbSelect = vi.fn(() => ({
  from: (t: unknown) => ({
    where: (t as { marker?: string }).marker === "multipart" ? reservedWhereMock : whereMock,
    innerJoin: () => ({ where: versionsWhereMock }),
  }),
}));
vi.mock("@/lib/db", () => ({ db: { select: () => dbSelect() } }));

import { evaluateQuota, checkUploadQuota, getOrgStorageUsedBytes } from "./quota";
import { registerHooks, resetHooksForTests } from "@/lib/modules/hooks";
import { beforeEach as hooksBeforeEach } from "vitest";
hooksBeforeEach(() => {
  resetHooksForTests();
  registerHooks({ usage: { checkUsersLimit: async () => { throw new Error('unused'); }, checkSpacesLimit: async () => { throw new Error('unused'); }, getOrgStorageLimitBytes: async (...a: unknown[]) => limitMock(...a) } });
});


const GB = 1024 ** 3;
const MB = 1024 ** 2;

describe("evaluateQuota", () => {
  it("autorise un envoi de 10 Mo sous 1 Go sans avertir", () => {
    const v = evaluateQuota(0, 10 * MB, GB);
    expect(v.allowed).toBe(true);
    expect(v.warn).toBe(false);
  });

  it("avertit dès 80 %", () => {
    const v = evaluateQuota(0.79 * GB, 0.02 * GB, GB);
    expect(v.allowed).toBe(true);
    expect(v.warn).toBe(true);
    expect(v.percentAfter).toBeGreaterThanOrEqual(80);
    expect(v.percentAfter).toBeLessThanOrEqual(81);
  });

  it("refuse si used + incoming dépasse la limite", () => {
    expect(evaluateQuota(GB - 1, 2, GB).allowed).toBe(false);
  });

  it("autorise pile à la limite", () => {
    expect(evaluateQuota(GB - 1, 1, GB).allowed).toBe(true);
  });

  it("organisation déjà au-delà : refuse tout envoi, accepte 0", () => {
    expect(evaluateQuota(1.2 * GB, 1, GB).allowed).toBe(false);
    expect(evaluateQuota(1.2 * GB, 0, GB).allowed).toBe(true);
  });

  it("limite null : illimité", () => {
    const v = evaluateQuota(5 * 1024 ** 4, 10 * 1024 ** 4, null);
    expect(v).toMatchObject({ allowed: true, warn: false, percentAfter: 0, limitBytes: null });
  });
});

describe("checkUploadQuota", () => {
  beforeEach(() => {
    limitMock.mockReset();
    whereMock.mockReset();
    reservedWhereMock.mockReset().mockResolvedValue([{ total: "0" }]);
    versionsWhereMock.mockReset().mockResolvedValue([{ total: "0" }]);
    dbSelect.mockClear();
  });

  it("combine usage et limite", async () => {
    limitMock.mockResolvedValue(GB);
    whereMock.mockResolvedValue([{ total: String(GB - 1) }]);
    const v = await checkUploadQuota("org", 2);
    expect(v.allowed).toBe(false);
    expect(v.usedBytes).toBe(GB - 1);
  });

  it("utilise la transaction fournie pour la somme", async () => {
    limitMock.mockResolvedValue(GB);
    const txWhere = vi.fn().mockResolvedValue([{ total: "5" }]);
    const txVersions = vi.fn().mockResolvedValue([{ total: "0" }]);
    const tx = {
      select: () => ({
        from: (t: unknown) => ({
          where: (t as { marker?: string }).marker === "multipart" ? vi.fn().mockResolvedValue([{ total: "0" }]) : txWhere,
          innerJoin: () => ({ where: txVersions }),
        }),
      }),
    };
    const used = await getOrgStorageUsedBytes("org", tx as never);
    expect(used).toBe(5);
    expect(txWhere).toHaveBeenCalledTimes(1);
    expect(txVersions).toHaveBeenCalledTimes(1);
    expect(dbSelect).not.toHaveBeenCalled();
  });
});

describe("getOrgStorageUsedBytes : versions", () => {
  beforeEach(() => {
    whereMock.mockReset();
    reservedWhereMock.mockReset().mockResolvedValue([{ total: "0" }]);
    versionsWhereMock.mockReset();
  });

  it("les envois multipart ouverts comptent comme réservés", async () => {
    whereMock.mockResolvedValue([{ total: "10" }]);
    versionsWhereMock.mockResolvedValue([{ total: "0" }]);
    reservedWhereMock.mockResolvedValue([{ total: "7" }]);
    expect(await getOrgStorageUsedBytes("org")).toBe(17);
  });

  it("le filtre des envois exclut les expirés et les clos, et l'envoi exclu", () => {
    const src = readFileSync(join(__dirname, "quota.ts"), "utf8");
    expect(src).toMatch(/status, \["open", "completing"\]/);
    expect(src).toMatch(/gt\(mediaMultipartUploads\.expiresAt/);
    expect(src).toMatch(/excludeUploadId/);
  });

  it("un média de 10 octets avec deux anciennes versions de 5 octets compte 20 octets", async () => {
    whereMock.mockResolvedValue([{ total: "10" }]);
    versionsWhereMock.mockResolvedValue([{ total: "10" }]);
    expect(await getOrgStorageUsedBytes("org")).toBe(20);
  });

  it("la corbeille compte toujours : aucun filtre sur deleted_at dans les deux sommes", async () => {
    const src = readFileSync(join(__dirname, "quota.ts"), "utf8");
    expect(src).not.toMatch(/deletedAt/);
  });
});
