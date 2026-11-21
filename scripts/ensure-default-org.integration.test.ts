/**
 * Organisation par defaut sur base vide, contre une base de test dediee, dans un schema prive par cas.
 * Requiert MEDIA_TEST_DATABASE_URL (nom de base contenant "test").
 */
import { randomUUID } from "node:crypto";
import { Pool } from "pg";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { ensureDefaultOrganization } from "./ensure-default-org";

const URL_ = process.env.MEDIA_TEST_DATABASE_URL;
const DB_NAME = URL_ ? new URL(URL_).pathname.replace(/^\//, "") : "";
if (URL_ && !DB_NAME.includes("test")) {
  throw new Error(`MEDIA_TEST_DATABASE_URL doit viser une base de test, recu "${DB_NAME}"`);
}

const DDL = `
  CREATE TABLE organizations (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    slug varchar(100) UNIQUE NOT NULL,
    name varchar(255) NOT NULL,
    is_active boolean NOT NULL DEFAULT true,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now()
  );
`;

describe.skipIf(!URL_)("ensureDefaultOrganization (base de test)", () => {
  let admin: Pool;
  let pool: Pool;
  let schema = "";
  let connectionString = "";

  beforeAll(() => {
    admin = new Pool({ connectionString: URL_ });
  });

  beforeEach(async () => {
    schema = `deforg_${randomUUID().replace(/-/g, "").slice(0, 12)}`;
    await admin.query(`CREATE SCHEMA ${schema}`);
    const u = new URL(URL_!);
    u.searchParams.set("options", `-c search_path=${schema}`);
    connectionString = u.toString();
    pool = new Pool({ connectionString });
    await pool.query(DDL);
    return async () => {
      await pool.end();
      await admin.query(`DROP SCHEMA ${schema} CASCADE`);
    };
  });

  afterAll(async () => {
    await admin.end();
  });

  const count = async () => Number((await pool.query("SELECT count(*) FROM organizations")).rows[0].count);

  it("creates_default_org_on_empty_database", async () => {
    const res = await ensureDefaultOrganization(pool);
    expect(res.created).toBe(true);
    const { rows } = await pool.query("SELECT id, name, slug FROM organizations");
    expect(rows).toEqual([{ id: res.id, name: "Organisation", slug: "default" }]);
  });

  it("is_idempotent_on_second_call", async () => {
    const first = await ensureDefaultOrganization(pool);
    const second = await ensureDefaultOrganization(pool);
    expect(second).toEqual({ id: first.id, created: false });
    expect(await count()).toBe(1);
  });

  it("get_default_org_id_resolves_after_init", async () => {
    vi.resetModules();
    const previous = process.env.DATABASE_URL;
    process.env.DATABASE_URL = connectionString;
    try {
      const { getDefaultOrgId } = await import("@/lib/org/get-org-id");
      const { id } = await ensureDefaultOrganization(pool);
      await expect(getDefaultOrgId()).resolves.toBe(id);
    } finally {
      if (previous === undefined) delete process.env.DATABASE_URL;
      else process.env.DATABASE_URL = previous;
    }
  });

  it("does_not_touch_existing_orgs", async () => {
    const { rows } = await pool.query("INSERT INTO organizations (slug, name) VALUES ('x', 'x') RETURNING id");
    const res = await ensureDefaultOrganization(pool);
    expect(res).toEqual({ id: rows[0].id, created: false });
    expect(await count()).toBe(1);
  });
});
