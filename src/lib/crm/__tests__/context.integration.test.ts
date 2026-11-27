import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { randomUUID } from "node:crypto";
import { setupCrmFixture, seedCrmBases, type CrmFixture, type SeededCrm } from "./crm-fixture";
import { loadCrmContext, readRoleRows, readRoleViews } from "../context";

const URL = process.env.RELATIONS_TEST_DATABASE_URL;

describe.skipIf(!URL)("contexte CRM et lecteur de lignes (Postgres)", () => {
  let fx: CrmFixture;
  let s: SeededCrm;

  beforeAll(async () => {
    fx = await setupCrmFixture(URL!, "rh_l7_context", { tasks: true });
    s = await seedCrmBases(fx);
  }, 60000);
  afterAll(async () => {
    await fx?.teardown();
  }, 60000);
  beforeEach(async () => {
    await fx.pool.query("UPDATE user_databases SET archived_at = NULL, deleted_at = NULL");
    await fx.pool.query("UPDATE user_databases SET space_id = $1 WHERE id = ANY($2)", [
      s.spaceA,
      [s.bases.contacts, s.bases.dossiers, s.bases.interactions],
    ]);
    await fx.pool.query("UPDATE crm_connections SET enabled = true, contacts_database_id = $2, deals_database_id = $3, interactions_database_id = $4 WHERE organization_id = $1", [
      s.orgA, s.bases.contacts, s.bases.dossiers, s.bases.interactions,
    ]);
  });

  it("connexion complète : contexte avec ids de colonnes et de bases", async () => {
    const ctx = await loadCrmContext(s.orgA, s.editor, s.deps);
    expect(ctx).not.toBeNull();
    expect(ctx!.orgId).toBe(s.orgA);
    expect(ctx!.userId).toBe(s.editor);
    expect(ctx!.fieldColumn("dossiers", "montant")).toBe(s.col["dossiers.montant"]);
    expect(ctx!.fieldColumn("contacts", "nom")).toBe(s.col["contacts.nom"]);
    expect(ctx!.databaseId("dossiers")).toBe(s.bases.dossiers);
    expect(ctx!.spaceId("dossiers")).toBe(s.spaceA);
    expect(ctx!.columns.dossiers.map((c) => c.id)).toContain(s.col["dossiers.statut"]);
    expect(ctx!.columns.dossiers.every((c) => typeof c.name === "string" && typeof c.type === "string")).toBe(true);
  });

  it("enabled=false, rôle manquant, archivée, corbeille, autre organisation, sans permission : null", async () => {
    await fx.pool.query("UPDATE crm_connections SET enabled = false WHERE organization_id = $1", [s.orgA]);
    expect(await loadCrmContext(s.orgA, s.editor, s.deps)).toBeNull();
    await fx.pool.query("UPDATE crm_connections SET enabled = true, interactions_database_id = NULL WHERE organization_id = $1", [s.orgA]);
    expect(await loadCrmContext(s.orgA, s.editor, s.deps)).toBeNull();
    await fx.pool.query("UPDATE crm_connections SET interactions_database_id = $2 WHERE organization_id = $1", [s.orgA, s.bases.interactions]);
    await fx.pool.query("UPDATE user_databases SET archived_at = now() WHERE id = $1", [s.bases.contacts]);
    expect(await loadCrmContext(s.orgA, s.editor, s.deps)).toBeNull();
    await fx.pool.query("UPDATE user_databases SET archived_at = NULL, deleted_at = now() WHERE id = $1", [s.bases.contacts]);
    expect(await loadCrmContext(s.orgA, s.editor, s.deps)).toBeNull();
    await fx.pool.query("UPDATE user_databases SET deleted_at = NULL WHERE id = $1", [s.bases.contacts]);
    await fx.pool.query("UPDATE crm_connections SET deals_database_id = $2 WHERE organization_id = $1", [s.orgA, s.foreign.dossiers]);
    expect(await loadCrmContext(s.orgA, s.editor, s.deps)).toBeNull();
    await fx.pool.query("UPDATE crm_connections SET deals_database_id = $2 WHERE organization_id = $1", [s.orgA, s.bases.dossiers]);
    expect(await loadCrmContext(s.orgA, s.outsider, s.deps)).toBeNull();
    expect(await loadCrmContext(randomUUID(), s.editor, s.deps)).toBeNull();
    expect(await loadCrmContext(s.orgB, s.editor, s.deps)).toBeNull();
  });

  it("permission d'espace retirée sur Dossiers seulement : null", async () => {
    const other = randomUUID();
    await fx.pool.query("INSERT INTO spaces (id, organization_id, name) VALUES ($1,$2,'Fermé')", [other, s.orgA]);
    await fx.pool.query("UPDATE user_databases SET space_id = $1 WHERE id = $2", [other, s.bases.dossiers]);
    expect(await loadCrmContext(s.orgA, s.editor, s.deps)).toBeNull();
  });

  it("fieldColumn rend null quand la colonne est morte", async () => {
    await fx.pool.query("DELETE FROM user_database_columns WHERE id = $1", [s.col["dossiers.montant"]]);
    const ctx = await loadCrmContext(s.orgA, s.editor, s.deps);
    expect(ctx).not.toBeNull();
    expect(ctx!.fieldColumn("dossiers", "montant")).toBeNull();
    expect(ctx!.fieldColumn("dossiers", "titre")).toBe(s.col["dossiers.titre"]);
    expect(ctx!.fieldColumn("dossiers", "inconnu")).toBeNull();
    await fx.pool.query(
      "INSERT INTO user_database_columns (id, database_id, name, type, position) VALUES ($1,$2,'Montant','number',2)",
      [s.col["dossiers.montant"], s.bases.dossiers],
    );
  });

  it("fieldColumn rend null quand le type est incompatible", async () => {
    await fx.pool.query("UPDATE user_database_columns SET type = 'text' WHERE id = $1", [s.col["dossiers.montant"]]);
    const ctx = await loadCrmContext(s.orgA, s.editor, s.deps);
    expect(ctx!.fieldColumn("dossiers", "montant")).toBeNull();
    await fx.pool.query("UPDATE user_database_columns SET type = 'number' WHERE id = $1", [s.col["dossiers.montant"]]);
  });

  it("readRoleRows : lignes de la base du rôle seulement, triées, forme DbRow", async () => {
    // ligne glissée dans la base voisine : ne doit jamais apparaître
    await fx.pool.query("INSERT INTO user_database_rows (database_id, cells, position) VALUES ($1,'{}',0)", [s.bases.contacts]);
    const ctx = await loadCrmContext(s.orgA, s.editor, s.deps);
    const rows = await readRoleRows(ctx!, "dossiers", s.deps);
    expect(rows.map((r) => r.id)).toEqual(s.dossierIds);
    expect(rows.every((r) => r.databaseId === s.bases.dossiers)).toBe(true);
    expect(typeof rows[0].createdAt).toBe("string");
    expect(typeof rows[0].updatedAt).toBe("string");
    expect(rows[0].cells[s.col["dossiers.titre"]]).toBe("Dossier 1");
    const contacts = await readRoleRows(ctx!, "contacts", s.deps);
    expect(contacts.some((r) => s.dossierIds.includes(r.id))).toBe(false);
    expect(contacts).toHaveLength(5);
    await fx.pool.query("DELETE FROM user_database_rows WHERE database_id = $1 AND cells = '{}'::jsonb", [s.bases.contacts]);
  });

  it("readRoleViews : vue personnelle d'un autre exclue", async () => {
    const ctx = await loadCrmContext(s.orgA, s.viewer, s.deps);
    const views = await readRoleViews(ctx!, s.deps);
    const names = views.map((v) => v.name);
    expect(names).toContain("Tableau");
    expect(names).toContain("Perso viewer");
    expect(names).not.toContain("Perso editor");
  });

  it("canEdit : faux pour viewer, vrai pour editor", async () => {
    const v = await loadCrmContext(s.orgA, s.viewer, s.deps);
    const e = await loadCrmContext(s.orgA, s.editor, s.deps);
    expect(v!.canEdit("dossiers")).toBe(false);
    expect(v!.canEdit("interactions")).toBe(false);
    expect(e!.canEdit("dossiers")).toBe(true);
    expect(e!.canEdit("interactions")).toBe(true);
  });

  it("canEdit par rôle : editor sur Dossiers seulement", async () => {
    const ro = randomUUID();
    await fx.pool.query("INSERT INTO spaces (id, organization_id, name) VALUES ($1,$2,'RO')", [ro, s.orgA]);
    s.levels[s.editor][ro] = "viewer";
    await fx.pool.query("UPDATE user_databases SET space_id = $1 WHERE id = $2", [ro, s.bases.interactions]);
    const e = await loadCrmContext(s.orgA, s.editor, s.deps);
    expect(e!.canEdit("dossiers")).toBe(true);
    expect(e!.canEdit("interactions")).toBe(false);
  });
});
