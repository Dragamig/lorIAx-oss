import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { CRM_MIGRATION_PATH, setupCrmFixture } from "./crm-fixture";

const URL = process.env.RELATIONS_TEST_DATABASE_URL;

describe.skipIf(!URL)("migration 0060 crm_connections (Postgres)", () => {
  let fx: Awaited<ReturnType<typeof setupCrmFixture>>;

  beforeAll(async () => {
    fx = await setupCrmFixture(URL!, "rh_l6_migration");
  });
  afterAll(async () => {
    await fx?.teardown();
  });

  async function seed() {
    const orgId = randomUUID();
    const spaceId = randomUUID();
    const dbId = randomUUID();
    await fx.pool.query("INSERT INTO organizations (id) VALUES ($1)", [orgId]);
    await fx.pool.query("INSERT INTO spaces (id, organization_id) VALUES ($1, $2)", [spaceId, orgId]);
    await fx.pool.query("INSERT INTO user_databases (id, space_id) VALUES ($1, $2)", [dbId, spaceId]);
    await fx.pool.query(
      "INSERT INTO crm_connections (organization_id, contacts_database_id) VALUES ($1, $2)",
      [orgId, dbId],
    );
    return { orgId, dbId };
  }

  it("0060 appliquée deux fois : idempotente", async () => {
    await expect(fx.pool.query(readFileSync(CRM_MIGRATION_PATH, "utf8"))).resolves.toBeDefined();
  });

  it("supprimer une base raccordée met le rôle à null sans supprimer la ligne", async () => {
    const { orgId, dbId } = await seed();
    await fx.pool.query("DELETE FROM user_databases WHERE id = $1", [dbId]);
    const { rows } = await fx.pool.query(
      "SELECT contacts_database_id FROM crm_connections WHERE organization_id = $1",
      [orgId],
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].contacts_database_id).toBeNull();
  });

  it("supprimer l'organisation supprime la ligne", async () => {
    const { orgId } = await seed();
    await fx.pool.query("DELETE FROM crm_connections WHERE organization_id = $1", [orgId]);
    await fx.pool.query("INSERT INTO crm_connections (organization_id) VALUES ($1)", [orgId]);
    await fx.pool.query("DELETE FROM organizations WHERE id = $1", [orgId]);
    const { rows } = await fx.pool.query(
      "SELECT 1 FROM crm_connections WHERE organization_id = $1",
      [orgId],
    );
    expect(rows).toHaveLength(0);
  });
});
