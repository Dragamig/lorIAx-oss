import { randomUUID } from "node:crypto";
import { Pool } from "pg";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const URL = process.env.MEDIA_MIGRATION_TEST_DATABASE_URL;

vi.mock("@/lib/ai/embeddings", () => ({
  isEmbeddingConfiguredAsync: async () => true,
  generateEmbedding: async () => Array.from({ length: 1536 }, () => 0.01),
  chunkText: (t: string) => [t],
}));
vi.mock("@/lib/ai/quota-checker", () => ({ checkQuota: async () => ({ allowed: true }) }));
vi.mock("@/lib/ai/embedding-dimensions", () => ({
  getActiveEmbeddingDimension: async () => 1536,
  resolveActiveEmbeddingModel: async () => "test-model",
}));
vi.mock("@/lib/media/ai/embedding-schema", () => ({ ensureMediaEmbeddingSchema: async () => undefined }));

describe.skipIf(!URL)("écriture de l'index : garde contre un effacement concurrent", () => {
  let pool: Pool;
  const run = randomUUID().slice(0, 8);
  const [org, user, mediaId] = [randomUUID(), randomUUID(), randomUUID()];
  const input = { mediaId, organizationId: org, uploadedBy: user, text: "contenu du média", version: 1, source: "pdf" as const };

  const embCount = async () =>
    (await pool.query(`SELECT count(*)::int AS n FROM media_embeddings WHERE media_id = $1`, [mediaId])).rows[0].n;

  beforeAll(async () => {
    process.env.DATABASE_URL = URL;
    pool = new Pool({ connectionString: URL });
    await pool.query(`INSERT INTO users (id, email, name) VALUES ($1,$2,'u')`, [user, `wg-${run}@test.fr`]);
    await pool.query(`INSERT INTO organizations (id, slug, name) VALUES ($1,$2,'W')`, [org, `w-${run}`]);
    await pool.query(
      `INSERT INTO media (id, organization_id, filename, mime_type, kind, size_bytes, storage_key, uploaded_by)
       VALUES ($1,$2,'w.pdf','application/pdf','pdf',100,$3,$4)`,
      [mediaId, org, `wg/${run}`, user],
    );
  });

  beforeEach(async () => {
    await pool.query(`DELETE FROM media_texts WHERE media_id = $1`, [mediaId]);
  });

  afterAll(async () => {
    await pool.query(`DELETE FROM organizations WHERE id = $1`, [org]);
    await pool.query(`DELETE FROM users WHERE id = $1`, [user]);
    await pool.end();
  });

  const seed = (status: string) =>
    pool.query(`INSERT INTO media_texts (media_id, organization_id, status, version) VALUES ($1,$2,$3,1)`, [mediaId, org, status]);

  it("ligne running : les vecteurs sont écrits", async () => {
    await seed("running");
    const { writeMediaIndex } = await import("@/lib/media/ai/index-media");
    expect(await writeMediaIndex(input)).toMatchObject({ ok: true });
    expect(await embCount()).toBe(1);
  });

  it("index effacé pendant le calcul : rien n'est réinséré", async () => {
    const { writeMediaIndex } = await import("@/lib/media/ai/index-media");
    expect(await writeMediaIndex(input)).toMatchObject({ ok: false, reason: "stale" });
    expect(await embCount()).toBe(0);
  });

  it("ligne remise en pending : rien n'est écrit", async () => {
    await seed("pending");
    const { writeMediaIndex } = await import("@/lib/media/ai/index-media");
    expect(await writeMediaIndex(input)).toMatchObject({ ok: false, reason: "stale" });
    expect(await embCount()).toBe(0);
  });

  it("la clé étrangère refuse un vecteur sans ligne media_texts et supprime en cascade", async () => {
    await expect(
      pool.query(`INSERT INTO media_embeddings (media_id, organization_id, chunk_index, chunk_text, model) VALUES ($1,$2,0,'x','m')`, [mediaId, org]),
    ).rejects.toThrow(/foreign key/i);
    await seed("done");
    await pool.query(`INSERT INTO media_embeddings (media_id, organization_id, chunk_index, chunk_text, model) VALUES ($1,$2,0,'x','m')`, [mediaId, org]);
    await pool.query(`DELETE FROM media_texts WHERE media_id = $1`, [mediaId]);
    expect(await embCount()).toBe(0);
  });
});
