import { randomUUID } from "node:crypto";
import { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

const URL = process.env.MEDIA_MIGRATION_TEST_DATABASE_URL;
const h = vi.hoisted(() => ({ orgId: "" }));
vi.mock("@/lib/org/get-request-org", () => ({ getRequestOrgId: () => Promise.resolve(h.orgId) }));
vi.mock("@/lib/ai/embeddings", () => ({
  isEmbeddingConfiguredAsync: () => Promise.resolve(true),
  generateEmbedding: () => Promise.resolve(vecOf(0)),
}));

const DIM = 1536;
function vecOf(axis: number): number[] {
  const v = new Array(DIM).fill(0);
  v[axis] = 1;
  return v;
}

describe.skipIf(!URL)("recherche sémantique des médias : droits dans la requête", () => {
  let pool: Pool;
  const run = randomUUID().slice(0, 8);
  const [org, otherOrg] = [randomUUID(), randomUUID()];
  const [spaceOpen, spacePrivate, spaceTeam, spaceOther] = [randomUUID(), randomUUID(), randomUUID(), randomUUID()];
  const team = randomUUID();
  const u = {
    reader: randomUUID(),
    teamMember: randomUUID(),
    orgAdmin: randomUUID(),
    author: randomUUID(),
    stranger: randomUUID(),
  };
  const m: Record<string, string> = {};

  async function add(key: string, o: { org?: string; space?: string | null; by: string; deleted?: boolean; version?: number; indexedVersion?: number; status?: string }) {
    const id = randomUUID();
    m[key] = id;
    const orgId = o.org ?? org;
    await pool.query(
      `INSERT INTO media (id, organization_id, space_id, filename, mime_type, kind, size_bytes, storage_key, uploaded_by, deleted_at, current_version)
       VALUES ($1,$2,$3,$4,'application/pdf','pdf',10,$5,$6,$7,$8)`,
      [id, orgId, o.space ?? null, `${key}.pdf`, `ais/${run}/${key}`, o.by, o.deleted ? new Date() : null, o.version ?? 1],
    );
    await pool.query(
      `INSERT INTO media_texts (media_id, organization_id, status, version) VALUES ($1,$2,$3,$4)`,
      [id, orgId, o.status ?? "done", o.indexedVersion ?? o.version ?? 1],
    );
    await pool.query(
      `INSERT INTO media_embeddings (media_id, organization_id, chunk_index, chunk_text, model, embedding)
       VALUES ($1,$2,0,$3,'m',$4::vector)`,
      [id, orgId, key, `[${vecOf(0).join(",")}]`],
    );
  }

  beforeAll(async () => {
    process.env.DATABASE_URL = URL;
    pool = new Pool({ connectionString: URL });
    for (const [name, id] of Object.entries(u)) {
      await pool.query(`INSERT INTO users (id, email, name) VALUES ($1,$2,$3)`, [id, `${name}-ais-${run}@test.fr`, name]);
    }
    await pool.query(`INSERT INTO organizations (id, slug, name) VALUES ($1,$2,'O'),($3,$4,'O2')`, [org, `o-${run}`, otherOrg, `o2-${run}`]);
    for (const [id, role] of [[u.reader, "member"], [u.teamMember, "member"], [u.orgAdmin, "admin"], [u.author, "member"]] as const) {
      await pool.query(`INSERT INTO organization_members (organization_id, user_id, role) VALUES ($1,$2,$3)`, [org, id, role]);
    }
    for (const [id, o, slug] of [[spaceOpen, org, "open"], [spacePrivate, org, "priv"], [spaceTeam, org, "team"], [spaceOther, otherOrg, "oth"]] as const) {
      await pool.query(
        `INSERT INTO spaces (id, name, slug, type, git_repo_path, organization_id) VALUES ($1,$2,$3,'team','/tmp/x',$4)`,
        [id, slug, `${slug}-${run}`, o],
      );
    }
    await pool.query(`INSERT INTO teams (id, name, organization_id) VALUES ($1,'T',$2)`, [team, org]);
    await pool.query(`INSERT INTO team_members (team_id, user_id, role) VALUES ($1,$2,'member')`, [team, u.teamMember]);
    await pool.query(
      `INSERT INTO space_permissions (space_id, user_id, level) VALUES ($1,$2,'viewer')`,
      [spaceOpen, u.reader],
    );
    await pool.query(`INSERT INTO space_permissions (space_id, team_id, level) VALUES ($1,$2,'viewer')`, [spaceTeam, team]);

    await add("open", { space: spaceOpen, by: u.author });
    await add("open-trash", { space: spaceOpen, by: u.author, deleted: true });
    await add("private", { space: spacePrivate, by: u.author });
    await add("team", { space: spaceTeam, by: u.author });
    await add("orphan-author", { by: u.author });
    await add("orphan-reader", { by: u.reader });
    await add("other-org", { org: otherOrg, space: spaceOther, by: u.author });
    await add("stale-version", { space: spaceOpen, by: u.author, version: 2, indexedVersion: 1 });
    await add("not-done", { space: spaceOpen, by: u.author, status: "pending" });
    h.orgId = org;
  });

  afterAll(async () => {
    await pool.query("DELETE FROM media WHERE storage_key LIKE $1", [`ais/${run}/%`]);
    await pool.query("DELETE FROM space_permissions WHERE space_id = ANY($1)", [[spaceOpen, spacePrivate, spaceTeam, spaceOther]]);
    await pool.query("DELETE FROM team_members WHERE team_id = $1", [team]);
    await pool.query("DELETE FROM teams WHERE id = $1", [team]);
    await pool.query("DELETE FROM spaces WHERE id = ANY($1)", [[spaceOpen, spacePrivate, spaceTeam, spaceOther]]);
    await pool.query("DELETE FROM organization_members WHERE organization_id = ANY($1)", [[org, otherOrg]]);
    await pool.query("DELETE FROM organizations WHERE id = ANY($1)", [[org, otherOrg]]);
    await pool.query("DELETE FROM users WHERE id = ANY($1)", [Object.values(u)]);
    await pool.end();
  });

  const sessionUser = (id: string) => ({ id, email: "", name: "", globalRole: "user", capabilities: [] }) as never;
  async function found(userId: string, org_: string = org) {
    const { searchMediaSemantic } = await import("@/lib/media/ai/search");
    const hits = await searchMediaSemantic(sessionUser(userId), org_, "requête", 50);
    const names = Object.fromEntries(Object.entries(m).map(([k, v]) => [v, k]));
    return new Set(hits.map((x) => names[x.mediaId]).filter(Boolean));
  }

  it("un lecteur d'un seul espace ne voit ni l'espace privé, ni une autre organisation, ni la corbeille, ni le média hors espace d'un autre", async () => {
    const r = await found(u.reader);
    expect(r).toEqual(new Set(["open", "orphan-reader"]));
  });

  it("un membre d'équipe voit l'espace accordé à son équipe seulement", async () => {
    expect(await found(u.teamMember)).toEqual(new Set(["team"]));
  });

  it("l'auteur voit ses médias hors espace, jamais l'espace privé", async () => {
    expect(await found(u.author)).toEqual(new Set(["orphan-author"]));
  });

  it("l'admin d'organisation voit les médias hors espace de l'organisation, jamais ceux d'une autre", async () => {
    const r = await found(u.orgAdmin);
    expect(r).toEqual(new Set(["orphan-author", "orphan-reader"]));
  });

  it("un étranger à l'organisation ne reçoit rien, même en demandant son identifiant", async () => {
    expect(await found(u.stranger)).toEqual(new Set());
  });

  it("ne rend ni une version non indexée ni un texte non terminé", async () => {
    const r = await found(u.reader);
    expect(r.has("stale-version")).toBe(false);
    expect(r.has("not-done")).toBe(false);
  });
});
