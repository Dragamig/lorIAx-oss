import { randomUUID } from "node:crypto";
import { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const URL = process.env.MEDIA_MIGRATION_TEST_DATABASE_URL;

describe.skipIf(!URL)("index IA des médias : isolation entre organisations", () => {
  let pool: Pool;
  const run = randomUUID().slice(0, 8);
  const [orgA, orgB, user] = [randomUUID(), randomUUID(), randomUUID()];
  const m: Record<string, string> = {};

  async function addMedia(key: string, org: string, kind: string, deleted = false) {
    const id = randomUUID();
    m[key] = id;
    await pool.query(
      `INSERT INTO media (id, organization_id, filename, mime_type, kind, size_bytes, storage_key, uploaded_by, deleted_at)
       VALUES ($1,$2,$3,'application/pdf',$4,40000,$5,$6,$7)`,
      [id, org, `${key}.pdf`, kind, `ai/${run}/${key}`, user, deleted ? new Date() : null],
    );
    await pool.query(
      `INSERT INTO media_texts (media_id, organization_id, status) VALUES ($1,$2,'done')`,
      [id, org],
    );
    await pool.query(
      `INSERT INTO media_embeddings (media_id, organization_id, chunk_index, chunk_text, model) VALUES ($1,$2,0,'x','m')`,
      [id, org],
    );
  }

  beforeAll(async () => {
    process.env.DATABASE_URL = URL;
    pool = new Pool({ connectionString: URL });
    await pool.query(`INSERT INTO users (id, email, name) VALUES ($1,$2,'u')`, [user, `ai-${run}@test.fr`]);
    await pool.query(`INSERT INTO organizations (id, slug, name) VALUES ($1,$2,'A'),($3,$4,'B')`, [orgA, `a-${run}`, orgB, `b-${run}`]);
    await addMedia("a1", orgA, "pdf");
    await addMedia("a-trash", orgA, "pdf", true);
    await addMedia("a-archive", orgA, "archive");
    await addMedia("b1", orgB, "pdf");
  });

  afterAll(async () => {
    await pool.query(`DELETE FROM organizations WHERE id IN ($1,$2)`, [orgA, orgB]);
    await pool.query(`DELETE FROM users WHERE id = $1`, [user]);
    await pool.end();
  });

  it("l'estimation et les compteurs ne comptent que l'organisation, hors corbeille", async () => {
    const { getMediaAiStats } = await import("@/lib/media/ai/settings");
    const a = await getMediaAiStats(orgA);
    expect(a.estimate.media).toBe(1); // a1 seulement : corbeille et archive exclues
    expect(a.estimate.chunks).toBe(2); // 40000 / 20000
    expect(a.indexed).toBe(2); // a1 + a-archive (done, hors corbeille)
    expect((await getMediaAiStats(orgB)).estimate.media).toBe(1);
  });

  it("l'effacement supprime texte et vecteurs de l'organisation demandée seulement", async () => {
    const { clearMediaAiIndex } = await import("@/lib/media/ai/settings");
    expect(await clearMediaAiIndex(orgA)).toBe(3);
    const left = async (t: string, o: string) =>
      (await pool.query(`SELECT count(*)::int AS n FROM ${t} WHERE organization_id = $1`, [o])).rows[0].n;
    expect(await left("media_texts", orgA)).toBe(0);
    expect(await left("media_embeddings", orgA)).toBe(0);
    expect(await left("media_texts", orgB)).toBe(1);
    expect(await left("media_embeddings", orgB)).toBe(1);
  });

  it("supprimer un média supprime en cascade son texte et ses vecteurs", async () => {
    await pool.query(`DELETE FROM media WHERE id = $1`, [m.b1]);
    const n = (await pool.query(`SELECT (SELECT count(*) FROM media_texts WHERE media_id=$1)::int + (SELECT count(*) FROM media_embeddings WHERE media_id=$1)::int AS n`, [m.b1])).rows[0].n;
    expect(n).toBe(0);
  });
});
