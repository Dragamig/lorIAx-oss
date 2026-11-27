import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { randomUUID } from "node:crypto";
import { setupCrmFixture, seedCrmBases, type CrmFixture, type SeededCrm } from "./crm-fixture";
import { loadCrmContext } from "../context";
import { loadPipeline } from "../pipeline";

const URL = process.env.RELATIONS_TEST_DATABASE_URL;
const Q = { mine: false, late: false, ownerId: null };

describe.skipIf(!URL)("route pipeline (Postgres)", () => {
  let fx: CrmFixture;
  let s: SeededCrm;

  beforeAll(async () => {
    fx = await setupCrmFixture(URL!, "rh_l7_pipeline", { tasks: true });
    s = await seedCrmBases(fx);
  }, 60000);
  afterAll(async () => {
    await fx?.teardown();
  }, 60000);
  beforeEach(async () => {
    await fx.pool.query("DELETE FROM user_database_views WHERE database_id = $1 AND name LIKE 'Pipeline%'", [s.bases.dossiers]);
    await fx.pool.query("UPDATE user_database_columns SET config = $2 WHERE id = $1", [
      s.col["dossiers.statut"],
      JSON.stringify({ options: ["Prospect", "Devis", "Signé", "Perdu"] }),
    ]);
  });

  const run = async (user: string, q: Partial<typeof Q> & { mine?: boolean; late?: boolean } = {}) => {
    const ctx = await loadCrmContext(s.orgA, user, s.deps);
    expect(ctx).not.toBeNull();
    return loadPipeline(ctx!, { ...Q, ...q }, s.deps);
  };

  it("sans mine : tous les dossiers, voies depuis les options + Sans valeur", async () => {
    const p = await run(s.editor);
    expect(p.deals).toHaveLength(6);
    expect(p.lanes.map((l) => l.key)).toEqual(["Prospect", "Devis", "Signé", "Perdu", ""]);
    expect(p.statusColumnId).toBe(s.col["dossiers.statut"]);
    expect(p.amountColumnId).toBe(s.col["dossiers.montant"]);
    expect(p.canEdit).toBe(true);
    expect(p.deals[0].contactName).toBe("Contact 1");
  });

  it("mine=1 : seulement les dossiers de l'utilisateur", async () => {
    const p = await run(s.editor, { mine: true });
    expect(p.deals.map((d) => d.title)).toEqual(["Dossier 1", "Dossier 3", "Dossier 5"]);
    expect(p.mineAvailable).toBe(true);
  });

  it("mine=1 sans champ responsable raccordé : tous les dossiers, mineAvailable false", async () => {
    await fx.pool.query("UPDATE crm_connections SET field_map = jsonb_set(field_map, '{dossiers}', (field_map->'dossiers') - 'responsable') WHERE organization_id = $1", [s.orgA]);
    try {
      const p = await run(s.editor, { mine: true });
      expect(p.deals).toHaveLength(6);
      expect(p.mineAvailable).toBe(false);
    } finally {
      await fx.pool.query("UPDATE crm_connections SET field_map = jsonb_set(field_map, '{dossiers,responsable}', to_jsonb($2::text)) WHERE organization_id = $1", [s.orgA, s.col["dossiers.responsable"]]);
    }
  });

  it("sans vue Pipeline : totaux non pondérés, tout est ouvert", async () => {
    const p = await run(s.editor, { late: true });
    expect(p.totals).toMatchObject({ closedLanes: [], weights: {}, showWeighted: false });
    expect(p.totalsViewId).toBeNull();
    expect(p.deals).toHaveLength(0);
  });

  it("totaux de la première vue partagée valide ; late=1 exclut les statuts clos", async () => {
    await fx.pool.query(
      `INSERT INTO user_database_views (database_id, name, type, scope, position, config) VALUES
        ($1,'Pipeline A','kanban','shared',5,$2)`,
      [s.bases.dossiers, JSON.stringify({ kanbanTotals: { amountColumnId: "ignore", closedLanes: ["Signé", "Perdu"], weights: { Devis: 50 }, showWeighted: true } })],
    );
    await fx.pool.query("UPDATE user_database_rows SET cells = cells || $2::jsonb WHERE database_id = $1", [
      s.bases.dossiers,
      JSON.stringify({ [s.col["dossiers.relance"]]: "2020-01-01" }),
    ]);
    try {
      const p = await run(s.editor, { late: true });
      expect(p.totals).toMatchObject({ amountColumnId: s.col["dossiers.montant"], closedLanes: ["Signé", "Perdu"], showWeighted: true });
      expect(p.totalsViewId).not.toBeNull();
      expect(p.deals.map((d) => d.status)).not.toContain("Signé");
      expect(p.deals.map((d) => d.status)).not.toContain("Perdu");
      expect(p.deals).toHaveLength(4);
    } finally {
      await fx.pool.query("UPDATE user_database_rows SET cells = cells - $2 WHERE database_id = $1", [s.bases.dossiers, s.col["dossiers.relance"]]);
    }
  });

  it("contact dans une autre base : contactName null", async () => {
    const { rows } = await fx.pool.query(
      "INSERT INTO user_database_rows (database_id, cells, position) VALUES ($1,$2,99) RETURNING id",
      [s.bases.dossiers, JSON.stringify({ [s.col["dossiers.titre"]]: "Orphelin", [s.col["dossiers.contact"]]: [s.dossierIds[0]] })],
    );
    try {
      const p = await run(s.editor);
      expect(p.deals.find((d) => d.title === "Orphelin")?.contactName).toBeNull();
    } finally {
      await fx.pool.query("DELETE FROM user_database_rows WHERE id = $1", [rows[0].id]);
    }
  });

  it("modification d'une cellule : visible au rappel", async () => {
    const id = s.dossierIds[0];
    await fx.pool.query("UPDATE user_database_rows SET cells = cells || $2::jsonb WHERE id = $1", [
      id,
      JSON.stringify({ [s.col["dossiers.statut"]]: "Signé" }),
    ]);
    try {
      const p = await run(s.editor);
      expect(p.deals.find((d) => d.id === id)?.status).toBe("Signé");
    } finally {
      await fx.pool.query("UPDATE user_database_rows SET cells = cells || $2::jsonb WHERE id = $1", [id, JSON.stringify({ [s.col["dossiers.statut"]]: "Prospect" })]);
    }
  });

  it("owners : membres de l'organisation seulement, nom sans e-mail", async () => {
    const foreignUser = randomUUID();
    await fx.pool.query("INSERT INTO users (id, name) VALUES ($1,'Etranger')", [foreignUser]);
    const { rows } = await fx.pool.query(
      "INSERT INTO user_database_rows (database_id, cells, position) VALUES ($1,$2,98) RETURNING id",
      [s.bases.dossiers, JSON.stringify({ [s.col["dossiers.titre"]]: "Etranger", [s.col["dossiers.responsable"]]: [foreignUser] })],
    );
    try {
      const p = await run(s.editor);
      expect(p.owners.map((o) => o.name)).toEqual(["Editor", "Viewer"]);
      expect(Object.keys(p.owners[0]).sort()).toEqual(["id", "name"]);
    } finally {
      await fx.pool.query("DELETE FROM user_database_rows WHERE id = $1", [rows[0].id]);
    }
  });

  it("montant formule : évalué et compté", async () => {
    await fx.pool.query("UPDATE user_database_columns SET type = 'formula', config = $2 WHERE id = $1", [
      s.col["dossiers.montant"],
      JSON.stringify({ formula: "2 + 3" }),
    ]);
    try {
      const p = await run(s.editor);
      expect(p.deals.every((d) => d.amount === 5)).toBe(true);
    } finally {
      await fx.pool.query("UPDATE user_database_columns SET type = 'number', config = '{}' WHERE id = $1", [s.col["dossiers.montant"]]);
    }
  });

  it("Statut raccordé devenu invalide (bad) : statusColumnId nul, écriture impossible, champ signalé", async () => {
    await fx.pool.query("UPDATE user_database_columns SET type = 'text' WHERE id = $1", [s.col["dossiers.statut"]]);
    try {
      const p = await run(s.editor);
      expect(p.statusColumnId).toBeNull();
      expect(p.canEdit).toBe(false);
      expect(p.missing).toEqual(["statut"]);
      expect(p.deals.length).toBeGreaterThan(0);
    } finally {
      await fx.pool.query("UPDATE user_database_columns SET type = 'select' WHERE id = $1", [s.col["dossiers.statut"]]);
    }
  });

  it("connexion complète : aucun champ manquant", async () => {
    const p = await run(s.editor);
    expect(p.missing).toEqual([]);
    expect(p.statusColumnId).toBe(s.col["dossiers.statut"]);
  });

  it("viewer : lecture, canEdit false ; autre organisation : null", async () => {
    const p = await run(s.viewer);
    expect(p.canEdit).toBe(false);
    expect(p.deals).toHaveLength(6);
    expect(await loadCrmContext(s.orgB, s.editor, s.deps)).toBeNull();
  });
});
