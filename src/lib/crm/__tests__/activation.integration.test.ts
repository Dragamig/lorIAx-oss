import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from "vitest";
import { randomUUID } from "node:crypto";
import type { PermissionLevel } from "@/types";
import { enableTemplateTables, setupActivationFixture } from "./crm-fixture";
import { loadTemplateMessages } from "../template-messages";
import { activateCrm, deactivateCrm } from "../activation";
import type { CrmDeps } from "../connection";
import { automations } from "@/lib/db/schema";
import { crmConnections } from "@/lib/db/schema-crm";
import { TemplateFailure } from "@/lib/databases/templates/types";
import { SAMPLE_AUTOMATION_KEYS } from "../sample-automations";

const spaceHooks = vi.hoisted(() => ({
  exceeded: false,
  after: vi.fn(async () => ({ gitOk: true })),
}));
const logs = vi.hoisted(() => ({ error: vi.fn(), warn: vi.fn() }));
vi.mock("@/lib/logger", () => ({ default: { error: logs.error, warn: logs.warn, info: vi.fn(), debug: vi.fn() } }));
vi.mock("@/lib/spaces/create-space", async (orig) => ({
  ...(await orig<typeof import("@/lib/spaces/create-space")>()),
  assertSpaceQuota: vi.fn(async () => ({ exceeded: spaceHooks.exceeded, current: 1, max: 1 })),
  afterSpaceCreated: spaceHooks.after,
}));

const URL = process.env.RELATIONS_TEST_DATABASE_URL;

describe.skipIf(!URL)("activation CRM (Postgres)", () => {
  let fx: Awaited<ReturnType<typeof setupActivationFixture>>;
  const ORG_A = randomUUID();
  const ORG_B = randomUUID();
  const SPACE_A = randomUUID();
  const SPACE_B = randomUUID();
  const ADMIN = randomUUID();
  const permissionOf = vi.fn(async (_u: string, _s: string): Promise<PermissionLevel | null> => "editor");
  let deps: CrmDeps;
  let contacts: string, dossiers: string, interactions: string, foreign: string;
  const col: Record<string, string> = {};

  async function newDb(spaceId: string, name: string) {
    const id = randomUUID();
    await fx.pool.query("INSERT INTO user_databases (id, space_id, name) VALUES ($1,$2,$3)", [id, spaceId, name]);
    return id;
  }
  async function newCol(dbId: string, name: string, type: string, config: object = {}) {
    const { rows } = await fx.pool.query(
      "INSERT INTO user_database_columns (database_id, name, type, config) VALUES ($1,$2,$3,$4) RETURNING id",
      [dbId, name, type, JSON.stringify(config)],
    );
    return rows[0].id as string;
  }
  async function rowsOf(table: string) {
    const { rows } = await fx.pool.query(`SELECT count(*)::int AS n FROM ${table}`);
    return rows[0].n as number;
  }
  async function connRows() {
    const { rows } = await fx.pool.query("SELECT * FROM crm_connections WHERE organization_id = $1", [ORG_A]);
    return rows;
  }
  const three = () => ({
    contacts: { databaseId: contacts },
    dossiers: { databaseId: dossiers },
    interactions: { databaseId: interactions },
  });

  beforeAll(async () => {
    fx = await setupActivationFixture(URL!, "rh_l6_activation");
    await enableTemplateTables(fx.pool);
    deps = { executor: fx.db, permissionOf };
    await fx.pool.query("INSERT INTO organizations (id, slug, name) VALUES ($1,'a','A'),($2,'b','B')", [ORG_A, ORG_B]);
    await fx.pool.query("INSERT INTO spaces (id, organization_id, name) VALUES ($1,$3,'A'),($2,$4,'B')", [
      SPACE_A, SPACE_B, ORG_A, ORG_B,
    ]);
    await fx.pool.query("INSERT INTO users (id) VALUES ($1)", [ADMIN]);
    contacts = await newDb(SPACE_A, "Contacts");
    dossiers = await newDb(SPACE_A, "Dossiers");
    interactions = await newDb(SPACE_A, "Interactions");
    foreign = await newDb(SPACE_B, "Étrangère");
    col.cNom = await newCol(contacts, "Nom", "text");
    col.dTitre = await newCol(dossiers, "Titre", "text");
    col.dStatut = await newCol(dossiers, "Statut", "select");
    col.dContact = await newCol(dossiers, "Contact", "relation", { targetDatabaseId: contacts });
    col.iDate = await newCol(interactions, "Date", "date");
    await newCol(foreign, "Nom", "text");
  });
  afterAll(async () => {
    await fx?.teardown();
  });
  beforeEach(async () => {
    await fx.pool.query("DELETE FROM crm_connections");
    spaceHooks.exceeded = false;
    spaceHooks.after.mockClear();
    logs.error.mockClear();
    logs.warn.mockClear();
  });

  it("première activation avec trois bases : ligne créée, enabled vrai, field_map automap", async () => {
    const r = await activateCrm(ORG_A, ADMIN, { bindings: three(), locale: "fr" }, deps);
    expect(r).toMatchObject({ ok: true, reactivated: false });
    const rows = await connRows();
    expect(rows).toHaveLength(1);
    expect(rows[0].enabled).toBe(true);
    expect(rows[0].contacts_database_id).toBe(contacts);
    expect(rows[0].deals_database_id).toBe(dossiers);
    expect(rows[0].field_map.contacts.nom).toBe(col.cNom);
    expect(rows[0].field_map.dossiers).toMatchObject({ titre: col.dTitre, statut: col.dStatut, contact: col.dContact });
    expect(rows[0].field_map.interactions.date).toBe(col.iDate);
  });

  it("activation sans base : ligne enabled, aucun rôle", async () => {
    expect(await activateCrm(ORG_A, ADMIN, { locale: "fr" }, deps)).toMatchObject({ ok: true, reactivated: false });
    const rows = await connRows();
    expect(rows[0].enabled).toBe(true);
    expect(rows[0].contacts_database_id).toBeNull();
  });

  it("réactivation sans corps : enabled repasse à vrai, rôles et mapping inchangés", async () => {
    await activateCrm(ORG_A, ADMIN, { bindings: three(), locale: "fr" }, deps);
    const before = (await connRows())[0];
    await deactivateCrm(ORG_A, ADMIN, deps);
    expect((await connRows())[0].enabled).toBe(false);
    expect(await activateCrm(ORG_A, ADMIN, { locale: "fr" }, deps)).toMatchObject({ ok: true, reactivated: true });
    const after = (await connRows())[0];
    expect(after.enabled).toBe(true);
    expect(after.contacts_database_id).toBe(before.contacts_database_id);
    expect(after.deals_database_id).toBe(before.deals_database_id);
    expect(after.interactions_database_id).toBe(before.interactions_database_id);
    expect(after.field_map).toEqual(before.field_map);
  });

  it("activation d'une base d'une autre organisation : 404, aucune ligne", async () => {
    const r = await activateCrm(ORG_A, ADMIN, { bindings: { contacts: { databaseId: foreign } }, locale: "fr" }, deps);
    expect(r).toEqual({ ok: false, status: 404, code: "not_found" });
    expect(await connRows()).toHaveLength(0);
  });

  it("activations concurrentes : une seule ligne, aucune erreur de clé primaire", async () => {
    const res = await Promise.all([
      activateCrm(ORG_A, ADMIN, { bindings: three(), locale: "fr" }, deps),
      activateCrm(ORG_A, ADMIN, { bindings: three(), locale: "fr" }, deps),
    ]);
    expect(res.every((r) => r.ok)).toBe(true);
    const rows = await connRows();
    expect(rows).toHaveLength(1);
    expect(rows[0].enabled).toBe(true);
  });

  it("désactiver : enabled faux, bases, colonnes et lignes inchangées", async () => {
    await activateCrm(ORG_A, ADMIN, { bindings: three(), locale: "fr" }, deps);
    const before = [await rowsOf("user_databases"), await rowsOf("user_database_columns"), await rowsOf("crm_connections")];
    const map = (await connRows())[0].field_map;
    await deactivateCrm(ORG_A, ADMIN, deps);
    const after = [await rowsOf("user_databases"), await rowsOf("user_database_columns"), await rowsOf("crm_connections")];
    expect(after).toEqual(before);
    const row = (await connRows())[0];
    expect(row.enabled).toBe(false);
    expect(row.deals_database_id).toBe(dossiers);
    expect(row.field_map).toEqual(map);
  });

  it("activer deux fois : idempotent", async () => {
    await activateCrm(ORG_A, ADMIN, { bindings: three(), locale: "fr" }, deps);
    const first = (await connRows())[0];
    expect(await activateCrm(ORG_A, ADMIN, { bindings: three(), locale: "fr" }, deps)).toMatchObject({ ok: true, reactivated: false });
    const rows = await connRows();
    expect(rows).toHaveLength(1);
    expect(rows[0].field_map).toEqual(first.field_map);
    expect(rows[0].enabled).toBe(true);
  });

  it("I1 : réactiver avec la même base garde le mapping personnalisé (pas d'automap)", async () => {
    await activateCrm(ORG_A, ADMIN, { bindings: three(), locale: "fr" }, deps);
    const alt = await newCol(contacts, "Raison sociale", "text");
    await fx.pool.query(
      "UPDATE crm_connections SET field_map = jsonb_set(field_map, '{contacts,nom}', to_jsonb($2::text)) WHERE organization_id = $1",
      [ORG_A, alt],
    );
    await deactivateCrm(ORG_A, ADMIN, deps);
    const r = await activateCrm(ORG_A, ADMIN, { bindings: { contacts: { databaseId: contacts } }, locale: "fr" }, deps);
    expect(r.ok).toBe(true);
    const row = (await connRows())[0];
    expect(row.enabled).toBe(true);
    expect(row.field_map.contacts.nom).toBe(alt);
  });

  it("I2 : base d'un rôle non fourni archivée puis purgée : l'activation réussit, rôle non raccordé", async () => {
    await activateCrm(ORG_A, ADMIN, { bindings: three(), locale: "fr" }, deps);
    await deactivateCrm(ORG_A, ADMIN, deps);
    await fx.pool.query("UPDATE user_databases SET archived_at = now() WHERE id = $1", [dossiers]);
    try {
      const r = await activateCrm(ORG_A, ADMIN, { bindings: { contacts: { databaseId: contacts }, interactions: { databaseId: interactions } }, locale: "fr" }, deps);
      expect(r).toMatchObject({ ok: true, reactivated: false });
      expect((await connRows())[0].enabled).toBe(true);
      await fx.pool.query("UPDATE crm_connections SET deals_database_id = NULL WHERE organization_id = $1", [ORG_A]);
      const r2 = await activateCrm(ORG_A, ADMIN, { bindings: { contacts: { databaseId: contacts } }, locale: "fr" }, deps);
      expect(r2.ok).toBe(true);
    } finally {
      await fx.pool.query("UPDATE user_databases SET archived_at = NULL WHERE id = $1", [dossiers]);
    }
  });

  it("activation avec deux rôles sur la même base : 400 duplicate_database (pas 404)", async () => {
    const r = await activateCrm(ORG_A, ADMIN, { bindings: { contacts: { databaseId: contacts }, dossiers: { databaseId: contacts } }, locale: "fr" }, deps);
    expect(r).toEqual({ ok: false, status: 400, code: "duplicate_database" });
    expect(await connRows()).toHaveLength(0);
  });

  it("désactiver sans ligne : sans effet", async () => {
    await deactivateCrm(ORG_A, ADMIN, deps);
    expect(await connRows()).toHaveLength(0);
  });

  describe("création, complétion et mode mixte", () => {
    const L = { locale: "fr" };
    let m: Awaited<ReturnType<typeof loadTemplateMessages>>;
    beforeAll(async () => {
      m = await loadTemplateMessages("fr");
    });
    const count = async (table: string, where = "true", params: unknown[] = []) => {
      const { rows } = await fx.pool.query(`SELECT count(*)::int AS n FROM ${table} WHERE ${where}`, params);
      return rows[0].n as number;
    };
    const columnsOf = async (dbId: string) =>
      (await fx.pool.query("SELECT id, name, type, config::text AS config, position FROM user_database_columns WHERE database_id=$1 ORDER BY position, id", [dbId])).rows;
    const dbByName = async (spaceId: string, name: string) =>
      (await fx.pool.query("SELECT id FROM user_databases WHERE space_id=$1 AND name=$2", [spaceId, name])).rows[0]?.id as string;
    const freshSpace = (label: string) => fx.seedSpace(ORG_A, { name: label, ownerUserId: ADMIN });
    const snapshotAll = async () => ({
      spaces: await count("spaces"),
      dbs: await count("user_databases"),
      cols: await count("user_database_columns"),
      conn: (await fx.pool.query("SELECT * FROM crm_connections ORDER BY organization_id")).rows,
    });

    it("création des trois rôles : 3 bases, relations jumelées, field_map sur les ids créés, created_database_ids = les 3 ids", async () => {
      const spaces0 = await count("spaces");
      const r = await activateCrm(ORG_A, ADMIN, { v2: { space: { mode: "create" }, roles: { contacts: { mode: "create" }, dossiers: { mode: "create" }, interactions: { mode: "create" } } }, ...L }, deps);
      expect(r).toMatchObject({ ok: true, reactivated: false, created: ["contacts", "dossiers", "interactions"], completed: [], unlinkedRelations: [] });
      expect(await count("spaces")).toBe(spaces0 + 1);
      expect(spaceHooks.after).toHaveBeenCalledTimes(1);
      const [row] = await connRows();
      expect(row.enabled).toBe(true);
      const ids = [row.contacts_database_id, row.deals_database_id, row.interactions_database_id];
      expect(new Set(ids).size).toBe(3);
      expect([...row.created_database_ids].sort()).toEqual([...ids].sort());
      const dossierCols = await columnsOf(row.deals_database_id);
      const contactCols = await columnsOf(row.contacts_database_id);
      const rel = dossierCols.find((c) => c.id === row.field_map.dossiers.contact)!;
      expect(rel.type).toBe("relation");
      const cfg = JSON.parse(rel.config);
      expect(cfg.targetDatabaseId).toBe(row.contacts_database_id);
      const inverse = contactCols.find((c) => c.id === cfg.inverseColumnId)!;
      expect(JSON.parse(inverse.config)).toMatchObject({ targetDatabaseId: row.deals_database_id, inverseColumnId: rel.id });
      expect(row.field_map.dossiers.titre).toBe(dossierCols.find((c) => c.name === m.fields.dossiers.titre)!.id);
      expect(row.field_map.interactions.dossier).toBeTruthy();
      expect(row.field_map.contacts.nom).toBe(contactCols.find((c) => c.name === m.fields.contacts.nom)!.id);
    });

    it("complétion : colonnes ajoutées, field_map sur la colonne ajoutée, existant intact, created_database_ids ne la contient pas", async () => {
      const sp = await freshSpace("Complétion");
      const db = await fx.seedDatabase(sp, "Mes dossiers", [
        { name: "Titre", type: "text" },
        { name: "Statut", type: "text" },
      ]);
      const before = await columnsOf(db);
      const r = await activateCrm(ORG_A, ADMIN, { v2: { space: { mode: "existing", spaceId: sp }, roles: { dossiers: { mode: "complete", databaseId: db } } }, ...L }, deps);
      expect(r).toMatchObject({ ok: true, created: [], completed: ["dossiers"], unlinkedRelations: [m.fields.dossiers.contact] });
      const after = await columnsOf(db);
      expect(after.slice(0, before.length)).toEqual(before);
      const [row] = await connRows();
      const statutNew = after.find((c) => c.name === "Statut (select)")!;
      expect(statutNew.type).toBe("select");
      expect(row.field_map.dossiers.statut).toBe(statutNew.id);
      expect(row.field_map.dossiers.titre).toBe(before[0].id);
      expect(row.created_database_ids).toEqual([]);
      expect(after.some((c) => c.type === "relation")).toBe(false);
    });

    it("mode mixte (connect + complete + create) : relations posées vers les bases présentes", async () => {
      const sp = await freshSpace("Mixte");
      const dos = await fx.seedDatabase(sp, "Affaires", [{ name: "Titre", type: "text" }]);
      const r = await activateCrm(ORG_A, ADMIN, {
        v2: { space: { mode: "existing", spaceId: sp }, roles: { contacts: { mode: "connect", databaseId: contacts }, dossiers: { mode: "complete", databaseId: dos }, interactions: { mode: "create" } } },
        ...L,
      }, deps);
      expect(r).toMatchObject({ ok: true, created: ["interactions"], completed: ["dossiers"] });
      const [row] = await connRows();
      const inter = await dbByName(sp, m.databases.interactions);
      expect(row.interactions_database_id).toBe(inter);
      expect(row.created_database_ids).toEqual([inter]);
      const dosCols = await columnsOf(dos);
      const rel = dosCols.find((c) => c.id === row.field_map.dossiers.contact)!;
      expect(JSON.parse(rel.config).targetDatabaseId).toBe(contacts);
      expect((await columnsOf(contacts)).some((c) => JSON.parse(c.config).inverseColumnId === rel.id)).toBe(true);
      const link = (await columnsOf(inter)).find((c) => c.id === row.field_map.interactions.dossier)!;
      expect(JSON.parse(link.config).targetDatabaseId).toBe(dos);
    });

    it("rollback complet sur échec à mi-parcours (quota)", async () => {
      await fx.pool.query("INSERT INTO crm_connections (organization_id, enabled, contacts_database_id) VALUES ($1,false,$2)", [ORG_A, contacts]);
      const before = await snapshotAll();
      spaceHooks.exceeded = true;
      const r = await activateCrm(ORG_A, ADMIN, { v2: { space: { mode: "create" }, roles: { contacts: { mode: "create" } } }, ...L }, deps);
      expect(r).toEqual({ ok: false, status: 400, code: "space_quota" });
      expect(await snapshotAll()).toEqual(before);
      expect(spaceHooks.after).not.toHaveBeenCalled();
    });

    it("rollback complet sur échec après création (base d'une autre organisation raccordée)", async () => {
      await fx.pool.query("INSERT INTO crm_connections (organization_id, enabled, contacts_database_id) VALUES ($1,false,$2)", [ORG_A, contacts]);
      const before = await snapshotAll();
      const r = await activateCrm(ORG_A, ADMIN, { v2: { space: { mode: "create" }, roles: { contacts: { mode: "create" }, dossiers: { mode: "connect", databaseId: foreign } } }, ...L }, deps);
      expect(r).toEqual({ ok: false, status: 404, code: "not_found" });
      expect(await snapshotAll()).toEqual(before);
      expect(spaceHooks.after).not.toHaveBeenCalled();
    });

    it("base supprimée entre l'aperçu et l'écriture : 404, rien d'écrit", async () => {
      const sp = await freshSpace("Disparue");
      const db = await fx.seedDatabase(sp, "Vouée", [{ name: "Titre", type: "text" }]);
      await fx.pool.query("UPDATE user_databases SET deleted_at = now() WHERE id=$1", [db]);
      const before = await snapshotAll();
      const r = await activateCrm(ORG_A, ADMIN, { v2: { space: { mode: "create" }, roles: { contacts: { mode: "create" }, dossiers: { mode: "complete", databaseId: db } } }, ...L }, deps);
      expect(r).toEqual({ ok: false, status: 404, code: "not_found" });
      expect(await snapshotAll()).toEqual(before);
    });

    it("rejeu avec rôles create : 409 name_collision, rien de dupliqué", async () => {
      const sp = await freshSpace("Rejeu");
      const body = { v2: { space: { mode: "existing" as const, spaceId: sp }, roles: { contacts: { mode: "create" as const } } }, ...L };
      expect((await activateCrm(ORG_A, ADMIN, body, deps)).ok).toBe(true);
      await deactivateCrm(ORG_A, ADMIN, deps);
      const before = await snapshotAll();
      const r = await activateCrm(ORG_A, ADMIN, body, deps);
      expect(r).toEqual({ ok: false, status: 409, code: "name_collision", role: "contacts" });
      expect(await snapshotAll()).toEqual(before);
    });

    it("même base pour deux rôles (connect et complete) : duplicate_database 400, rien d'écrit", async () => {
      const before = await snapshotAll();
      const r = await activateCrm(ORG_A, ADMIN, { v2: { space: { mode: "create" }, roles: { contacts: { mode: "connect", databaseId: contacts }, dossiers: { mode: "complete", databaseId: contacts }, interactions: { mode: "create" } } }, ...L }, deps);
      expect(r).toEqual({ ok: false, status: 400, code: "duplicate_database" });
      expect(await snapshotAll()).toEqual(before);
    });

    it("deux activations simultanées avec création : sérialisées, une seule réussit, aucun doublon", async () => {
      const sp = await freshSpace("Concurrence");
      const body = { v2: { space: { mode: "existing" as const, spaceId: sp }, roles: { contacts: { mode: "create" as const } } }, ...L };
      const res = await Promise.all([activateCrm(ORG_A, ADMIN, body, deps), activateCrm(ORG_A, ADMIN, body, deps)]);
      expect(res.filter((r) => r.ok)).toHaveLength(1);
      expect(res.filter((r) => !r.ok)).toEqual([{ ok: false, status: 409, code: "name_collision", role: "contacts" }]);
      expect(await count("user_databases", "space_id=$1", [sp])).toBe(1);
      expect(await connRows()).toHaveLength(1);
    });

    it("espace create rejoué après désactivation : 409 name_collision sur le premier rôle create, rien d'écrit", async () => {
      await fx.pool.query("DELETE FROM spaces WHERE name = $1", [m.space]);
      const body = { v2: { space: { mode: "create" as const }, roles: { contacts: { mode: "create" as const }, dossiers: { mode: "create" as const } } }, ...L };
      expect((await activateCrm(ORG_A, ADMIN, body, deps)).ok).toBe(true);
      await deactivateCrm(ORG_A, ADMIN, deps);
      const before = await snapshotAll();
      const r = await activateCrm(ORG_A, ADMIN, body, deps);
      expect(r).toEqual({ ok: false, status: 409, code: "name_collision", role: "contacts" });
      expect(await snapshotAll()).toEqual(before);
    });

    it("deux activations simultanées en espace create : un seul espace, aucune base dupliquée", async () => {
      await fx.pool.query("DELETE FROM spaces WHERE name = $1", [m.space]);
      const spaces0 = await count("spaces", "name = $1", [m.space]);
      const dbs0 = await count("user_databases");
      const body = { v2: { space: { mode: "create" as const }, roles: { contacts: { mode: "create" as const } } }, ...L };
      const res = await Promise.all([activateCrm(ORG_A, ADMIN, body, deps), activateCrm(ORG_A, ADMIN, body, deps)]);
      expect(res.filter((r) => r.ok)).toHaveLength(1);
      expect(res.filter((r) => !r.ok)).toEqual([{ ok: false, status: 409, code: "name_collision", role: "contacts" }]);
      expect(await count("spaces", "name = $1", [m.space])).toBe(spaces0 + 1);
      expect(await count("user_databases")).toBe(dbs0 + 1);
    });

    it("connect : relation existante d'un seul côté, inverse ajoutée, colonne existante intacte hors inverseColumnId", async () => {
      const sp = await freshSpace("Inverse connect");
      const con = await fx.seedDatabase(sp, "Gens", [{ name: "Nom", type: "text" }]);
      const dos = await fx.seedDatabase(sp, "Affaires", [{ name: "Titre", type: "text" }]);
      const relId = await newCol(dos, "Contact", "relation", { targetDatabaseId: con, custom: "x" });
      const before = (await columnsOf(dos)).find((c) => c.id === relId)!;
      const r = await activateCrm(ORG_A, ADMIN, {
        v2: { space: { mode: "existing", spaceId: sp }, roles: { contacts: { mode: "connect", databaseId: con }, dossiers: { mode: "connect", databaseId: dos } } },
        ...L,
      }, deps);
      expect(r).toMatchObject({ ok: true });
      const after = (await columnsOf(dos)).find((c) => c.id === relId)!;
      const inverse = (await columnsOf(con)).find((c) => JSON.parse(c.config).inverseColumnId === relId);
      expect(inverse).toBeTruthy();
      expect(JSON.parse(inverse!.config).targetDatabaseId).toBe(dos);
      const { inverseColumnId, ...rest } = JSON.parse(after.config);
      expect(inverseColumnId).toBe(inverse!.id);
      expect(rest).toEqual(JSON.parse(before.config));
      expect({ ...after, config: null }).toEqual({ ...before, config: null });
    });

    it("effets secondaires de création d'espace : échec et gitOk faux journalisés avec spaceId", async () => {
      await fx.pool.query("DELETE FROM spaces WHERE name = $1", [m.space]);
      const body = { v2: { space: { mode: "create" as const }, roles: { contacts: { mode: "create" as const } } }, ...L };
      spaceHooks.after.mockImplementationOnce(async () => ({ gitOk: false }));
      expect((await activateCrm(ORG_A, ADMIN, body, deps)).ok).toBe(true);
      expect(logs.warn).toHaveBeenCalledWith(expect.objectContaining({ spaceId: expect.any(String) }), expect.any(String));
      await fx.pool.query("DELETE FROM spaces WHERE name = $1", [m.space]);
      await fx.pool.query("DELETE FROM crm_connections");
      spaceHooks.after.mockImplementationOnce(async () => {
        throw new Error("boom");
      });
      expect((await activateCrm(ORG_A, ADMIN, body, deps)).ok).toBe(true);
      expect(logs.error).toHaveBeenCalledWith(expect.objectContaining({ spaceId: expect.any(String), err: expect.any(Error) }), expect.any(String));
    });

    it("rôle partiel sans cible : unlinkedRelations non vide, aucune relation orpheline", async () => {
      const sp = await freshSpace("Partiel");
      const db = await fx.seedDatabase(sp, "Seul", [{ name: "Titre", type: "text" }]);
      const rels0 = await count("user_database_columns", "type='relation'");
      const r = await activateCrm(ORG_A, ADMIN, { v2: { space: { mode: "existing", spaceId: sp }, roles: { dossiers: { mode: "connect", databaseId: db } } }, ...L }, deps);
      expect(r).toMatchObject({ ok: true, unlinkedRelations: [m.fields.dossiers.contact] });
      expect(await count("user_database_columns", "type='relation'")).toBe(rels0);
    });

    it("POST sans rôle sur ligne existante : enabled seulement", async () => {
      await activateCrm(ORG_A, ADMIN, { bindings: three(), locale: "fr" }, deps);
      await deactivateCrm(ORG_A, ADMIN, deps);
      const before = (await connRows())[0];
      const r = await activateCrm(ORG_A, ADMIN, { v2: { space: { mode: "create" }, roles: {} }, ...L }, deps);
      expect(r).toMatchObject({ ok: true, reactivated: true, created: [], completed: [], unlinkedRelations: [] });
      const after = (await connRows())[0];
      expect({ ...after, enabled: false, updated_at: null }).toEqual({ ...before, updated_at: null });
      expect(after.enabled).toBe(true);
    });
  });
  describe("automatismes d'exemple de Dossiers", () => {
    const L = { locale: "fr" };
    let m: Awaited<ReturnType<typeof loadTemplateMessages>>;
    const UUID_RE = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/g;
    beforeAll(async () => {
      m = await loadTemplateMessages("fr");
    });
    beforeEach(async () => {
      await fx.pool.query("DELETE FROM automations");
    });
    const space = (label: string) => fx.seedSpace(ORG_A, { name: label, ownerUserId: ADMIN });
    const all = (sp: string) => ({
      v2: {
        space: { mode: "existing" as const, spaceId: sp },
        roles: { contacts: { mode: "create" as const }, dossiers: { mode: "create" as const }, interactions: { mode: "create" as const } },
      },
      ...L,
    });
    const autoRows = async () => (await fx.pool.query("SELECT * FROM automations ORDER BY name")).rows;
    const ok = <T extends { ok: boolean }>(r: T) => {
      expect(r.ok).toBe(true);
      return r as Extract<T, { ok: true }>;
    };
    const keysOf = async () => (await connRows())[0].created_automation_keys as string[];

    it("(1) organisation vide : 6 exemples désactivés sur Dossiers, créés par l'acteur, ids de l'organisation, Tally sans formulaire", async () => {
      const r = ok(await activateCrm(ORG_A, ADMIN, all(await space("Ex1")), deps));
      expect([...r.automationsCreated].sort()).toEqual([...SAMPLE_AUTOMATION_KEYS].sort());
      expect(r.automationsSkipped).toEqual([]);
      expect(r.statusOptionsAdded).toEqual([]);
      const [conn] = await connRows();
      const rows = await autoRows();
      expect(rows).toHaveLength(6);
      expect(rows.every((a) => a.enabled === false && a.created_by === ADMIN && a.database_id === conn.deals_database_id && a.space_id === null)).toBe(true);
      const mine = new Set<string>(
        (await fx.pool.query(
          "SELECT id FROM user_databases WHERE id = ANY($1) UNION SELECT id FROM user_database_columns WHERE database_id = ANY($1)",
          [[conn.contacts_database_id, conn.deals_database_id, conn.interactions_database_id]],
        )).rows.map((x) => x.id as string),
      );
      for (const a of rows) {
        const ids = JSON.stringify([a.trigger_config, a.action_config, a.graph]).match(UUID_RE) ?? [];
        expect(ids.every((id) => mine.has(id)), a.name).toBe(true);
      }
      const tally = rows.find((a) => a.trigger_type === "webhook_inbound")!;
      expect(tally.trigger_config.tallyFormId).toBeNull();
      expect(tally.trigger_config.token).toMatch(/^[0-9a-f]{48}$/);
      expect(tally.trigger_config.secret).toMatch(/^[0-9a-f]{48}$/);
      expect([...(await keysOf())].sort()).toEqual([...SAMPLE_AUTOMATION_KEYS].sort());
    });

    it("(2) réactivation sans changement : aucune insertion", async () => {
      ok(await activateCrm(ORG_A, ADMIN, all(await space("Ex2")), deps));
      const before = (await autoRows()).map((a) => a.id);
      const r = ok(await activateCrm(ORG_A, ADMIN, { ...L }, deps));
      expect(r).toMatchObject({ reactivated: true, automationsCreated: [], automationsSkipped: [], statusOptionsAdded: [] });
      expect((await autoRows()).map((a) => a.id)).toEqual(before);
    });

    it("(3) désactiver puis réactiver : aucune insertion", async () => {
      ok(await activateCrm(ORG_A, ADMIN, all(await space("Ex3")), deps));
      const before = (await autoRows()).map((a) => a.id);
      await deactivateCrm(ORG_A, ADMIN, deps);
      const r = ok(await activateCrm(ORG_A, ADMIN, { ...L }, deps));
      expect(r.automationsCreated).toEqual([]);
      expect((await autoRows()).map((a) => a.id)).toEqual(before);
    });

    it("(4) automatisme supprimé par l'utilisateur : non recréé à la réactivation", async () => {
      ok(await activateCrm(ORG_A, ADMIN, all(await space("Ex4")), deps));
      const [gone] = await autoRows();
      await fx.pool.query("DELETE FROM automations WHERE id = $1", [gone.id]);
      await deactivateCrm(ORG_A, ADMIN, deps);
      const r = ok(await activateCrm(ORG_A, ADMIN, { ...L }, deps));
      expect(r.automationsCreated).toEqual([]);
      expect(await autoRows()).toHaveLength(5);
      expect(await keysOf()).toHaveLength(6);
    });

    it("(5) Interactions non raccordé : les exemples qui créent des interactions sont sautés et listés, les autres créés", async () => {
      const sp = await space("Ex5");
      const r = ok(await activateCrm(ORG_A, ADMIN, {
        v2: { space: { mode: "existing", spaceId: sp }, roles: { contacts: { mode: "create" }, dossiers: { mode: "create" } } },
        ...L,
      }, deps));
      expect(r.automationsSkipped.sort()).toEqual(["quoteFollowUp", "wonClose"]);
      expect(r.automationsCreated).not.toContain("quoteFollowUp");
      expect(r.automationsCreated).not.toContain("wonClose");
      expect(await autoRows()).toHaveLength(r.automationsCreated.length);
      expect(r.automationsCreated.length).toBeGreaterThan(0);
      expect(await keysOf()).not.toContain("wonClose");
    });

    const failingDeps = (): CrmDeps => {
    const wrap = (tx: Record<string | symbol, unknown>) => {
      let armed = false;
      return new Proxy(tx, {
        get(t, k) {
          if (k === "insert") {
            return (table: unknown) => {
              if (table === automations) armed = true;
              else if (armed && table === crmConnections) throw new TemplateFailure({ code: "relation_conflict" });
              return (t.insert as (x: unknown) => unknown)(table);
            };
          }
          const v = t[k];
          return typeof v === "function" ? (v as (...a: unknown[]) => unknown).bind(t) : v;
        },
      });
    };
    return {
      executor: { transaction: (cb: (tx: never) => Promise<unknown>) => fx.db.transaction((tx) => cb(wrap(tx as never) as never)) } as never,
      permissionOf,
    };
    };

    it("(6) échec après l'insertion (relation_conflict) : zéro automatisme, zéro option, rien d'écrit", async () => {
      const sp = await space("Ex6");
      const failing = failingDeps();
      const dbs0 = await rowsOf("user_databases");
      await expect(activateCrm(ORG_A, ADMIN, all(sp), failing)).rejects.toBeInstanceOf(TemplateFailure);
      expect(await rowsOf("automations")).toBe(0);
      expect(await rowsOf("user_databases")).toBe(dbs0);
      expect(await connRows()).toHaveLength(0);
    });

    it("(9) option de Statut manquante : ajoutée une seule fois, existantes intactes, listée", async () => {
      const sp = await space("Ex9");
      const existing = [m.statusOptions[0], m.statusOptions[7], "Mon statut"];
      const db = await fx.seedDatabase(sp, "Mes dossiers", [
        { name: "Titre", type: "text" },
        { name: "Statut", type: "select", config: { options: existing } },
      ]);
      const body = { v2: { space: { mode: "existing" as const, spaceId: sp }, roles: { dossiers: { mode: "complete" as const, databaseId: db } } }, ...L };
      const r = ok(await activateCrm(ORG_A, ADMIN, body, deps));
      expect(r.automationsCreated.sort()).toEqual(["lostClose", "waitingFollowUp"]);
      expect(r.statusOptionsAdded).toEqual([m.statusOptions[3], m.statusOptions[8]]);
      const optionsOf = async () =>
        (await fx.pool.query("SELECT config->'options' AS o FROM user_database_columns WHERE database_id=$1 AND name='Statut'", [db])).rows[0].o;
      expect(await optionsOf()).toEqual([...existing, m.statusOptions[3], m.statusOptions[8]]);
      await deactivateCrm(ORG_A, ADMIN, deps);
      const again = ok(await activateCrm(ORG_A, ADMIN, { ...L }, deps));
      expect(again).toMatchObject({ automationsCreated: [], statusOptionsAdded: [] });
      expect(await optionsOf()).toEqual([...existing, m.statusOptions[3], m.statusOptions[8]]);
    });

    it("(11) clé déjà connue : ses options de Statut ne sont pas ajoutées, celles de l'exemple à créer le sont", async () => {
      const sp = await space("Ex11");
      const existing = [m.statusOptions[0], m.statusOptions[7], "Mon statut"];
      const db = await fx.seedDatabase(sp, "Dossiers connus", [
        { name: "Titre", type: "text" },
        { name: "Statut", type: "select", config: { options: existing } },
      ]);
      await fx.pool.query("INSERT INTO crm_connections (organization_id, enabled, created_automation_keys) VALUES ($1,false,$2)", [ORG_A, JSON.stringify(["waitingFollowUp"])]);
      const body = { v2: { space: { mode: "existing" as const, spaceId: sp }, roles: { dossiers: { mode: "complete" as const, databaseId: db } } }, ...L };
      const r = ok(await activateCrm(ORG_A, ADMIN, body, deps));
      expect(r.automationsCreated).toEqual(["lostClose"]);
      expect(r.statusOptionsAdded).toEqual([m.statusOptions[8]]);
      const o = (await fx.pool.query("SELECT config->'options' AS o FROM user_database_columns WHERE database_id=$1 AND name='Statut'", [db])).rows[0].o;
      expect(o).toEqual([...existing, m.statusOptions[8]]);
      expect(o).not.toContain(m.statusOptions[3]);
    });

    it("(12) échec forcé en mode complete avec option manquante : config.options inchangé", async () => {
      const sp = await space("Ex12");
      const existing = [m.statusOptions[0], m.statusOptions[7], "Mon statut"];
      const db = await fx.seedDatabase(sp, "Dossiers rollback", [
        { name: "Titre", type: "text" },
        { name: "Statut", type: "select", config: { options: existing } },
      ]);
      const read = async () => (await fx.pool.query("SELECT config::text AS c FROM user_database_columns WHERE database_id=$1 ORDER BY name", [db])).rows;
      const before = await read();
      const body = { v2: { space: { mode: "existing" as const, spaceId: sp }, roles: { dossiers: { mode: "complete" as const, databaseId: db } } }, ...L };
      await expect(activateCrm(ORG_A, ADMIN, body, failingDeps())).rejects.toBeInstanceOf(TemplateFailure);
      expect(await read()).toEqual(before);
      expect(await rowsOf("automations")).toBe(0);
    });

    it("(10) rôle Contacts ou Dossiers absent : Réception Tally sauté et listé", async () => {
      const sp = await space("Ex10");
      const only = (role: "contacts" | "dossiers") => ({
        v2: { space: { mode: "existing" as const, spaceId: sp }, roles: { [role]: { mode: "create" as const } } },
        ...L,
      });
      const noDossiers = ok(await activateCrm(ORG_A, ADMIN, only("contacts"), deps));
      expect(noDossiers.automationsSkipped).toContain("receptionTally");
      expect(noDossiers.automationsCreated).toEqual([]);
      await fx.pool.query("DELETE FROM crm_connections");
      const sp2 = await space("Ex10b");
      const noContacts = ok(await activateCrm(ORG_A, ADMIN, { ...only("dossiers"), v2: { ...only("dossiers").v2, space: { mode: "existing", spaceId: sp2 } } }, deps));
      expect(noContacts.automationsSkipped).toContain("receptionTally");
      expect(noContacts.automationsCreated).not.toContain("receptionTally");
      expect(await autoRows()).toHaveLength(noContacts.automationsCreated.length);
    });
  });
});
