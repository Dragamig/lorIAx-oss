/**
 * listCrmAdminOrgs contre la vraie base (schéma rh_l6_act_orgs). Seule la disponibilité du module
 * par organisation est simulée ; isCrmOrgAdmin et hasOrgMembershipRow lisent la base.
 */
import { describe, it, expect, vi, beforeAll, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import { setupActivationFixture } from "./crm-fixture";

const h = vi.hoisted(() => ({ db: undefined as unknown, disabled: new Set<string>() }));

vi.mock("@/lib/db", () => ({
  db: new Proxy({}, { get: (_t, k) => (h.db as Record<string | symbol, unknown>)[k] }),
}));
vi.mock("@/lib/auth/get-user", () => ({ getSessionUser: vi.fn(async () => null) }));
vi.mock("@/lib/modules/enablement", () => ({
  isModuleActive: vi.fn(async (_id: string, orgId?: string | null) => !h.disabled.has(orgId ?? "")),
}));

import { listCrmAdminOrgs } from "../orgs";

const URL = process.env.RELATIONS_TEST_DATABASE_URL;

describe.skipIf(!URL)("listCrmAdminOrgs (Postgres)", () => {
  let fx: Awaited<ReturnType<typeof setupActivationFixture>>;
  let orgA: string, orgB: string, orgC: string;
  const admin = randomUUID();
  const member = randomUUID();
  const sup = randomUUID();

  const join = (org: string, user: string) =>
    fx.pool.query("INSERT INTO organization_members (organization_id, user_id) VALUES ($1,$2)", [org, user]);

  beforeAll(async () => {
    fx = await setupActivationFixture(URL!, "rh_l6_act_orgs");
    h.db = fx.db;
    for (const u of [admin, member, sup]) await fx.pool.query("INSERT INTO users (id) VALUES ($1)", [u]);
    orgA = await fx.seedOrg("Alpha");
    orgB = await fx.seedOrg("Bravo");
    orgC = await fx.seedOrg("Charlie");
    await join(orgA, admin);
    await join(orgB, admin);
    await join(orgA, member);
    await join(orgA, sup);
    await join(orgC, sup);
  });
  afterAll(async () => {
    await fx?.teardown();
  });

  it("membre non admin : absent", async () => {
    expect(await listCrmAdminOrgs({ id: member, globalRole: "viewer" })).toEqual([]);
  });

  it("admin avec module désactivé sur cette organisation : absent", async () => {
    h.disabled.add(orgB);
    try {
      expect(await listCrmAdminOrgs({ id: admin, globalRole: "admin" })).toEqual([
        { slug: "alpha", name: "Alpha" },
      ]);
    } finally {
      h.disabled.clear();
    }
  });

  it("admin de A et de B : les deux, sans id", async () => {
    const out = await listCrmAdminOrgs({ id: admin, globalRole: "admin" });
    expect(out).toEqual([
      { slug: "alpha", name: "Alpha" },
      { slug: "bravo", name: "Bravo" },
    ]);
    expect(Object.keys(out[0]).sort()).toEqual(["name", "slug"]);
  });

  it("super_admin : organisations où il a une ligne d'appartenance seulement", async () => {
    expect(await listCrmAdminOrgs({ id: sup, globalRole: "super_admin" })).toEqual([
      { slug: "alpha", name: "Alpha" },
      { slug: "charlie", name: "Charlie" },
    ]);
  });
});
