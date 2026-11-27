import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { randomUUID } from "node:crypto";
import type { PermissionLevel } from "@/types";
import { enableTemplateTables, setupActivationFixture } from "./crm-fixture";
import { loadTemplateMessages } from "../template-messages";
import { activateCrm } from "../activation";

const h = vi.hoisted(() => ({ db: undefined as unknown }));
vi.mock("@/lib/db", () => ({
  db: new Proxy({}, { get: (_t, k) => (h.db as Record<string | symbol, unknown>)[k] }),
}));
vi.mock("@/lib/settings/system-settings", () => ({ getSetting: vi.fn(async () => null), setSetting: vi.fn() }));
vi.mock("@/lib/spaces/create-space", async (orig) => ({
  ...(await orig<typeof import("@/lib/spaces/create-space")>()),
  assertSpaceQuota: vi.fn(async () => ({ exceeded: false, current: 0, max: null })),
  afterSpaceCreated: vi.fn(async () => ({ gitOk: true })),
}));

import { dispatchRowEvents } from "@/lib/automations/dispatch-row-events";

const URL = process.env.RELATIONS_TEST_DATABASE_URL;

describe.skipIf(!URL)("exemple activé déclenché par une écriture CRM (Postgres)", () => {
  let fx: Awaited<ReturnType<typeof setupActivationFixture>>;
  const ORG = randomUUID();
  const USER = randomUUID();

  beforeAll(async () => {
    fx = await setupActivationFixture(URL!, "rh_l8_sample_trigger");
    await enableTemplateTables(fx.pool);
    h.db = fx.db;
    await fx.pool.query("ALTER TABLE users ADD COLUMN IF NOT EXISTS global_role text NOT NULL DEFAULT 'user'");
    await fx.pool.query("INSERT INTO organizations (id, slug, name) VALUES ($1,'t','T')", [ORG]);
    await fx.pool.query("INSERT INTO users (id) VALUES ($1)", [USER]);
  });
  afterAll(async () => {
    await fx?.teardown();
  });

  it("(8) wonClose activé : un changement de Statut vers Gagnée lance une seule exécution", async () => {
    const m = await loadTemplateMessages("fr");
    const sp = await fx.seedSpace(ORG, { name: "Déclencheur", ownerUserId: USER });
    const deps = { executor: fx.db, permissionOf: async (): Promise<PermissionLevel | null> => "editor" };
    const roles = { contacts: { mode: "create" as const }, dossiers: { mode: "create" as const }, interactions: { mode: "create" as const } };
    const r = await activateCrm(ORG, USER, { v2: { space: { mode: "existing", spaceId: sp }, roles }, locale: "fr" }, deps);
    expect(r).toMatchObject({ ok: true });

    const [conn] = (await fx.pool.query("SELECT * FROM crm_connections WHERE organization_id = $1", [ORG])).rows;
    const dossiers = conn.deals_database_id as string;
    const statut = conn.field_map.dossiers.statut as string;
    const won = (await fx.pool.query("SELECT id FROM automations WHERE database_id=$1 AND name=$2", [dossiers, m.automations.wonClose.name])).rows[0].id as string;
    await fx.pool.query("UPDATE automations SET enabled = true WHERE id = $1", [won]);

    const before = { [statut]: m.statusOptions[0] };
    const after = { [statut]: m.statusOptions[6] };
    const { rows } = await fx.pool.query(
      "INSERT INTO user_database_rows (database_id, cells) VALUES ($1,$2) RETURNING id",
      [dossiers, JSON.stringify(before)],
    );
    dispatchRowEvents({ databaseId: dossiers, rowId: rows[0].id, before, after });

    await vi.waitFor(async () => {
      const n = (await fx.pool.query("SELECT count(*)::int AS n FROM automation_runs WHERE automation_id = $1", [won])).rows[0].n;
      expect(n).toBe(1);
    }, { timeout: 5000 });
    await new Promise((res) => setTimeout(res, 300));
    const runs = (await fx.pool.query("SELECT automation_id, status, error_message FROM automation_runs")).rows;
    expect(runs).toHaveLength(1);
    expect(runs[0].automation_id).toBe(won);
    expect(runs[0].status).toBe("success");
  });
});
