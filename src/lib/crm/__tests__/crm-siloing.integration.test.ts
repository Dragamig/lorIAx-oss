/**
 * Invariants de cloisonnement du module CRM contre la vraie base (schéma rh_l6_siloing).
 * La garde de route n'est PAS simulée : requireCrm, requireOrgScoped, resolveRequestOrg et
 * hasOrgMembershipRow lisent la base. Seuls la session, le juge de permission d'espace
 * (getSpacePermission) et la disponibilité d'instance du module sont simulés.
 */
import { describe, it, expect, vi, beforeAll, afterAll, beforeEach } from "vitest";
import { NextRequest } from "next/server";
import { randomUUID } from "node:crypto";
import type { PermissionLevel } from "@/types";
import { setupCrmFixture } from "./crm-fixture";

const h = vi.hoisted(() => ({
  db: undefined as unknown,
  user: { id: "", globalRole: "viewer" } as { id: string; globalRole: string },
  permission: vi.fn(),
}));

vi.mock("@/lib/db", () => ({
  db: new Proxy({}, { get: (_t, k) => (h.db as Record<string | symbol, unknown>)[k] }),
}));
vi.mock("@/lib/auth/get-user", () => ({
  getSessionUser: vi.fn(async () => ({ ...h.user, name: "T", email: "t@x.fr" })),
}));
vi.mock("@/lib/auth/check-access", () => ({
  getSpacePermission: (...a: unknown[]) => h.permission(...a),
}));
vi.mock("@/lib/modules/enablement", () => ({ isModuleActive: vi.fn(async () => true) }));

import { loadConnection, saveConnection, type CrmDeps } from "../connection";
import { activateCrm, deactivateCrm } from "../activation";
import { GET as getConnection, PUT as putConnection } from "@/app/api/crm/connection/route";
import { POST as postActivate } from "@/app/api/crm/activate/route";
import { POST as postDeactivate } from "@/app/api/crm/deactivate/route";
import { GET as getStatus } from "@/app/api/crm/status/route";

const URL = process.env.RELATIONS_TEST_DATABASE_URL;
const DB_NAME = URL ? new globalThis.URL(URL).pathname.replace(/^\//, "") : "";
if (URL && !DB_NAME.includes("test")) {
  throw new Error(`RELATIONS_TEST_DATABASE_URL doit viser une base de test, reçu "${DB_NAME}"`);
}

describe.skipIf(!URL)("cloisonnement CRM (Postgres)", () => {
  let fx: Awaited<ReturnType<typeof setupCrmFixture>>;
  const ORG_DEF = randomUUID();
  const ORG_ISO = randomUUID();
  const SP_DEF = randomUUID();
  const SP_ISO = randomUUID();
  const ADMIN_ISO = randomUUID(); // admin avec ligne d'appartenance dans ISO seulement
  const ADMIN_DEF = randomUUID(); // admin avec ligne d'appartenance dans DEF seulement
  const ADMIN_NOROW = randomUUID(); // admin sans aucune ligne
  const VIEWER = randomUUID();
  const SUPER = randomUUID();
  let defContacts: string, defDeals: string, isoContacts: string, isoDeals: string;
  let defDealsTitle: string, isoDealsTitle: string;
  const permissionOf = vi.fn(async (): Promise<PermissionLevel | null> => "editor");
  let deps: CrmDeps;

  async function newDb(spaceId: string, name: string) {
    const id = randomUUID();
    await fx.pool.query("INSERT INTO user_databases (id, space_id, name) VALUES ($1,$2,$3)", [id, spaceId, name]);
    return id;
  }
  async function newCol(dbId: string, name: string, type = "text") {
    const { rows } = await fx.pool.query(
      "INSERT INTO user_database_columns (database_id, name, type) VALUES ($1,$2,$3) RETURNING id",
      [dbId, name, type],
    );
    return rows[0].id as string;
  }
  async function conn(org: string) {
    const { rows } = await fx.pool.query("SELECT * FROM crm_connections WHERE organization_id = $1", [org]);
    return rows;
  }
  /** Instantané du CONTENU des bases : lignes de bases, colonnes, valeurs, vues, automatismes. */
  async function contentSnapshot() {
    const out: Record<string, unknown[]> = {};
    for (const t of [
      "user_databases",
      "user_database_columns",
      "user_database_rows",
      "user_database_views",
      "user_database_automations",
    ]) {
      out[t] = (await fx.pool.query(`SELECT * FROM ${t} ORDER BY id`)).rows;
    }
    return out;
  }
  async function connectionConfig(org: string) {
    const [r] = await conn(org);
    return r && {
      organization_id: r.organization_id,
      contacts: r.contacts_database_id,
      deals: r.deals_database_id,
      interactions: r.interactions_database_id,
      created_database_ids: r.created_database_ids,
      field_map: r.field_map,
      created_at: r.created_at,
    };
  }
  const as = (id: string, globalRole: string) => {
    h.user = { id, globalRole };
  };
  const req = (slug: string | null, method = "GET", body?: unknown) =>
    new NextRequest("http://x/api/crm/x", {
      method,
      headers: slug ? { "x-org-slug": slug } : {},
      body: body === undefined ? undefined : JSON.stringify(body),
    });

  beforeAll(async () => {
    fx = await setupCrmFixture(URL!, "rh_l6_siloing");
    h.db = fx.db;
    deps = { executor: fx.db, permissionOf };
    await fx.pool.query(`
      ALTER TABLE organizations
        ADD COLUMN is_active boolean NOT NULL DEFAULT true,
        ADD COLUMN created_at timestamptz NOT NULL DEFAULT now();
    `);
    await fx.pool.query(
      "INSERT INTO organizations (id, slug, name, created_at) VALUES ($1,'default','Def', now() - interval '1 day'),($2,'iso','Iso', now())",
      [ORG_DEF, ORG_ISO],
    );
    await fx.pool.query("INSERT INTO spaces (id, organization_id, name) VALUES ($1,$3,'D'),($2,$4,'I')", [
      SP_DEF, SP_ISO, ORG_DEF, ORG_ISO,
    ]);
    for (const u of [ADMIN_ISO, ADMIN_DEF, ADMIN_NOROW, VIEWER, SUPER]) {
      await fx.pool.query("INSERT INTO users (id) VALUES ($1)", [u]);
    }
    await fx.pool.query(
      "INSERT INTO organization_members (organization_id, user_id) VALUES ($1,$2),($3,$4),($1,$5)",
      [ORG_ISO, ADMIN_ISO, ORG_DEF, ADMIN_DEF, VIEWER],
    );
    defContacts = await newDb(SP_DEF, "D Contacts");
    defDeals = await newDb(SP_DEF, "D Dossiers");
    isoContacts = await newDb(SP_ISO, "I Contacts");
    isoDeals = await newDb(SP_ISO, "I Dossiers");
    await fx.pool.query(`
      CREATE TABLE user_database_views (id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        database_id uuid NOT NULL REFERENCES user_databases(id) ON DELETE CASCADE,
        name varchar(255) NOT NULL, config jsonb NOT NULL DEFAULT '{}');
      CREATE TABLE user_database_automations (id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        database_id uuid NOT NULL REFERENCES user_databases(id) ON DELETE CASCADE,
        name varchar(255) NOT NULL, config jsonb NOT NULL DEFAULT '{}');
    `);
    await newCol(defContacts, "Nom");
    defDealsTitle = await newCol(defDeals, "Titre");
    await newCol(isoContacts, "Nom");
    isoDealsTitle = await newCol(isoDeals, "Titre");
    await fx.pool.query(
      "INSERT INTO user_database_rows (database_id, cells) VALUES ($1,'{\"a\":1}'),($2,'{\"a\":2}')",
      [defDeals, isoDeals],
    );
    await fx.pool.query(
      "INSERT INTO user_database_views (database_id, name, config) VALUES ($1,'Vue D','{\"f\":1}'),($2,'Vue I','{\"f\":2}')",
      [defDeals, isoDeals],
    );
    await fx.pool.query(
      "INSERT INTO user_database_automations (database_id, name, config) VALUES ($1,'Auto D','{\"t\":1}'),($2,'Auto I','{\"t\":2}')",
      [defDeals, isoDeals],
    );
  });
  afterAll(async () => {
    await fx?.teardown();
  });
  beforeEach(async () => {
    await fx.pool.query("DELETE FROM crm_connections");
    permissionOf.mockClear();
    permissionOf.mockImplementation(async () => "editor");
    h.permission.mockReset();
    h.permission.mockImplementation(async () => "editor");
  });

  describe("invariant « dossier d'une autre organisation introuvable »", () => {
    async function dealsRoleOf(org: string) {
      const c = await loadConnection(org, ADMIN_ISO, "viewer", deps);
      return c!.roles.dossiers;
    }

    it("base déplacée vers l'autre organisation, deals_database_id écrit à la main, base supprimée : même forme, permissionOf muette", async () => {
      // Référence : base supprimée (FK set null).
      const gone = await newDb(SP_ISO, "I Gone");
      await fx.pool.query("INSERT INTO crm_connections (organization_id, enabled, deals_database_id) VALUES ($1,true,$2)", [ORG_ISO, gone]);
      await fx.pool.query("DELETE FROM user_databases WHERE id = $1", [gone]);
      const deleted = JSON.stringify(await dealsRoleOf(ORG_ISO));
      expect(JSON.parse(deleted).connected).toBe(false);

      // Base déplacée vers un espace de l'autre organisation.
      const moved = await newDb(SP_ISO, "I Moved");
      await fx.pool.query("UPDATE crm_connections SET deals_database_id = $2 WHERE organization_id = $1", [ORG_ISO, moved]);
      await fx.pool.query("UPDATE user_databases SET space_id = $2 WHERE id = $1", [moved, SP_DEF]);
      permissionOf.mockClear();
      const movedRole = JSON.stringify(await dealsRoleOf(ORG_ISO));
      expect(movedRole).toBe(deleted);
      expect(permissionOf).not.toHaveBeenCalled();

      // Identifiant d'une base de l'autre organisation écrit à la main.
      await fx.pool.query("UPDATE crm_connections SET deals_database_id = $2 WHERE organization_id = $1", [ORG_ISO, defDeals]);
      permissionOf.mockClear();
      const handWritten = JSON.stringify(await dealsRoleOf(ORG_ISO));
      expect(handWritten).toBe(deleted);
      expect(permissionOf).not.toHaveBeenCalled();
      expect(handWritten).not.toContain("D Dossiers");
    });

    it("saveConnection et activateCrm refusent une base de l'autre organisation en 404 sans rien écrire", async () => {
      expect(await saveConnection(ORG_ISO, ADMIN_ISO, { roles: { dossiers: defDeals }, fieldMap: {} }, deps)).toEqual({
        ok: false, status: 404, code: "not_found",
      });
      expect(await activateCrm(ORG_ISO, ADMIN_ISO, { bindings: { dossiers: { databaseId: defDeals } }, locale: "fr" }, deps)).toEqual({
        ok: false, status: 404, code: "not_found",
      });
      expect(await conn(ORG_ISO)).toHaveLength(0);
      expect(permissionOf).not.toHaveBeenCalled();
    });
  });

  describe("désactivation, dissociation, suppression de ligne : bases intactes", () => {
    it("contenu identique (bases, colonnes, valeurs, vues, automatismes, configuration) avant et après chaque geste, réactivation sans doublon", async () => {
      await activateCrm(ORG_ISO, ADMIN_ISO, { bindings: { contacts: { databaseId: isoContacts }, dossiers: { databaseId: isoDeals } }, locale: "fr" }, deps);
      const before = await contentSnapshot();
      expect(before.user_database_views.length).toBeGreaterThan(0);
      expect(before.user_database_automations.length).toBeGreaterThan(0);
      const config = await connectionConfig(ORG_ISO);

      await deactivateCrm(ORG_ISO, ADMIN_ISO, deps);
      expect(await contentSnapshot()).toEqual(before);
      expect(await connectionConfig(ORG_ISO)).toEqual(config);

      await activateCrm(ORG_ISO, ADMIN_ISO, { locale: "fr" }, deps);
      expect(await contentSnapshot()).toEqual(before);
      expect(await connectionConfig(ORG_ISO)).toEqual(config);
      expect(await conn(ORG_ISO)).toHaveLength(1);

      await saveConnection(ORG_ISO, ADMIN_ISO, { roles: { contacts: null }, fieldMap: {} }, deps);
      expect(await contentSnapshot()).toEqual(before);
      await fx.pool.query("DELETE FROM crm_connections WHERE organization_id = $1", [ORG_ISO]);
      expect(await contentSnapshot()).toEqual(before);

      await activateCrm(ORG_ISO, ADMIN_ISO, { bindings: { contacts: { databaseId: isoContacts } }, locale: "fr" }, deps);
      await activateCrm(ORG_ISO, ADMIN_ISO, { bindings: { contacts: { databaseId: isoContacts } }, locale: "fr" }, deps);
      expect(await conn(ORG_ISO)).toHaveLength(1);
      expect(await contentSnapshot()).toEqual(before);
    });

    it("deux POST activate simultanés par la route : une seule ligne, bases intactes", async () => {
      as(ADMIN_ISO, "admin");
      const before = await contentSnapshot();
      const body = { bindings: { dossiers: { databaseId: isoDeals } } };
      const res = await Promise.all([postActivate(req("iso", "POST", body)), postActivate(req("iso", "POST", body))]);
      expect(res.map((r) => r.status)).toEqual([200, 200]);
      const rows = await conn(ORG_ISO);
      expect(rows).toHaveLength(1);
      expect(rows[0].enabled).toBe(true);
      expect(rows[0].field_map.dossiers.titre).toBe(isoDealsTitle);
      expect(await contentSnapshot()).toEqual(before);
    });
  });

  describe("garde réelle : rôle admin sur une autre organisation", () => {
    beforeEach(async () => {
      await fx.pool.query(
        "INSERT INTO crm_connections (organization_id, enabled, deals_database_id, field_map) VALUES ($1,true,$2,$3),($4,true,$5,$6)",
        [ORG_DEF, defDeals, JSON.stringify({ dossiers: { titre: defDealsTitle } }), ORG_ISO, isoDeals, JSON.stringify({ dossiers: { titre: isoDealsTitle } })],
      );
    });
    const snapshot = async () => JSON.stringify([await conn(ORG_DEF), await conn(ORG_ISO)]);

    it("admin d'une organisation isolée visant l'organisation par défaut (sans ligne) : 403 explicite, rien d'écrit", async () => {
      as(ADMIN_ISO, "admin");
      const before = await snapshot();
      expect((await putConnection(req(null, "PUT", { roles: { contacts: defContacts }, fieldMap: {} }))).status).toBe(403);
      expect((await postActivate(req("default", "POST", {}))).status).toBe(403);
      expect((await postDeactivate(req("default", "POST"))).status).toBe(403);
      expect(await snapshot()).toBe(before);
      // Membre au sens large (tenant mutualisé ouvert) : lecture du statut sans pouvoir d'admin.
      const st = await (await getStatus(req(null))).json();
      expect(st.canAdmin).toBe(false);
    });

    it("admin sans aucune ligne d'appartenance sur l'organisation par défaut : 403", async () => {
      as(ADMIN_NOROW, "admin");
      expect((await postActivate(req(null, "POST", {}))).status).toBe(403);
      expect((await putConnection(req(null, "PUT", { roles: {}, fieldMap: {} }))).status).toBe(403);
    });

    it("admin de l'organisation par défaut visant l'organisation isolée : 404 muet, rien d'écrit", async () => {
      as(ADMIN_DEF, "admin");
      const before = await snapshot();
      for (const r of [
        await getConnection(req("iso")),
        await putConnection(req("iso", "PUT", { roles: { contacts: isoContacts }, fieldMap: {} })),
        await postActivate(req("iso", "POST", { bindings: { contacts: { databaseId: isoContacts } } })),
        await postDeactivate(req("iso", "POST")),
        await getStatus(req("iso")),
      ]) {
        expect(r.status).toBe(404);
        expect(await r.json()).toEqual({ error: "Introuvable" });
      }
      expect(await snapshot()).toBe(before);
    });

    it("admin de son organisation ne lie jamais une base de l'autre : 404 uniforme, aucune fuite de nom", async () => {
      as(ADMIN_ISO, "admin");
      const before = await snapshot();
      for (const r of [
        await putConnection(req("iso", "PUT", { roles: { contacts: defContacts }, fieldMap: {} })),
        await postActivate(req("iso", "POST", { bindings: { interactions: { databaseId: defDeals } } })),
      ]) {
        expect(r.status).toBe(404);
        expect(JSON.stringify(await r.json())).toBe(JSON.stringify({ error: "Introuvable" }));
      }
      expect(await snapshot()).toBe(before);
    });

    it("viewer d'une base raccordée : lecture seule, 403 sur toute écriture, rien d'écrit", async () => {
      as(VIEWER, "viewer");
      h.permission.mockImplementation(async () => "viewer");
      const before = await snapshot();
      const read = await getConnection(req(null));
      expect(read.status).toBe(200);
      const json = await read.json();
      expect(json.canAdmin).toBe(false);
      expect(json.roles.dossiers.connected).toBe(true);
      expect((await putConnection(req(null, "PUT", { roles: { contacts: defContacts }, fieldMap: {} }))).status).toBe(403);
      expect((await postActivate(req(null, "POST", {}))).status).toBe(403);
      expect((await postDeactivate(req(null, "POST"))).status).toBe(403);
      expect(await snapshot()).toBe(before);
    });

    it("viewer sans permission sur l'espace : rôle non raccordé, même forme qu'une base absente", async () => {
      as(VIEWER, "viewer");
      h.permission.mockImplementation(async () => null);
      const res = await (await getConnection(req(null))).json();
      expect(res.roles.dossiers).toEqual({
        role: "dossiers", connected: false, fields: expect.any(Object), columnIds: {}, ok: 0, total: expect.any(Number), bad: 0, complete: false,
      });
      expect(JSON.stringify(res)).not.toContain("D Dossiers");
    });

    it("super_admin sur une organisation étrangère : agit sur CETTE organisation seulement, jamais sur une base de l'autre", async () => {
      as(SUPER, "super_admin");
      const before = await conn(ORG_DEF);
      const ok = await getConnection(req("iso"));
      expect(ok.status).toBe(200);
      expect((await ok.json()).roles.dossiers.databaseName).toBe("I Dossiers");
      const cross = await putConnection(req("iso", "PUT", { roles: { contacts: defContacts }, fieldMap: {} }));
      expect(cross.status).toBe(404);
      expect(await conn(ORG_DEF)).toEqual(before);
      expect((await conn(ORG_ISO))[0].contacts_database_id).toBeNull();
    });

    it("activation répétée et désactiver puis réactiver par la route : une ligne, enabled correct", async () => {
      as(ADMIN_ISO, "admin");
      expect((await postDeactivate(req("iso", "POST"))).status).toBe(200);
      expect((await conn(ORG_ISO))[0].enabled).toBe(false);
      expect((await postActivate(req("iso", "POST", {}))).status).toBe(200);
      expect((await postActivate(req("iso", "POST", {}))).status).toBe(200);
      const rows = await conn(ORG_ISO);
      expect(rows).toHaveLength(1);
      expect(rows[0].enabled).toBe(true);
      expect(rows[0].deals_database_id).toBe(isoDeals);
    });
  });
});
