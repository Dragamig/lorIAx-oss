import { randomUUID } from "node:crypto";
import { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const URL = process.env.MEDIA_MIGRATION_TEST_DATABASE_URL;

describe.skipIf(!URL)("réindexation du modèle : médias des organisations désactivées", () => {
  let pool: Pool;
  const run = randomUUID().slice(0, 8);
  const [orgOn, orgOff, user] = [randomUUID(), randomUUID(), randomUUID()];
  const ids = { on: randomUUID(), off: randomUUID() };

  beforeAll(async () => {
    process.env.DATABASE_URL = URL;
    pool = new Pool({ connectionString: URL });
    await pool.query(`INSERT INTO users (id, email, name) VALUES ($1,$2,'u')`, [user, `rx-${run}@test.fr`]);
    await pool.query(`INSERT INTO organizations (id, slug, name) VALUES ($1,$2,'On'),($3,$4,'Off')`, [orgOn, `on-${run}`, orgOff, `off-${run}`]);
    await pool.query(`INSERT INTO media_ai_settings (organization_id, index_enabled) VALUES ($1,true)`, [orgOn]);
    for (const [key, org] of [["on", orgOn], ["off", orgOff]] as const) {
      await pool.query(
        `INSERT INTO media (id, organization_id, filename, mime_type, kind, size_bytes, storage_key, uploaded_by)
         VALUES ($1,$2,$3,'application/pdf','pdf',1000,$4,$5)`,
        [ids[key], org, `${key}.pdf`, `rx/${run}/${key}`, user],
      );
      await pool.query(`INSERT INTO media_texts (media_id, organization_id, status, text) VALUES ($1,$2,'done','t')`, [ids[key], org]);
      await pool.query(
        `INSERT INTO media_embeddings (media_id, organization_id, chunk_index, chunk_text, model) VALUES ($1,$2,0,'x','m')`,
        [ids[key], org],
      );
    }
  });

  afterAll(async () => {
    await pool.query(`DELETE FROM organizations WHERE id IN ($1,$2)`, [orgOn, orgOff]);
    await pool.query(`DELETE FROM users WHERE id = $1`, [user]);
    await pool.end();
  });

  it("vide les vecteurs de toutes les organisations et remet en pending le texte de l'organisation désactivée", async () => {
    const { resetMediaEmbeddings } = await import("@/lib/ai/embedding-reindex");
    await resetMediaEmbeddings();
    const emb = (await pool.query(`SELECT count(*)::int AS n FROM media_embeddings WHERE media_id = ANY($1)`, [[ids.on, ids.off]])).rows[0].n;
    expect(emb).toBe(0);
    const st = async (id: string) =>
      (await pool.query(`SELECT status, text FROM media_texts WHERE media_id = $1`, [id])).rows[0];
    expect(await st(ids.off)).toEqual({ status: "pending", text: "t" });
    // L'organisation active est remise en file par enqueueMediaIndex (hors de cette fonction).
    expect((await st(ids.on)).status).toBe("done");
  });
});
