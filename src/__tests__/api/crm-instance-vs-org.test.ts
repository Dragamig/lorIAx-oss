/**
 * Activation à deux niveaux : l'interrupteur d'instance (PATCH /api/admin/modules/crm, super_admin)
 * ne se confond jamais avec l'activation par organisation (POST /api/crm/activate, admin de
 * l'organisation). Garde CRM réelle contre Postgres (schéma rh_l6_instance) ; seuls la session,
 * la disponibilité d'instance du module et l'écriture du réglage d'instance sont simulés.
 */
import { describe, it, expect, vi, beforeAll, afterAll, beforeEach } from "vitest";
import { NextRequest } from "next/server";
import { randomUUID } from "node:crypto";
import { setupCrmFixture } from "@/lib/crm/__tests__/crm-fixture";
import { getModuleManifest } from "@/lib/modules/registry";

const h = vi.hoisted(() => ({
  db: undefined as unknown,
  user: { id: "", globalRole: "viewer" } as { id: string; globalRole: string },
  instanceOn: true,
  toggle: vi.fn(),
}));

vi.mock("@/lib/db", () => ({
  db: new Proxy({}, { get: (_t, k) => (h.db as Record<string | symbol, unknown>)[k] }),
}));
vi.mock("@/lib/auth/get-user", () => ({
  getSessionUser: vi.fn(async () => ({ ...h.user, name: "T", email: "t@x.fr" })),
}));
vi.mock("@/lib/auth/check-access", () => ({ getSpacePermission: vi.fn(async () => "editor") }));
vi.mock("@/lib/modules/enablement", () => ({
  isModuleActive: vi.fn(async () => h.instanceOn),
  getModulesState: vi.fn(async () => []),
}));
vi.mock("@/lib/modules/org-context", () => ({ getModuleScopeOrgId: vi.fn(async () => null) }));
vi.mock("@/lib/modules/toggle", () => ({ setModuleToggle: h.toggle }));

import { PATCH } from "@/app/api/admin/modules/[id]/route";
import { POST as postActivate } from "@/app/api/crm/activate/route";

const URL = process.env.RELATIONS_TEST_DATABASE_URL;
const DB_NAME = URL ? new globalThis.URL(URL).pathname.replace(/^\//, "") : "";
if (URL && !DB_NAME.includes("test")) {
  throw new Error(`RELATIONS_TEST_DATABASE_URL doit viser une base de test, reçu "${DB_NAME}"`);
}

describe.skipIf(!URL)("CRM : instance contre organisation (Postgres)", () => {
  let fx: Awaited<ReturnType<typeof setupCrmFixture>>;
  const ORG_DEF = randomUUID();
  const ORG_ISO = randomUUID();
  const ADMIN_DEF = randomUUID();
  const ADMIN_ISO = randomUUID();
  const SUPER = randomUUID();

  const as = (id: string, globalRole: string) => {
    h.user = { id, globalRole };
  };
  const patch = (enabled: boolean) =>
    PATCH(
      new Request("http://x/api/admin/modules/crm", { method: "PATCH", body: JSON.stringify({ enabled }) }),
      { params: Promise.resolve({ id: "crm" }) },
    );
  const activate = (slug: string | null, body: unknown = {}) =>
    postActivate(
      new NextRequest("http://x/api/crm/activate", {
        method: "POST",
        headers: slug ? { "x-org-slug": slug } : {},
        body: JSON.stringify(body),
      }),
    );
  const rows = async () => (await fx.pool.query("SELECT * FROM crm_connections ORDER BY organization_id")).rows;

  beforeAll(async () => {
    fx = await setupCrmFixture(URL!, "rh_l6_instance");
    h.db = fx.db;
    await fx.pool.query(`
      ALTER TABLE organizations
        ADD COLUMN is_active boolean NOT NULL DEFAULT true,
        ADD COLUMN created_at timestamptz NOT NULL DEFAULT now();
    `);
    await fx.pool.query(
      "INSERT INTO organizations (id, slug, name, created_at) VALUES ($1,'default','D', now() - interval '1 day'),($2,'iso','I', now())",
      [ORG_DEF, ORG_ISO],
    );
    for (const u of [ADMIN_DEF, ADMIN_ISO, SUPER]) await fx.pool.query("INSERT INTO users (id) VALUES ($1)", [u]);
    await fx.pool.query("INSERT INTO organization_members (organization_id, user_id) VALUES ($1,$2),($3,$4)", [
      ORG_DEF, ADMIN_DEF, ORG_ISO, ADMIN_ISO,
    ]);
  });
  afterAll(async () => {
    await fx?.teardown();
  });
  beforeEach(async () => {
    await fx.pool.query("DELETE FROM crm_connections");
    h.instanceOn = true;
    h.toggle.mockReset();
  });

  it("le manifeste réserve l'interrupteur d'instance au super_admin", () => {
    expect(getModuleManifest("crm")!.manageRole).toBe("super_admin");
  });

  it("un admin d'organisation reçoit 403 sur PATCH /api/admin/modules/crm (manageRole super_admin)", async () => {
    as(ADMIN_ISO, "admin");
    const res = await patch(true);
    expect(res.status).toBe(403);
    expect((await res.json()).error).toMatch(/super administrateur/);
    expect(h.toggle).not.toHaveBeenCalled();
  });

  it("un admin ne peut pas activer le CRM d'une autre organisation (404)", async () => {
    as(ADMIN_DEF, "admin");
    const res = await activate("iso");
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: "Introuvable" });
    expect(await rows()).toHaveLength(0);
  });

  it("un admin active sa propre organisation : une ligne pour son organisation seulement", async () => {
    as(ADMIN_ISO, "admin");
    expect((await activate("iso")).status).toBe(200);
    const r = await rows();
    expect(r).toHaveLength(1);
    expect(r[0].organization_id).toBe(ORG_ISO);
    expect(r[0].enabled).toBe(true);
  });

  it("sans disponibilité instance, POST /api/crm/activate répond 404 et n'écrit rien", async () => {
    h.instanceOn = false;
    as(ADMIN_ISO, "admin");
    const res = await activate("iso");
    expect(res.status).toBe(404);
    expect(await rows()).toHaveLength(0);
  });

  it("un super_admin bascule l'interrupteur d'instance sans toucher crm_connections", async () => {
    await fx.pool.query("INSERT INTO crm_connections (organization_id, enabled) VALUES ($1,true),($2,false)", [ORG_DEF, ORG_ISO]);
    const before = JSON.stringify(await rows());
    as(SUPER, "super_admin");
    expect((await patch(false)).status).toBe(200);
    expect((await patch(true)).status).toBe(200);
    expect(h.toggle).toHaveBeenCalledTimes(2);
    // setModuleToggle est simulé (il écrit system_settings, absent de la fixture) : ce test borne la
    // route PATCH, qui ne touche ni n'appelle aucune écriture CRM ; il ne prouve pas l'étanchéité du vrai toggle.
    expect(h.toggle.mock.calls.map((c) => [c[0].id, c[1]])).toEqual([["crm", false], ["crm", true]]);
    expect(JSON.stringify(await rows())).toBe(before);
  });
});
