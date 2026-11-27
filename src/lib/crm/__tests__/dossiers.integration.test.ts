import { randomUUID } from "node:crypto";
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { setupCrmFixture, seedCrmBases, type CrmFixture, type SeededCrm } from "./crm-fixture";
import { loadCrmContext } from "../context";
import { loadDossiers } from "../dossiers";

const URL = process.env.RELATIONS_TEST_DATABASE_URL;

describe.skipIf(!URL)("dossiers (Postgres)", () => {
  let fx: CrmFixture;
  let s: SeededCrm;

  beforeAll(async () => {
    fx = await setupCrmFixture(URL!, "rh_l7_dossiers");
    s = await seedCrmBases(fx);
  }, 60000);
  afterAll(async () => {
    await fx?.teardown();
  }, 60000);

  const load = async (user: string) => {
    const ctx = await loadCrmContext(s.orgA, user, s.deps);
    expect(ctx).not.toBeNull();
    return loadDossiers(ctx!, s.deps);
  };

  it("colonnes, lignes sans pagination, base et espace", async () => {
    const r = await load(s.editor);
    expect(r.databaseId).toBe(s.bases.dossiers);
    expect(r.spaceId).toBe(s.spaceA);
    expect(r.columns.map((c) => c.id)).toContain(s.col["dossiers.titre"]);
    expect(r.rows).toHaveLength(6);
    expect(r.rows[0].cells[s.col["dossiers.titre"]]).toBe("Dossier 1");
    expect(r.canEdit).toBe(true);
    expect(r.closedLanes).toEqual([]);
    expect(r.userId).toBe(s.editor);
    expect(r.deals).toHaveLength(6);
    expect(r.deals[0].title).toBe("Dossier 1");
    expect(r.fieldColumns.titre).toBe(s.col["dossiers.titre"]);
    expect(r.currency).toBe("EUR");
    expect(r.views.every((v) => typeof v.type === "string")).toBe(true);
  });

  it("vues : partagées et siennes seulement, jamais d'une autre base", async () => {
    await fx.pool.query(
      "INSERT INTO user_database_views (database_id, name, type, scope, created_by, position) VALUES ($1,'Autre base','grid','shared',NULL,0)",
      [s.bases.contacts],
    );
    const e = await load(s.editor);
    expect(e.views.map((v) => v.name)).toEqual(["Tableau", "Perso editor"]);
    expect(e.views.find((v) => v.name === "Perso editor")?.scope).toBe("personal");
    const v = await load(s.viewer);
    expect(v.views.map((x) => x.name)).toEqual(["Tableau", "Perso viewer"]);
  });

  it("viewer : canEdit false ; closedLanes lus de la vue Pipeline", async () => {
    await fx.pool.query(
      "INSERT INTO user_database_views (database_id, name, type, scope, position, config) VALUES ($1,'Pipeline D','kanban','shared',9,$2)",
      [s.bases.dossiers, JSON.stringify({ kanbanTotals: { amountColumnId: "x", closedLanes: ["Signé"], weights: {}, showWeighted: false } })],
    );
    try {
      const r = await load(s.viewer);
      expect(r.canEdit).toBe(false);
      expect(r.closedLanes).toEqual(["Signé"]);
    } finally {
      await fx.pool.query("DELETE FROM user_database_views WHERE name = 'Pipeline D'");
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
      const r = await load(s.editor);
      expect(r.owners.map((o) => o.name)).toEqual(["Editor", "Viewer"]);
      expect(r.owners.some((o) => o.id === foreignUser)).toBe(false);
      expect(Object.keys(r.owners[0]).sort()).toEqual(["id", "name"]);
    } finally {
      await fx.pool.query("DELETE FROM user_database_rows WHERE id = $1", [rows[0].id]);
      await fx.pool.query("DELETE FROM users WHERE id = $1", [foreignUser]);
    }
  });

  it("autre organisation ou sans droit : contexte nul (404)", async () => {
    expect(await loadCrmContext(s.orgB, s.editor, s.deps)).toBeNull();
    expect(await loadCrmContext(s.orgA, s.outsider, s.deps)).toBeNull();
  });
});
