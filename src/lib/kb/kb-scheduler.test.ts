import { beforeEach, describe, expect, it, vi } from "vitest";

const ensureKbSchema = vi.fn();
const indexKbFromDisk = vi.fn();
const isKbEmbeddingConfigured = vi.fn();

vi.mock("@/lib/kb/kb", async () => {
  const actual = await vi.importActual<typeof import("@/lib/kb/kb")>("@/lib/kb/kb");
  return {
    ...actual,
    ensureKbSchema: () => ensureKbSchema(),
    indexKbFromDisk: () => indexKbFromDisk(),
    isKbEmbeddingConfigured: () => isKbEmbeddingConfigured(),
  };
});

const loggerMock = vi.hoisted(() => ({ info: vi.fn(), error: vi.fn(), warn: vi.fn() }));
vi.mock("@/lib/logger", () => ({ default: loggerMock }));

import { runKbIndexJob, isKbIndexScheduleDisabled } from "@/lib/kb/kb-scheduler";

const okSummary = {
  sources: 2,
  chunksIndexed: 3,
  chunksSkipped: 5,
  chunksDeleted: 0,
  chunksFailed: 0,
};

describe("runKbIndexJob", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    isKbEmbeddingConfigured.mockResolvedValue(true);
    indexKbFromDisk.mockResolvedValue(okSummary);
  });

  it("lance l'indexation et journalise une synthèse", async () => {
    await runKbIndexJob();
    expect(ensureKbSchema).toHaveBeenCalledTimes(1);
    expect(indexKbFromDisk).toHaveBeenCalledTimes(1);
    expect(loggerMock.info).toHaveBeenCalledWith(
      expect.anything(),
      expect.stringContaining("indexés=3")
    );
    expect(loggerMock.error).not.toHaveBeenCalled();
  });

  it("ne fait rien si l'embedding n'est pas configuré", async () => {
    isKbEmbeddingConfigured.mockResolvedValue(false);
    await runKbIndexJob();
    expect(indexKbFromDisk).not.toHaveBeenCalled();
    expect(loggerMock.info).toHaveBeenCalled();
  });

  it("journalise une erreur si des fragments échouent", async () => {
    indexKbFromDisk.mockResolvedValue({ ...okSummary, chunksFailed: 2 });
    await runKbIndexJob();
    expect(loggerMock.error).toHaveBeenCalled();
  });

  it("ne lance pas deux exécutions en parallèle", async () => {
    let release: () => void = () => {};
    const gate = new Promise<void>((resolve) => { release = resolve; });
    indexKbFromDisk.mockImplementationOnce(() => gate.then(() => okSummary));
    const first = runKbIndexJob();
    await new Promise((r) => setTimeout(r, 20));
    expect(indexKbFromDisk).toHaveBeenCalledTimes(1);
    await runKbIndexJob();
    expect(indexKbFromDisk).toHaveBeenCalledTimes(1);
    release();
    await first;
    await runKbIndexJob();
    expect(indexKbFromDisk).toHaveBeenCalledTimes(2);
  });

  it("n'émet aucune exception en cas d'erreur", async () => {
    indexKbFromDisk.mockRejectedValue(new Error("base indisponible"));
    await expect(runKbIndexJob()).resolves.toBeUndefined();
    expect(loggerMock.error).toHaveBeenCalled();
    // le drapeau est relâché : une exécution suivante repart
    indexKbFromDisk.mockResolvedValue(okSummary);
    await runKbIndexJob();
    expect(indexKbFromDisk).toHaveBeenCalledTimes(2);
  });
});

describe("isKbIndexScheduleDisabled", () => {
  it("lit KB_INDEX_SCHEDULE=off", () => {
    vi.stubEnv("KB_INDEX_SCHEDULE", "off");
    expect(isKbIndexScheduleDisabled()).toBe(true);
    vi.stubEnv("KB_INDEX_SCHEDULE", "");
    expect(isKbIndexScheduleDisabled()).toBe(false);
    vi.unstubAllEnvs();
  });
});
