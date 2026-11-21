import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import { setupActivationFixture } from "@/lib/crm/__tests__/crm-fixture";
import { buildRoleDatabase } from "@/lib/crm/template";
import { loadTemplateMessages } from "@/lib/crm/template-messages";
import { viewConfigSchema } from "@/lib/bases/view-config";
import { applyTemplate, completeDatabase } from "../apply";
import { TemplateFailure, type TemplateContext } from "../types";

const URL = process.env.RELATIONS_TEST_DATABASE_URL;

describe.skipIf(!URL)("vues d'exemple du modèle (Postgres)", () => {
  let fx: Awaited<ReturnType<typeof setupActivationFixture>>;
  let orgA: string;
  const userId = randomUUID();
  const ctx = (): TemplateContext => ({ orgId: orgA, userId, permissionOf: async () => "admin" });

  beforeAll(async () => {
    fx = await setupActivationFixture(URL!, "rh_l6_act_views");
    await fx.pool.query(`
      ALTER TABLE spaces ALTER COLUMN id SET DEFAULT gen_random_uuid();
      ALTER TABLE spaces
        ADD COLUMN slug varchar(255) NOT NULL DEFAULT '',
        ADD COLUMN type text NOT NULL DEFAULT 'personal',
        ADD COLUMN description text,
        ADD COLUMN owner_team_id uuid,
        ADD COLUMN git_repo_path varchar(512) NOT NULL DEFAULT '',
        ADD COLUMN classification text NOT NULL DEFAULT 'internal',
        ADD COLUMN icon varchar(50),
        ADD COLUMN appearance_preset jsonb,
        ADD COLUMN is_demo boolean NOT NULL DEFAULT false,
        ADD COLUMN created_at timestamptz NOT NULL DEFAULT now(),
        ADD COLUMN updated_at timestamptz NOT NULL DEFAULT now();
      ALTER TABLE user_databases ALTER COLUMN id SET DEFAULT gen_random_uuid();
      ALTER TABLE user_databases
        ADD COLUMN group_id uuid, ADD COLUMN description text, ADD COLUMN icon varchar(64),
        ADD COLUMN position integer NOT NULL DEFAULT 0,
        ADD COLUMN created_by uuid,
        ADD COLUMN created_at timestamptz NOT NULL DEFAULT now(),
        ADD COLUMN updated_at timestamptz NOT NULL DEFAULT now();
    `);
    await fx.pool.query("INSERT INTO users (id, name) VALUES ($1, 'Admin')", [userId]);
    orgA = await fx.seedOrg("Org A");
  });
  afterAll(async () => {
    await fx.teardown();
  });

  async function views(databaseId: string) {
    const { rows } = await fx.pool.query(
      "SELECT name, type, config, is_default, scope, position, created_by FROM user_database_views WHERE database_id=$1 ORDER BY position",
      [databaseId],
    );
    return rows;
  }

  it("Pipeline : kanbanTotals pointe l'id de la colonne Montant créée, poids et voies closes de la spec", async () => {
    const m = await loadTemplateMessages("fr");
    const res = await fx.db.transaction((tx) =>
      applyTemplate(tx, ctx(), { space: { mode: "create", name: "CRM P" }, databases: [buildRoleDatabase("dossiers", m)] }),
    );
    const d = res.databases.dossiers;
    const vs = await views(d.id);
    expect(vs.map((v) => v.name)).toEqual(["Pipeline", "Relances", "Tous", "Mes dossiers", "Gagnés ce trimestre"]);
    expect(vs.map((v) => v.is_default)).toEqual([true, false, false, false, false]);
    expect(vs.every((v) => v.scope === "shared" && v.created_by === userId)).toBe(true);
    const pipe = vs[0];
    expect(pipe.type).toBe("kanban");
    expect(pipe.config.groupByColumnId).toBe(d.columns.statut);
    expect(pipe.config.kanbanTotals.amountColumnId).toBe(d.columns.montant);
    expect(pipe.config.kanbanTotals.closedLanes).toEqual(["Gagnée", "Perdue", "Sans suite"]);
    expect(pipe.config.kanbanTotals.weights).toEqual({
      "Nouvelle": 10, "À qualifier": 20, "Devis envoyé": 40, "En attente client": 50,
      "Chez l'industriel": 60, "Échantillon en cours": 70, "Gagnée": 100, "Perdue": 0, "Sans suite": 0,
    });
    const { rows } = await fx.pool.query("SELECT config FROM user_database_columns WHERE id=$1", [d.columns.statut]);
    for (const lane of Object.keys(pipe.config.kanbanTotals.weights)) expect(rows[0].config.options).toContain(lane);
    expect(vs[1].config.filters.children[0]).toMatchObject({ columnId: d.columns.relance, operator: "is_not_empty" });
    expect(vs[3].config.filters.children[0]).toMatchObject({ columnId: d.columns.responsable, operator: "is_me" });
    expect(vs[4].config.filters.children.map((c: { operator: string }) => c.operator)).toEqual(["is", "is_this_quarter"]);
  });

  it("config produite acceptée par viewConfigSchema", async () => {
    const m = await loadTemplateMessages("fr");
    const res = await fx.db.transaction((tx) =>
      applyTemplate(tx, ctx(), { space: { mode: "create", name: "CRM S" }, databases: [buildRoleDatabase("dossiers", m)] }),
    );
    for (const v of await views(res.databases.dossiers.id)) expect(viewConfigSchema.safeParse(v.config).success).toBe(true);
  });

  it("seules les bases créées de Dossiers reçoivent des vues, les autres rôles aucune", async () => {
    const m = await loadTemplateMessages("fr");
    const res = await fx.db.transaction((tx) =>
      applyTemplate(tx, ctx(), {
        space: { mode: "create", name: "CRM R" },
        databases: [buildRoleDatabase("contacts", m), buildRoleDatabase("dossiers", m)],
      }),
    );
    expect(await views(res.databases.contacts.id)).toHaveLength(0);
    expect(await views(res.databases.dossiers.id)).toHaveLength(5);
  });

  it("une base complétée ne reçoit aucune vue", async () => {
    const m = await loadTemplateMessages("fr");
    const sp = await fx.seedSpace(orgA, { name: "Existant", ownerUserId: userId });
    const dbId = await fx.seedDatabase(sp, "Mes dossiers", []);
    await fx.db.transaction((tx) =>
      completeDatabase(tx, ctx(), { databaseId: dbId, columns: buildRoleDatabase("dossiers", m).columns }),
    );
    expect(await views(dbId)).toHaveLength(0);
  });

  it("noms de vues uniques par base : doublon refusé, rien écrit", async () => {
    const m = await loadTemplateMessages("fr");
    const db = buildRoleDatabase("dossiers", m);
    db.views = [db.views![0], { ...db.views![2], name: " pipeline " }];
    const err = await fx.db
      .transaction((tx) => applyTemplate(tx, ctx(), { space: { mode: "create", name: "CRM D" }, databases: [db] }))
      .catch((e) => e);
    expect(err).toBeInstanceOf(TemplateFailure);
    expect(err.error).toEqual({ code: "name_collision", key: "dossiers" });
  });
});
