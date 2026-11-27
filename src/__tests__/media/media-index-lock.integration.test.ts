import { afterAll, describe, expect, it, vi } from "vitest";

const URL = process.env.MEDIA_MIGRATION_TEST_DATABASE_URL;

const h = vi.hoisted(() => ({ calls: 0, concurrent: 0, maxConcurrent: 0, idleInTx: [] as number[] }));
vi.mock("@/lib/ai/embeddings", () => ({ isEmbeddingConfiguredAsync: () => Promise.resolve(true) }));
vi.mock("@/lib/media/ai/runner", () => ({
  claimBatch: async () => {
    h.calls++;
    if (h.calls > 1) return [];
    h.concurrent++;
    h.maxConcurrent = Math.max(h.maxConcurrent, h.concurrent);
    // Pendant le « traitement » : on laisse l'autre exécuteur tenter sa chance et on compte les transactions ouvertes.
    await new Promise((r) => setTimeout(r, 400));
    const { pool } = await import("@/lib/db");
    const r = await pool.query(
      `SELECT count(*)::int AS n FROM pg_stat_activity
       WHERE datname = current_database() AND state IN ('idle in transaction','active') AND xact_start IS NOT NULL
         AND pid <> pg_backend_pid() AND query NOT LIKE '%pg_stat_activity%'`,
    );
    h.idleInTx.push(r.rows[0].n);
    h.concurrent--;
    return [{ id: "x" }];
  },
  processOne: async () => "done",
}));

describe.skipIf(!URL)("exécuteur d'indexation IA : verrou d'instance sans transaction longue", () => {
  const pools: Array<{ end: () => Promise<void> }> = [];
  afterAll(async () => {
    for (const p of pools) await p.end();
  });

  it("deux exécuteurs (deux copies du module) : un seul tourne, aucune transaction ouverte pendant le traitement", async () => {
    process.env.DATABASE_URL = URL;
    vi.resetModules();
    const m1 = await import("@/lib/media/ai/index-job");
    pools.push((await import("@/lib/db")).pool);
    vi.resetModules();
    const m2 = await import("@/lib/media/ai/index-job");
    pools.push((await import("@/lib/db")).pool);
    const [a, b] = await Promise.all([m1.runMediaIndexJob(), m2.runMediaIndexJob()]);
    const statuses = [a, b].map((r) => (r.status === "ok" ? "ok" : r.skipped));
    expect(statuses.sort()).toEqual(["ok", "running"]);
    expect(h.maxConcurrent).toBe(1);
    expect(h.idleInTx).toEqual([0]);
    // Le verrou est rendu : un nouvel exécuteur peut le reprendre.
    h.calls = 5;
    expect((await m2.runMediaIndexJob()).status).toBe("ok");
  });
});
