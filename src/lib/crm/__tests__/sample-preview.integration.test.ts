/**
 * Aperçu des automatismes d'exemple contre la vraie base : même règle que l'insertion, aucun effet de bord.
 */
import { describe, it, expect, vi, beforeAll, afterAll, beforeEach } from "vitest";
import { randomUUID } from "node:crypto";
import type { PermissionLevel } from "@/types";
import { enableTemplateTables, setupActivationFixture } from "./crm-fixture";
import { loadTemplateMessages } from "../template-messages";
import { activateCrm } from "../activation";
import { previewSampleAutomations } from "../preview";
import type { CrmDeps } from "../connection";

vi.mock("@/lib/logger", () => ({ default: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() } }));
vi.mock("@/lib/spaces/create-space", async (orig) => ({
  ...(await orig<typeof import("@/lib/spaces/create-space")>()),
  assertSpaceQuota: vi.fn(async () => ({ exceeded: false, current: 1, max: 1 })),
  afterSpaceCreated: vi.fn(async () => ({ gitOk: true })),
}));

const URL = process.env.RELATIONS_TEST_DATABASE_URL;

describe.skipIf(!URL)("aperçu des automatismes d'exemple (Postgres)", () => {
  let fx: Awaited<ReturnType<typeof setupActivationFixture>>;
  const ORG = randomUUID();
  const ADMIN = randomUUID();
  const permissionOf = vi.fn(async (_u: string, _s: string): Promise<PermissionLevel | null> => "editor");
  let deps: CrmDeps;
  let m: Awaited<ReturnType<typeof loadTemplateMessages>>;

  const count = async (sql: string, params: unknown[] = []) => (await fx.pool.query(sql, params)).rows[0].n as number;

  beforeAll(async () => {
    fx = await setupActivationFixture(URL!, "rh_l8_sample_preview");
    await enableTemplateTables(fx.pool);
    deps = { executor: fx.db, permissionOf };
    m = await loadTemplateMessages("fr");
    await fx.pool.query("INSERT INTO organizations (id, slug, name) VALUES ($1,'p','P')", [ORG]);
    await fx.pool.query("INSERT INTO users (id) VALUES ($1)", [ADMIN]);
  });
  afterAll(async () => {
    await fx?.teardown();
  });
  beforeEach(async () => {
    await fx.pool.query("DELETE FROM automations");
    await fx.pool.query("DELETE FROM crm_connections");
  });

  it("sans raccordement : tout est sauté, rien à créer", async () => {
    const p = await previewSampleAutomations(ORG, ADMIN, m, deps);
    expect(p.toCreate).toEqual([]);
    expect(p.skipped.map((s) => s.key)).toHaveLength(6);
    expect(p.statusOptionsToAdd).toEqual([]);
  });

  it("même règle que l'insertion, noms localisés, aucun effet de bord", async () => {
    const sp = await fx.seedSpace(ORG, { name: "Prev", ownerUserId: ADMIN });
    const existing = [m.statusOptions[0], m.statusOptions[7], "Mon statut"];
    const db = await fx.seedDatabase(sp, "Dossiers prev", [
      { name: "Titre", type: "text" },
      { name: "Statut", type: "select", config: { options: existing } },
    ]);
    const body = {
      v2: { space: { mode: "existing" as const, spaceId: sp }, roles: { dossiers: { mode: "complete" as const, databaseId: db } } },
      locale: "fr",
    };
    const first = await activateCrm(ORG, ADMIN, body, deps);
    expect(first.ok).toBe(true);
    // Retour à un état où seule waitingFollowUp est connue, et où ses options de Statut ont disparu.
    await fx.pool.query("DELETE FROM automations");
    await fx.pool.query("UPDATE crm_connections SET created_automation_keys = $1 WHERE organization_id = $2", [
      JSON.stringify(["waitingFollowUp"]),
      ORG,
    ]);
    await fx.pool.query("UPDATE user_database_columns SET config = $1 WHERE database_id = $2 AND name = 'Statut'", [
      JSON.stringify({ options: existing }),
      db,
    ]);

    const optionsOf = async () =>
      (await fx.pool.query("SELECT config->'options' AS o FROM user_database_columns WHERE database_id=$1 AND name='Statut'", [db])).rows[0].o;
    const autos0 = await count("SELECT count(*)::int AS n FROM automations");
    const opts0 = await optionsOf();
    const keys0 = (await fx.pool.query("SELECT created_automation_keys AS k FROM crm_connections")).rows[0].k;

    const p = await previewSampleAutomations(ORG, ADMIN, m, deps);

    expect(await count("SELECT count(*)::int AS n FROM automations")).toBe(autos0);
    expect(await optionsOf()).toEqual(opts0);
    expect((await fx.pool.query("SELECT created_automation_keys AS k FROM crm_connections")).rows[0].k).toEqual(keys0);

    expect(p.toCreate.map((c) => c.key)).toEqual(["lostClose"]);
    expect(p.toCreate[0].name).toBe(m.automations.lostClose.name);
    expect(p.statusOptionsToAdd).toEqual([m.statusOptions[8]]);
    expect(p.skipped.map((s) => s.key)).not.toContain("waitingFollowUp");
    expect(p.skipped.find((s) => s.key === "quoteFollowUp")?.name).toBe(m.automations.quoteFollowUp.name);

    // L'insertion réelle fait exactement ce que l'aperçu annonçait.
    const again = await activateCrm(ORG, ADMIN, { locale: "fr" }, deps);
    expect(again).toMatchObject({
      ok: true,
      automationsCreated: p.toCreate.map((c) => c.key),
      statusOptionsAdded: p.statusOptionsToAdd,
    });
  });
});
