import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { setupActivationFixture } from "./crm-fixture";

const URL = process.env.RELATIONS_TEST_DATABASE_URL;

describe.skipIf(!URL)("fixture-integration (rh_l6_act_fixture)", () => {
  let fx: Awaited<ReturnType<typeof setupActivationFixture>>;
  beforeAll(async () => {
    fx = await setupActivationFixture(URL!, "rh_l6_act_fixture");
  });
  afterAll(async () => {
    await fx?.teardown();
  });

  it("seedDatabase insère les colonnes dans l'ordre avec position croissante", async () => {
    const orgId = await fx.seedOrg("Org A");
    const spaceId = await fx.seedSpace(orgId, { name: "Espace", ownerUserId: null });
    const dbId = await fx.seedDatabase(spaceId, "Contacts", [
      { name: "Nom", type: "text" },
      { name: "Statut", type: "select", config: { options: [{ id: "a", label: "A" }] } },
      { name: "Email", type: "email" },
    ]);
    const { rows } = await fx.pool.query(
      "SELECT name, position, config FROM user_database_columns WHERE database_id = $1 ORDER BY position",
      [dbId],
    );
    expect(rows.map((r) => r.name)).toEqual(["Nom", "Statut", "Email"]);
    const positions = rows.map((r) => r.position as number);
    expect(positions[0]).toBeLessThan(positions[1]);
    expect(positions[1]).toBeLessThan(positions[2]);
    expect(rows[1].config).toEqual({ options: [{ id: "a", label: "A" }] });
  });

  it("deux organisations ne partagent aucun espace", async () => {
    const a = await fx.seedOrg("Org X");
    const b = await fx.seedOrg("Org Y");
    const sa = await fx.seedSpace(a, { name: "Sa", ownerUserId: null });
    const sb = await fx.seedSpace(b, { name: "Sb", ownerUserId: null });
    const { rows } = await fx.pool.query(
      "SELECT id FROM spaces WHERE organization_id = $1",
      [a],
    );
    expect(rows.map((r) => r.id)).toEqual([sa]);
    expect(rows.map((r) => r.id)).not.toContain(sb);
  });

  it("expose user_database_views et space_permissions", async () => {
    const { rows } = await fx.pool.query(
      "SELECT to_regclass('user_database_views') v, to_regclass('space_permissions') p",
    );
    expect(rows[0].v).not.toBeNull();
    expect(rows[0].p).not.toBeNull();
  });
});
