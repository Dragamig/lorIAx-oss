import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const h = vi.hoisted(() => ({
  configured: true,
  batches: [] as unknown[][],
  claim: vi.fn(),
  process: vi.fn(),
  lock: true,
  inflight: 0,
  maxInflight: 0,
}));
vi.mock("@/lib/db", () => ({
  pool: {
    connect: () =>
      Promise.resolve({
        query: (q: string) => Promise.resolve({ rows: [{ acquired: q.includes("pg_try_advisory_lock") ? h.lock : true }] }),
        release: () => {},
      }),
  },
}));
vi.mock("@/lib/ai/embeddings", () => ({ isEmbeddingConfiguredAsync: () => Promise.resolve(h.configured) }));
vi.mock("./runner", () => ({
  claimBatch: (...a: unknown[]) => h.claim(...a),
  processOne: (...a: unknown[]) => h.process(...a),
}));

import { runMediaIndexJob } from "./index-job";

const rows = (n: number) => Array.from({ length: n }, (_, i) => ({ id: `t${i}` }));

beforeEach(() => {
  h.lock = true;
  h.configured = true;
  h.inflight = 0;
  h.maxInflight = 0;
  h.claim.mockReset();
  h.process.mockReset().mockImplementation(async () => {
    h.inflight++;
    h.maxInflight = Math.max(h.maxInflight, h.inflight);
    await new Promise((r) => setTimeout(r, 5));
    h.inflight--;
    return "done";
  });
});
afterEach(() => {
  delete process.env.MEDIA_INDEX_DISABLED;
});

describe("runMediaIndexJob", () => {
  it("coupe-circuit MEDIA_INDEX_DISABLED=1", async () => {
    process.env.MEDIA_INDEX_DISABLED = "1";
    expect(await runMediaIndexJob()).toEqual({ status: "skipped", skipped: "disabled" });
    expect(h.claim).not.toHaveBeenCalled();
  });

  it("embedding non configuré : skipped no_embedding sans prise de tâche", async () => {
    h.configured = false;
    expect(await runMediaIndexJob()).toEqual({ status: "skipped", skipped: "no_embedding" });
    expect(h.claim).not.toHaveBeenCalled();
  });

  it("compte les issues et s'arrête quand la file est vide, 3 traitements simultanés au plus", async () => {
    h.claim.mockResolvedValueOnce(rows(7)).mockResolvedValueOnce([]);
    h.process.mockImplementationOnce(async () => "failed").mockImplementationOnce(async () => "retry").mockImplementationOnce(async () => "skipped");
    const r = await runMediaIndexJob();
    expect(r).toMatchObject({ status: "ok" });
    expect((r as { done: number }).done + 3).toBe(7 + 0);
    expect(r).toMatchObject({ failed: 1, retried: 1, skipped: 1 });
    expect(h.maxInflight).toBeLessThanOrEqual(3);
  });

  it("n'est pas réentrant", async () => {
    let release!: () => void;
    h.claim.mockImplementationOnce(() => new Promise((r) => (release = () => r([]))));
    const first = runMediaIndexJob();
    await new Promise((r) => setTimeout(r, 5));
    expect(await runMediaIndexJob()).toEqual({ status: "skipped", skipped: "running" });
    release();
    await first;
    h.claim.mockResolvedValue([]);
    expect(await runMediaIndexJob()).toMatchObject({ status: "ok" });
  });

  it("verrou d'instance pris par un autre exécuteur (autre copie du module) : skipped running, aucune prise", async () => {
    h.lock = false;
    expect(await runMediaIndexJob()).toEqual({ status: "skipped", skipped: "running" });
    expect(h.claim).not.toHaveBeenCalled();
    h.lock = true;
    h.claim.mockResolvedValue([]);
    expect(await runMediaIndexJob()).toMatchObject({ status: "ok" });
  });

  it("ne lève jamais sur une panne de la file", async () => {
    h.claim.mockRejectedValue(new Error("db down"));
    await expect(runMediaIndexJob()).resolves.toMatchObject({ status: "ok", done: 0 });
  });
});
