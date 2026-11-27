import { randomUUID } from "node:crypto";
import { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

const URL = process.env.MEDIA_MIGRATION_TEST_DATABASE_URL;

describe.skipIf(!URL)("file d'indexation IA des médias : prise concurrente, reprise, plafonds", () => {
  let pool: Pool;
  const run = randomUUID().slice(0, 8);
  const [orgOn, orgOff, user] = [randomUUID(), randomUUID(), randomUUID()];
  const ids: string[] = [];
  const NOW = new Date("2026-11-26T10:00:00.000Z");

  async function addRow(org: string, opts: { status?: string; lockedMinutesAgo?: number; deleted?: boolean; attempts?: number } = {}) {
    const id = randomUUID();
    ids.push(id);
    await pool.query(
      `INSERT INTO media (id, organization_id, filename, mime_type, kind, size_bytes, storage_key, uploaded_by, deleted_at)
       VALUES ($1,$2,$3,'application/pdf','pdf',100,$4,$5,$6)`,
      [id, org, `${id}.pdf`, `q/${run}/${id}`, user, opts.deleted ? new Date() : null],
    );
    await pool.query(
      `INSERT INTO media_texts (media_id, organization_id, status, attempts, locked_at, next_attempt_at)
       VALUES ($1,$2,$3,$4,$5,$6)`,
      [
        id,
        org,
        opts.status ?? "pending",
        opts.attempts ?? 0,
        opts.lockedMinutesAgo !== undefined ? new Date(NOW.getTime() - opts.lockedMinutesAgo * 60_000) : null,
        new Date(NOW.getTime() - 1000),
      ],
    );
    return id;
  }

  beforeAll(async () => {
    process.env.DATABASE_URL = URL;
    pool = new Pool({ connectionString: URL });
    await pool.query(`INSERT INTO users (id, email, name) VALUES ($1,$2,'u')`, [user, `q-${run}@test.fr`]);
    await pool.query(`INSERT INTO organizations (id, slug, name) VALUES ($1,$2,'On'),($3,$4,'Off')`, [orgOn, `on-${run}`, orgOff, `off-${run}`]);
    await pool.query(`INSERT INTO media_ai_settings (organization_id, index_enabled) VALUES ($1,true),($2,false)`, [orgOn, orgOff]);
  });

  afterAll(async () => {
    await pool.query(`DELETE FROM organizations WHERE id IN ($1,$2)`, [orgOn, orgOff]);
    await pool.query(`DELETE FROM users WHERE id = $1`, [user]);
    await pool.end();
  });

  it("deux claimBatch concurrents ne renvoient jamais la même ligne ; organisation désactivée et corbeille exclues", async () => {
    const { claimBatch } = await import("@/lib/media/ai/runner");
    const mine: string[] = [];
    for (let i = 0; i < 6; i++) mine.push(await addRow(orgOn));
    const off = await addRow(orgOff);
    const trashed = await addRow(orgOn, { deleted: true });

    const [a, b] = await Promise.all([claimBatch(4, NOW), claimBatch(4, NOW)]);
    const got = [...a, ...b].map((r) => r.mediaId);
    expect(new Set(got).size).toBe(got.length);
    expect(got.every((id) => mine.includes(id))).toBe(true);
    expect(got).not.toContain(off);
    expect(got).not.toContain(trashed);
    expect(got.length).toBe(6);
    const st = await pool.query(`SELECT status FROM media_texts WHERE media_id = $1`, [off]);
    expect(st.rows[0].status).toBe("pending");
  });

  it("une ligne running figée depuis 20 minutes est reprise (essai compté), une récente non", async () => {
    const { claimBatch } = await import("@/lib/media/ai/runner");
    const stuck = await addRow(orgOn, { status: "running", lockedMinutesAgo: 20, attempts: 1 });
    const fresh = await addRow(orgOn, { status: "running", lockedMinutesAgo: 2 });
    const got = await claimBatch(50, NOW);
    const s = got.find((r) => r.mediaId === stuck);
    expect(s?.attempts).toBe(2);
    expect(got.some((r) => r.mediaId === fresh)).toBe(false);
  });

  it("le plafond de transcription : compteur par jour et organisation, cloisonné", async () => {
    const { remainingTranscribeSeconds } = await import("@/lib/media/ai/runner");
    expect(await remainingTranscribeSeconds(orgOn, NOW)).toBe(7200);
    await pool.query(`INSERT INTO media_ai_daily_usage (organization_id, day, transcribe_seconds) VALUES ($1,'2026-11-26',5000)`, [orgOn]);
    expect(await remainingTranscribeSeconds(orgOn, NOW)).toBe(2200);
    expect(await remainingTranscribeSeconds(orgOff, NOW)).toBe(7200);
    expect(await remainingTranscribeSeconds(orgOn, new Date("2026-11-27T00:00:01Z"))).toBe(7200);
  });

  it("réservations parallèles : jamais plus que le plafond du jour, plafond de passages tenu", async () => {
    const { reserveTranscribeSeconds, reservePass } = await import("@/lib/media/ai/runner");
    const day = new Date("2026-12-05T10:00:00.000Z");
    const got = await Promise.all(Array.from({ length: 6 }, () => reserveTranscribeSeconds(orgOff, day)));
    expect(got.reduce((a, b) => a + b, 0)).toBe(7200);
    expect(got.every((n) => n === 3600 || n === 0)).toBe(true);
    const passes = await Promise.all(Array.from({ length: 310 }, () => reservePass(orgOff, day)));
    expect(passes.filter(Boolean).length).toBe(300);
    const row = await pool.query(`SELECT transcribe_seconds, indexed_passes FROM media_ai_daily_usage WHERE organization_id = $1 AND day = '2026-12-05'`, [orgOff]);
    expect(row.rows[0]).toEqual({ transcribe_seconds: 7200, indexed_passes: 300 });
  });

  it("deux copies du module d'exécution : un seul exécuteur dans l'instance (verrou consultatif)", async () => {
    vi.doMock("@/lib/ai/embeddings", () => ({
      isEmbeddingConfiguredAsync: async () => {
        await new Promise((r) => setTimeout(r, 400));
        return false;
      },
    }));
    vi.resetModules();
    const a = await import("@/lib/media/ai/index-job");
    vi.resetModules();
    const b = await import("@/lib/media/ai/index-job");
    expect(a.runMediaIndexJob).not.toBe(b.runMediaIndexJob);
    const res = await Promise.all([a.runMediaIndexJob(), b.runMediaIndexJob()]);
    expect(res.map((r) => (r.status === "skipped" ? r.skipped : r.status)).sort()).toEqual(["no_embedding", "running"]);
    vi.doUnmock("@/lib/ai/embeddings");
    vi.resetModules();
  });
});
