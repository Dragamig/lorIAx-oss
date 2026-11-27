import { randomUUID } from "node:crypto";
import { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

const URL = process.env.MEDIA_MIGRATION_TEST_DATABASE_URL;
const h = vi.hoisted(() => ({ orgId: "" }));
vi.mock("@/lib/org/get-request-org", () => ({ getRequestOrgId: () => Promise.resolve(h.orgId) }));

describe.skipIf(!URL)("liens original et retouches filtrés par la lecture", () => {
  let pool: Pool;
  const run = randomUUID().slice(0, 8);
  const org = randomUUID();
  const spaceA = randomUUID(); // lisible par le lecteur
  const spaceB = randomUUID(); // non lisible
  const u = { reader: randomUUID(), author: randomUUID() };
  const id: Record<string, string> = {};

  async function insert(key: string, o: { space: string | null; by: string; source?: string; deleted?: boolean }) {
    id[key] = randomUUID();
    await pool.query(
      `INSERT INTO media (id, organization_id, space_id, filename, mime_type, kind, size_bytes, storage_key, uploaded_by, source_media_id, deleted_at)
       VALUES ($1,$2,$3,$4,'image/png','image',10,$5,$6,$7,$8)`,
      [id[key], org, o.space, `${key}.png`, `it/${run}/${key}`, o.by, o.source ? id[o.source] : null, o.deleted ? new Date() : null],
    );
  }

  beforeAll(async () => {
    process.env.DATABASE_URL = URL;
    pool = new Pool({ connectionString: URL });
    for (const [name, uid] of Object.entries(u)) {
      await pool.query(`INSERT INTO users (id, email, name) VALUES ($1,$2,$3)`, [uid, `${name}-${run}@test.fr`, name]);
    }
    await pool.query(`INSERT INTO organizations (id, slug, name) VALUES ($1,$2,'O')`, [org, `o-${run}`]);
    for (const uid of Object.values(u)) {
      await pool.query(`INSERT INTO organization_members (organization_id, user_id, role) VALUES ($1,$2,'member')`, [org, uid]);
    }
    for (const [sid, slug] of [[spaceA, "a"], [spaceB, "b"]] as const) {
      await pool.query(
        `INSERT INTO spaces (id, name, slug, type, git_repo_path, organization_id) VALUES ($1,$2,$3,'team','/tmp/x',$4)`,
        [sid, slug, `${slug}-${run}`, org],
      );
    }
    await pool.query(`INSERT INTO space_permissions (space_id, user_id, level) VALUES ($1,$2,'viewer')`, [spaceA, u.reader]);
    await insert("orig-a", { space: spaceA, by: u.author });
    await insert("orig-b", { space: spaceB, by: u.author });
    await insert("orig-gone", { space: spaceA, by: u.author, deleted: true });
    await insert("der-a1", { space: spaceA, by: u.author, source: "orig-a" });
    await insert("der-a2", { space: spaceA, by: u.author, source: "orig-a" });
    await insert("der-b", { space: spaceB, by: u.author, source: "orig-a" });
    await insert("der-trash", { space: spaceA, by: u.author, source: "orig-a", deleted: true });
    await insert("der-of-b", { space: spaceA, by: u.author, source: "orig-b" });
    await insert("der-of-gone", { space: spaceA, by: u.author, source: "orig-gone" });
    h.orgId = org;
  });

  afterAll(async () => {
    await pool.query("DELETE FROM media WHERE storage_key LIKE $1", [`it/${run}/%`]);
    await pool.query("DELETE FROM space_permissions WHERE space_id = ANY($1)", [[spaceA, spaceB]]);
    await pool.query("DELETE FROM spaces WHERE id = ANY($1)", [[spaceA, spaceB]]);
    await pool.query("DELETE FROM organization_members WHERE organization_id = $1", [org]);
    await pool.query("DELETE FROM organizations WHERE id = $1", [org]);
    await pool.query("DELETE FROM users WHERE id = ANY($1)", [Object.values(u)]);
    await pool.end();
  });

  const reader = () => ({ id: u.reader, email: "", name: "", globalRole: "user", capabilities: [] }) as never;
  const links = async (key: string, sourceKey?: string) => {
    const { getRetouchLinks } = await import("@/lib/media/list");
    return getRetouchLinks(reader(), org, { id: id[key], sourceMediaId: sourceKey ? id[sourceKey] : null });
  };

  it("original : ne compte que les retouches lisibles (ni espace fermé, ni corbeille)", async () => {
    const r = await links("orig-a");
    expect(r.retouchedFrom).toBeNull();
    expect(r.retouches.map((x) => x.id).sort()).toEqual([id["der-a1"], id["der-a2"]].sort());
  });

  it("dérivé : lien nommé quand l'original est lisible", async () => {
    const r = await links("der-a1", "orig-a");
    expect(r.retouchedFrom).toMatchObject({ readable: true, id: id["orig-a"], name: "orig-a.png" });
  });

  it("dérivé : mention neutre sans nom quand l'original n'est pas lisible", async () => {
    const r = await links("der-of-b", "orig-b");
    expect(r.retouchedFrom).toEqual({ readable: false });
    expect(JSON.stringify(r)).not.toContain("orig-b");
  });

  it("original en corbeille : aucune ligne", async () => {
    expect((await links("der-of-gone", "orig-gone")).retouchedFrom).toBeNull();
  });
});
