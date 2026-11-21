import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from "vitest";
import { randomUUID } from "node:crypto";
import type { PermissionLevel } from "@/types";
import { setupCrmFixture } from "./crm-fixture";
import { loadConnection, saveConnection, listCandidates, type CrmDeps } from "../connection";

const URL = process.env.RELATIONS_TEST_DATABASE_URL;

describe.skipIf(!URL)("connexion CRM résolue et cloisonnée (Postgres)", () => {
  let fx: Awaited<ReturnType<typeof setupCrmFixture>>;
  const ORG_A = randomUUID();
  const ORG_B = randomUUID();
  const SPACE_A = randomUUID();
  const SPACE_A_RO = randomUUID();
  const SPACE_B = randomUUID();
  const VIEWER = randomUUID();
  const EDITOR = randomUUID();
  const levels: Record<string, Record<string, PermissionLevel>> = {};
  const permissionOf = vi.fn(async (userId: string, spaceId: string) => levels[userId]?.[spaceId] ?? null);
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
  function fullMap() {
    return {
      contacts: { nom: col.cNom, email: col.cMail },
      dossiers: { titre: col.dTitre, statut: col.dStatut, contact: col.dContact },
      interactions: { date: col.iDate, type: col.iType, dossier: col.iDossier },
    };
  }
  async function connect(opts: { fieldMap?: unknown; roles?: Record<string, string | null> } = {}) {
    const r = { contacts, dossiers, interactions, ...opts.roles };
    await fx.pool.query("DELETE FROM crm_connections WHERE organization_id = $1", [ORG_A]);
    await fx.pool.query(
      `INSERT INTO crm_connections (organization_id, enabled, contacts_database_id, deals_database_id,
        interactions_database_id, field_map) VALUES ($1, true, $2, $3, $4, $5)`,
      [ORG_A, r.contacts, r.dossiers, r.interactions, JSON.stringify(opts.fieldMap ?? fullMap())],
    );
  }
  async function snapshot() {
    const { rows } = await fx.pool.query("SELECT * FROM crm_connections WHERE organization_id = $1", [ORG_A]);
    return JSON.stringify(rows);
  }

  beforeAll(async () => {
    fx = await setupCrmFixture(URL!, "rh_l6_connection");
    deps = { executor: fx.db, permissionOf };
    await fx.pool.query("INSERT INTO organizations (id, slug, name) VALUES ($1,'a','A'),($2,'b','B')", [ORG_A, ORG_B]);
    await fx.pool.query(
      "INSERT INTO spaces (id, organization_id, name) VALUES ($1,$4,'Espace A'),($2,$4,'Espace RO'),($3,$5,'Espace B')",
      [SPACE_A, SPACE_A_RO, SPACE_B, ORG_A, ORG_B],
    );
    await fx.pool.query("INSERT INTO users (id) VALUES ($1),($2)", [VIEWER, EDITOR]);
    levels[VIEWER] = { [SPACE_A]: "viewer", [SPACE_A_RO]: "viewer", [SPACE_B]: "viewer" };
    levels[EDITOR] = { [SPACE_A]: "editor", [SPACE_A_RO]: "viewer", [SPACE_B]: "editor" };
    contacts = await newDb(SPACE_A, "Contacts");
    dossiers = await newDb(SPACE_A, "Dossiers");
    interactions = await newDb(SPACE_A, "Interactions");
    foreign = await newDb(SPACE_B, "Étrangère");
    col.cNom = await newCol(contacts, "Nom", "text");
    col.cMail = await newCol(contacts, "Mail", "email");
    col.dTitre = await newCol(dossiers, "Titre", "text");
    col.dStatut = await newCol(dossiers, "Statut", "select");
    col.dContact = await newCol(dossiers, "Contact", "relation", { targetDatabaseId: contacts });
    col.iDate = await newCol(interactions, "Date", "date");
    col.iType = await newCol(interactions, "Type", "select");
    col.iDossier = await newCol(interactions, "Dossier", "relation", { targetDatabaseId: dossiers });
    col.fCol = await newCol(foreign, "Nom", "text");
  });
  afterAll(async () => {
    await fx?.teardown();
  });
  beforeEach(async () => {
    permissionOf.mockClear();
    await fx.pool.query("UPDATE user_databases SET archived_at = NULL, deleted_at = NULL");
    await fx.pool.query("UPDATE user_databases SET space_id = $1 WHERE id = ANY($2)", [
      SPACE_A,
      [contacts, dossiers, interactions],
    ]);
    await fx.pool.query("UPDATE user_database_columns SET type = 'text' WHERE id = $1", [col.cNom]);
    await fx.pool.query("DELETE FROM crm_connections");
  });

  it("connexion complète : tous les champs ok", async () => {
    await connect();
    const r = await loadConnection(ORG_A, EDITOR, "editor", deps);
    expect(r?.enabled).toBe(true);
    expect(r?.complete).toBe(true);
    expect(r?.badTotal).toBe(0);
    expect(r?.okTotal).toBe(8);
    expect(r?.roles.dossiers).toMatchObject({ connected: true, databaseName: "Dossiers", spaceName: "Espace A" });
  });

  it("aucune ligne : null", async () => {
    expect(await loadConnection(ORG_A, EDITOR, "editor", deps)).toBeNull();
  });

  it("base d'une autre organisation raccordée en base : identique à une base supprimée", async () => {
    await connect({ roles: { contacts: foreign } });
    const other = await loadConnection(ORG_A, EDITOR, "viewer", deps);
    await fx.pool.query("UPDATE user_databases SET deleted_at = now() WHERE id = $1", [contacts]);
    await connect({ roles: { contacts } });
    const deleted = await loadConnection(ORG_A, EDITOR, "viewer", deps);
    expect(other?.roles.contacts.connected).toBe(false);
    expect(other?.roles.contacts).toEqual(deleted?.roles.contacts);
    expect(other?.roles.contacts.databaseName).toBeUndefined();
    expect(other?.roles.contacts.spaceName).toBeUndefined();
  });

  it("archivée, en corbeille, espace déplacé vers B : non raccordé", async () => {
    await connect();
    await fx.pool.query("UPDATE user_databases SET archived_at = now() WHERE id = $1", [contacts]);
    await fx.pool.query("UPDATE user_databases SET deleted_at = now() WHERE id = $1", [dossiers]);
    await fx.pool.query("UPDATE user_databases SET space_id = $1 WHERE id = $2", [SPACE_B, interactions]);
    const r = await loadConnection(ORG_A, EDITOR, "editor", deps);
    expect(r?.roles.contacts.connected).toBe(false);
    expect(r?.roles.dossiers.connected).toBe(false);
    expect(r?.roles.interactions.connected).toBe(false);
    expect(r?.complete).toBe(false);
  });

  it("viewer : lecture ok, écriture non raccordé", async () => {
    await connect();
    const read = await loadConnection(ORG_A, VIEWER, "viewer", deps);
    const write = await loadConnection(ORG_A, VIEWER, "editor", deps);
    expect(read?.roles.contacts.connected).toBe(true);
    expect(write?.roles.contacts.connected).toBe(false);
  });

  it("colonne supprimée : bad column_missing", async () => {
    await connect();
    await fx.pool.query("DELETE FROM user_database_columns WHERE id = $1", [col.cMail]);
    const r = await loadConnection(ORG_A, EDITOR, "editor", deps);
    expect(r?.roles.contacts.fields.email).toMatchObject({ state: "bad", code: "column_missing" });
    await fx.pool.query(
      "INSERT INTO user_database_columns (id, database_id, name, type) VALUES ($1,$2,'Mail','email')",
      [col.cMail, contacts],
    );
  });

  it("colonne passée en type incompatible : bad type_incompatible", async () => {
    await connect();
    await fx.pool.query("UPDATE user_database_columns SET type = 'date' WHERE id = $1", [col.cNom]);
    const r = await loadConnection(ORG_A, EDITOR, "editor", deps);
    expect(r?.roles.contacts.fields.nom).toMatchObject({ state: "bad", code: "type_incompatible" });
    expect(r?.complete).toBe(false);
  });

  it("relation vers une autre base : bad relation_target", async () => {
    await connect();
    await fx.pool.query("UPDATE user_database_columns SET config = $2 WHERE id = $1", [
      col.dContact,
      JSON.stringify({ targetDatabaseId: interactions }),
    ]);
    const r = await loadConnection(ORG_A, EDITOR, "editor", deps);
    expect(r?.roles.dossiers.fields.contact).toMatchObject({ state: "bad", code: "relation_target" });
    await fx.pool.query("UPDATE user_database_columns SET config = $2 WHERE id = $1", [
      col.dContact,
      JSON.stringify({ targetDatabaseId: contacts }),
    ]);
  });

  it("field_map corrompu en base (tableau) : aucune exception, champs none", async () => {
    await connect({ fieldMap: ["x", 1] });
    const r = await loadConnection(ORG_A, EDITOR, "editor", deps);
    expect(r?.roles.contacts.connected).toBe(true);
    expect(r?.roles.contacts.fields.nom).toEqual({ state: "none" });
    expect(r?.okTotal).toBe(0);
  });

  it("saveConnection refuse 404 une base de B, une base viewer, une base archivée, sans rien écrire", async () => {
    await connect();
    const before = await snapshot();
    await fx.pool.query("UPDATE user_databases SET space_id = $1 WHERE id = $2", [SPACE_A_RO, interactions]);
    const archived = await newDb(SPACE_A, "Archivée");
    await fx.pool.query("UPDATE user_databases SET archived_at = now() WHERE id = $1", [archived]);
    const notFound = { ok: false, status: 404, code: "not_found" };
    expect(await saveConnection(ORG_A, EDITOR, { roles: { contacts: foreign }, fieldMap: {} }, deps)).toEqual(notFound);
    expect(await saveConnection(ORG_A, EDITOR, { roles: { interactions }, fieldMap: {} }, deps)).toEqual(notFound);
    expect(await saveConnection(ORG_A, EDITOR, { roles: { contacts: archived }, fieldMap: {} }, deps)).toEqual(notFound);
    expect(await saveConnection(ORG_A, VIEWER, { roles: { contacts }, fieldMap: {} }, deps)).toEqual(notFound);
    expect(await snapshot()).toBe(before);
  });

  it("saveConnection refuse 400 column_not_in_database pour une colonne d'une autre base", async () => {
    await connect();
    const before = await snapshot();
    const foreignCol = await saveConnection(
      ORG_A,
      EDITOR,
      { roles: {}, fieldMap: { contacts: { nom: col.fCol } } },
      deps,
    );
    const sameOrgOtherDb = await saveConnection(
      ORG_A,
      EDITOR,
      { roles: {}, fieldMap: { contacts: { nom: col.dTitre } } },
      deps,
    );
    const expected = { ok: false, status: 400, code: "column_not_in_database" };
    expect(foreignCol).toEqual(expected);
    expect(sameOrgOtherDb).toEqual(expected);
    expect(await snapshot()).toBe(before);
  });

  it("rôle conservé : viewer, base hors organisation, archivée ou en corbeille donnent 404 sans écriture", async () => {
    await connect();
    const before = await snapshot();
    const input = { roles: {}, fieldMap: { contacts: { nom: col.cNom } } };
    const notFound = { ok: false, status: 404, code: "not_found" };
    expect(await saveConnection(ORG_A, VIEWER, input, deps)).toEqual(notFound);
    await fx.pool.query("UPDATE user_databases SET space_id = $1 WHERE id = $2", [SPACE_B, contacts]);
    expect(await saveConnection(ORG_A, EDITOR, input, deps)).toEqual(notFound);
    await fx.pool.query("UPDATE user_databases SET space_id = $1, archived_at = now() WHERE id = $2", [SPACE_A, contacts]);
    expect(await saveConnection(ORG_A, EDITOR, input, deps)).toEqual(notFound);
    await fx.pool.query("UPDATE user_databases SET archived_at = NULL, deleted_at = now() WHERE id = $1", [contacts]);
    expect(await saveConnection(ORG_A, EDITOR, input, deps)).toEqual(notFound);
    expect(await snapshot()).toBe(before);
  });

  it("doublon impliquant une base d'une autre organisation : 404, pas 400", async () => {
    await connect();
    const r = await saveConnection(ORG_A, EDITOR, { roles: { contacts: foreign, dossiers: foreign }, fieldMap: {} }, deps);
    expect(r).toEqual({ ok: false, status: 404, code: "not_found" });
  });

  it("saveConnection refuse 400 duplicate_database", async () => {
    await connect();
    const before = await snapshot();
    const r = await saveConnection(ORG_A, EDITOR, { roles: { contacts, dossiers: contacts }, fieldMap: {} }, deps);
    expect(r).toEqual({ ok: false, status: 400, code: "duplicate_database" });
    expect(await snapshot()).toBe(before);
  });

  it("saveConnection crée la ligne, la met à jour, sans toucher enabled ni createdDatabaseIds", async () => {
    const created = [randomUUID()];
    await fx.pool.query(
      "INSERT INTO crm_connections (organization_id, enabled, created_database_ids) VALUES ($1, true, $2)",
      [ORG_A, JSON.stringify(created)],
    );
    const r = await saveConnection(
      ORG_A,
      EDITOR,
      { roles: { contacts, dossiers, interactions }, fieldMap: fullMap() },
      deps,
    );
    expect(r).toEqual({ ok: true });
    const { rows } = await fx.pool.query("SELECT * FROM crm_connections WHERE organization_id = $1", [ORG_A]);
    expect(rows).toHaveLength(1);
    expect(rows[0].enabled).toBe(true);
    expect(rows[0].created_database_ids).toEqual(created);
    expect(rows[0].updated_by).toBe(EDITOR);
    expect(rows[0].contacts_database_id).toBe(contacts);
    expect(rows[0].deals_database_id).toBe(dossiers);
    expect(rows[0].field_map.contacts.nom).toBe(col.cNom);
    const loaded = await loadConnection(ORG_A, EDITOR, "editor", deps);
    expect(loaded?.complete).toBe(true);
  });

  it("I3 : un rôle absent du corps garde sa correspondance, même base archivée puis désarchivée", async () => {
    await connect();
    await fx.pool.query("UPDATE user_databases SET archived_at = now() WHERE id = $1", [dossiers]);
    const r = await saveConnection(ORG_A, EDITOR, { roles: {}, fieldMap: { contacts: { nom: col.cNom, email: null } } }, deps);
    expect(r).toEqual({ ok: true });
    await fx.pool.query("UPDATE user_databases SET archived_at = NULL WHERE id = $1", [dossiers]);
    const { rows } = await fx.pool.query("SELECT * FROM crm_connections WHERE organization_id = $1", [ORG_A]);
    expect(rows[0].field_map.dossiers).toMatchObject({ titre: col.dTitre, statut: col.dStatut, contact: col.dContact });
    expect(rows[0].field_map.contacts.email).toBeNull();
    const loaded = await loadConnection(ORG_A, EDITOR, "editor", deps);
    expect(loaded?.roles.dossiers.connected).toBe(true);
    expect(loaded?.roles.dossiers.ok).toBeGreaterThan(0);
  });

  it("I3 : dissocier un rôle ou changer sa base efface sa correspondance", async () => {
    await connect();
    await saveConnection(ORG_A, EDITOR, { roles: { interactions: null }, fieldMap: {} }, deps);
    let { rows } = await fx.pool.query("SELECT * FROM crm_connections WHERE organization_id = $1", [ORG_A]);
    expect(rows[0].interactions_database_id).toBeNull();
    expect(rows[0].field_map.interactions ?? {}).toEqual({});
    expect(rows[0].field_map.contacts.nom).toBe(col.cNom);
    await saveConnection(ORG_A, EDITOR, { roles: { interactions }, fieldMap: { interactions: { date: col.iDate } } }, deps);
    ({ rows } = await fx.pool.query("SELECT * FROM crm_connections WHERE organization_id = $1", [ORG_A]));
    expect(rows[0].field_map.interactions).toEqual({ date: col.iDate });
  });

  it("listCandidates ne rend jamais une base de B ni une base en lecture seule", async () => {
    await fx.pool.query("UPDATE user_databases SET space_id = $1 WHERE id = $2", [SPACE_A_RO, interactions]);
    const list = await listCandidates(ORG_A, EDITOR, "contacts", deps);
    const ids = list.map((c) => c.databaseId);
    expect(ids).toContain(contacts);
    expect(ids).not.toContain(foreign);
    expect(ids).not.toContain(interactions);
    const asViewer = await listCandidates(ORG_A, VIEWER, "contacts", deps);
    expect(asViewer).toEqual([]);
    const c = list.find((x) => x.databaseId === contacts)!;
    expect(c.proposal.nom).toBe(col.cNom);
    expect(c.compatible).toBe(true);
    expect(c.score).toBe(2);
  });

  it("une base sans la colonne Statut est almost avec missing = [statut]", async () => {
    const d = await newDb(SPACE_A, "Dossiers partiels");
    await newCol(d, "Titre", "text");
    await newCol(d, "Contact", "relation", { targetDatabaseId: contacts });
    const c = (await listCandidates(ORG_A, EDITOR, "dossiers", deps)).find((x) => x.databaseId === d)!;
    expect(c.status).toBe("almost");
    expect(c.compatible).toBe(false);
    expect(c.missing[0]).toEqual({ fieldKey: "statut", name: "statut", type: "select", cause: "absent" });
    expect(c.missing.map((m) => m.fieldKey)).not.toContain("contact");
  });

  it("une base sans aucun champ obligatoire est none", async () => {
    const d = await newDb(SPACE_A, "Vide de sens");
    await newCol(d, "Divers", "number");
    const c = (await listCandidates(ORG_A, EDITOR, "dossiers", deps)).find((x) => x.databaseId === d)!;
    expect(c.status).toBe("none");
    expect(c.compatible).toBe(false);
  });

  it("les libellés et la cible de relation connue sont transmis à la classification", async () => {
    const d = await newDb(SPACE_A, "Dossiers libellés");
    await newCol(d, "Titre", "text");
    await newCol(d, "Statut", "select");
    const list = await listCandidates(ORG_A, EDITOR, "dossiers", deps, {
      fieldLabel: (role, key) => `${role}.${key}`,
      relationTargetKnown: true,
    });
    const c = list.find((x) => x.databaseId === d)!;
    expect(c.status).toBe("almost");
    expect(c.missing.map((m) => [m.fieldKey, m.name])).toContainEqual(["contact", "dossiers.contact"]);
    expect(c.missing.map((m) => m.fieldKey)).not.toContain("statut");
  });

  it("les anciens appelants lisent compatible inchangé", async () => {
    const c = (await listCandidates(ORG_A, EDITOR, "contacts", deps)).find((x) => x.databaseId === contacts)!;
    expect(c.status).toBe("compatible");
    expect(c.compatible).toBe(true);
    expect(c.missing.map((m) => m.fieldKey)).not.toContain("nom");
  });

  it("permissionOf n'est jamais appelée pour une base d'une autre organisation", async () => {
    await connect({ roles: { contacts: foreign } });
    await loadConnection(ORG_A, EDITOR, "viewer", deps);
    await saveConnection(ORG_A, EDITOR, { roles: { contacts: foreign }, fieldMap: {} }, deps);
    await listCandidates(ORG_A, EDITOR, null, deps);
    const spacesAsked = permissionOf.mock.calls.map((c) => c[1]);
    expect(spacesAsked).not.toContain(SPACE_B);
    expect(spacesAsked.length).toBeGreaterThan(0);
  });
});
