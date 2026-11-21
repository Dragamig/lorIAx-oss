import { randomUUID } from "node:crypto";
import { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

const URL = process.env.MEDIA_MIGRATION_TEST_DATABASE_URL;
const h = vi.hoisted(() => ({ orgId: "" }));
vi.mock("@/lib/org/get-request-org", () => ({ getRequestOrgId: () => Promise.resolve(h.orgId) }));

describe.skipIf(!URL)("visibilité de la médiathèque contre le résolveur", () => {
  let pool: Pool;
  const run = randomUUID().slice(0, 8);
  const org = randomUUID();
  const otherOrg = randomUUID();
  const spaceA = randomUUID(); // lisible par viewer et editor
  const spaceB = randomUUID(); // non lisible
  const otherSpace = randomUUID();
  const users = {
    viewer: randomUUID(),
    editor: randomUUID(),
    orgAdmin: randomUUID(),
    author: randomUUID(),
    stranger: randomUUID(),
  };
  const mediaIds: Record<string, string> = {};

  async function insertMedia(key: string, o: { org?: string; space?: string | null; by: string; deleted?: boolean; folder?: string }) {
    const id = randomUUID();
    mediaIds[key] = id;
    await pool.query(
      `INSERT INTO media (id, organization_id, space_id, filename, mime_type, kind, size_bytes, storage_key, uploaded_by, deleted_at)
       VALUES ($1,$2,$3,$4,'image/png','image',10,$5,$6,$7)`,
      [id, o.org ?? org, o.space ?? null, `${key}.png`, `it/${run}/${key}`, o.by, o.deleted ? new Date() : null]
    );
  }

  beforeAll(async () => {
    process.env.DATABASE_URL = URL;
    pool = new Pool({ connectionString: URL });
    for (const [name, id] of Object.entries(users)) {
      await pool.query(`INSERT INTO users (id, email, name) VALUES ($1,$2,$3)`, [id, `${name}-${run}@test.fr`, name]);
    }
    await pool.query(`INSERT INTO organizations (id, slug, name) VALUES ($1,$2,'O'),($3,$4,'O2')`, [org, `o-${run}`, otherOrg, `o2-${run}`]);
    for (const [n, id, role] of [
      ["viewer", users.viewer, "member"], ["editor", users.editor, "member"],
      ["orgAdmin", users.orgAdmin, "admin"], ["author", users.author, "member"],
    ] as const) {
      void n;
      await pool.query(`INSERT INTO organization_members (organization_id, user_id, role) VALUES ($1,$2,$3)`, [org, id, role]);
    }
    for (const [id, o, slug] of [[spaceA, org, "a"], [spaceB, org, "b"], [otherSpace, otherOrg, "x"]] as const) {
      await pool.query(
        `INSERT INTO spaces (id, name, slug, type, git_repo_path, organization_id) VALUES ($1,$2,$3,'team','/tmp/x',$4)`,
        [id, slug, `${slug}-${run}`, o]
      );
    }
    await pool.query(
      `INSERT INTO space_permissions (space_id, user_id, level) VALUES ($1,$2,'viewer'),($1,$3,'editor')`,
      [spaceA, users.viewer, users.editor]
    );
    await insertMedia("a-live", { space: spaceA, by: users.author });
    await insertMedia("a-trash", { space: spaceA, by: users.author, deleted: true });
    await insertMedia("b-live", { space: spaceB, by: users.author });
    await insertMedia("b-trash", { space: spaceB, by: users.author, deleted: true });
    await insertMedia("orphan-author", { by: users.author });
    await insertMedia("orphan-author-trash", { by: users.author, deleted: true });
    await insertMedia("orphan-viewer", { by: users.viewer });
    await insertMedia("other-org", { org: otherOrg, space: otherSpace, by: users.author });
    h.orgId = org;
  });

  afterAll(async () => {
    await pool.query("DELETE FROM media WHERE storage_key LIKE $1", [`it/${run}/%`]);
    await pool.query("DELETE FROM space_permissions WHERE space_id = ANY($1)", [[spaceA, spaceB, otherSpace]]);
    await pool.query("DELETE FROM spaces WHERE id = ANY($1)", [[spaceA, spaceB, otherSpace]]);
    await pool.query("DELETE FROM organization_members WHERE organization_id = ANY($1)", [[org, otherOrg]]);
    await pool.query("DELETE FROM organizations WHERE id = ANY($1)", [[org, otherOrg]]);
    await pool.query("DELETE FROM users WHERE id = ANY($1)", [Object.values(users)]);
    await pool.end();
  });

  const sessionUser = (id: string) =>
    ({ id, email: "", name: "", globalRole: "user", capabilities: [] }) as never;

  async function visibleIds(userId: string, view: "all" | "trash") {
    const { listMedia } = await import("@/lib/media/list");
    const { parseMediaFilters } = await import("@/lib/media/filters");
    const f = parseMediaFilters(new URLSearchParams(`view=${view}&limit=100`));
    const { items } = await listMedia(sessionUser(userId), org, f);
    return new Set(items.map((i) => i.id));
  }

  it("listMedia contient un média si et seulement si le résolveur accorde la lecture", async () => {
    const { resolveMediaAccess } = await import("@/lib/media/access");
    for (const [name, uid] of Object.entries(users)) {
      const live = await visibleIds(uid, "all");
      const trash = await visibleIds(uid, "trash");
      for (const [key, id] of Object.entries(mediaIds)) {
        const [row] = (
          await pool.query(
            `SELECT id, organization_id AS "organizationId", space_id AS "spaceId", uploaded_by AS "uploadedBy",
                    deleted_at AS "deletedAt", origin, mime_type AS "mimeType" FROM media WHERE id = $1`,
            [id]
          )
        ).rows;
        const verdict = await resolveMediaAccess(sessionUser(uid), row, "read");
        const inList = row.deletedAt ? trash.has(id) : live.has(id);
        expect(inList, `${name} / ${key}`).toBe(verdict.allowed);
        // Une vue ne montre jamais l'autre moitié.
        expect(row.deletedAt ? live.has(id) : trash.has(id), `${name} / ${key} croisé`).toBe(false);
      }
    }
  });

  it("un lecteur sans accès à l'espace B ne voit ni le média ni la corbeille de B", async () => {
    const ids = await visibleIds(users.viewer, "all");
    expect(ids.has(mediaIds["b-live"])).toBe(false);
    expect(ids.has(mediaIds["a-live"])).toBe(true);
    expect((await visibleIds(users.viewer, "trash")).has(mediaIds["a-trash"])).toBe(false);
    expect((await visibleIds(users.editor, "trash")).has(mediaIds["a-trash"])).toBe(true);
  });

  it("les statistiques n'incluent pas un média invisible", async () => {
    const { getLibraryStats } = await import("@/lib/media/list");
    // viewer : a-live + son média hors espace ; corbeille vide (il n'écrit pas dans A).
    const v = await getLibraryStats(sessionUser(users.viewer), org);
    expect(v.total).toBe(2);
    expect(v.orphan).toBe(1);
    expect(v.trash).toBe(0);
    // admin d'organisation : les deux médias hors espace, aucun espace lisible sans permission.
    const a = await getLibraryStats(sessionUser(users.orgAdmin), org);
    expect(a.total).toBe(2);
    expect(a.trash).toBe(1); // orphan-author-trash
    const e = await getLibraryStats(sessionUser(users.editor), org);
    expect(e.total).toBe(1);
    expect(e.trash).toBe(1);
  });
});
