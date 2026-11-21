import { describe, it, expect, vi, beforeEach } from "vitest";

const limitMock = vi.fn();

const whereMock = vi.fn();
const dbSelect = vi.fn(() => ({ from: () => ({ where: whereMock }) }));
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
    const tx = { select: () => ({ from: () => ({ where: txWhere }) }) };
    const used = await getOrgStorageUsedBytes("org", tx as never);
    expect(used).toBe(5);
    expect(txWhere).toHaveBeenCalledTimes(1);
    expect(dbSelect).not.toHaveBeenCalled();
  });
});
