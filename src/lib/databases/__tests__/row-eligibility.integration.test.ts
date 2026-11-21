/**
 * Eligibilite des mentionnes et des assignes. Requiert RELATIONS_TEST_DATABASE_URL ; ignore sinon.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { randomUUID } from "crypto";
import type { Pool } from "pg";
import { setupRowTasksFixture } from "./row-tasks-fixture";
import { filterEligibleUsers, isEligibleUser, type CanView } from "../row-eligibility";
import type { DbExecutor } from "../row-writes";

const URL = process.env.RELATIONS_TEST_DATABASE_URL;
const DB_NAME = URL ? new globalThis.URL(URL).pathname.replace(/^\//, "") : "";
if (URL && !DB_NAME.includes("test")) {
  throw new Error(`RELATIONS_TEST_DATABASE_URL doit viser une base de test, reçu "${DB_NAME}"`);
}

describe.skipIf(!URL)("filterEligibleUsers", () => {
  let pool: Pool;
  let exec: DbExecutor;
  let teardown: () => Promise<void>;
  const ORG = randomUUID();
  const OTHER_ORG = randomUUID();
  const A = randomUUID();
  const B = randomUUID();
  const C = randomUUID();
  const NOACCESS = randomUUID();
  const canView: CanView = async (id) => id !== NOACCESS;

  beforeAll(async () => {
    const f = await setupRowTasksFixture(URL!, "rh_l3_elig");
    pool = f.pool;
    exec = f.db as unknown as DbExecutor;
    teardown = f.teardown;
  });
  afterAll(async () => {
    await teardown();
  });
  beforeEach(async () => {
    await pool.query("DELETE FROM organization_members");
    await pool.query("DELETE FROM users");
    for (const [id, n] of [[A, "A"], [B, "B"], [C, "C"], [NOACCESS, "N"]]) {
      await pool.query("INSERT INTO users (id, name) VALUES ($1, $2)", [id, n]);
    }
    for (const id of [A, B, NOACCESS]) {
      await pool.query("INSERT INTO organization_members (organization_id, user_id) VALUES ($1, $2)", [ORG, id]);
    }
    await pool.query("INSERT INTO organization_members (organization_id, user_id) VALUES ($1, $2)", [OTHER_ORG, C]);
  });

  it("garde les membres de l'organisation avec accès", async () => {
    expect(await filterEligibleUsers(exec, { orgId: ORG, userIds: [A, B], canView })).toEqual([A, B]);
    expect(await isEligibleUser(exec, { orgId: ORG, userId: A, canView })).toBe(true);
  });

  it("retire un membre sans accès à l'espace", async () => {
    expect(await filterEligibleUsers(exec, { orgId: ORG, userIds: [A, NOACCESS], canView })).toEqual([A]);
    expect(await isEligibleUser(exec, { orgId: ORG, userId: NOACCESS, canView })).toBe(false);
  });

  it("retire un utilisateur d'une autre organisation", async () => {
    expect(await filterEligibleUsers(exec, { orgId: ORG, userIds: [A, C], canView })).toEqual([A]);
  });

  it("retire un identifiant inexistant sans erreur", async () => {
    expect(await filterEligibleUsers(exec, { orgId: ORG, userIds: [randomUUID(), A], canView })).toEqual([A]);
    expect(await filterEligibleUsers(exec, { orgId: ORG, userIds: [], canView })).toEqual([]);
  });

  it("déduplique et conserve l'ordre", async () => {
    expect(await filterEligibleUsers(exec, { orgId: ORG, userIds: [B, A, B, A], canView })).toEqual([B, A]);
  });
});
