import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { randomUUID } from "node:crypto";
import { setupCrmFixture, seedCrmBases, type CrmFixture, type SeededCrm } from "./crm-fixture";
import { loadCrmContext } from "../context";
import { loadRelances, countRelances } from "../relances";

const URL = process.env.RELATIONS_TEST_DATABASE_URL;
const NOW = new Date("2026-11-18T12:00:00Z");

describe.skipIf(!URL)("relances (Postgres)", () => {
  let fx: CrmFixture;
  let s: SeededCrm;

  beforeAll(async () => {
    fx = await setupCrmFixture(URL!, "rh_l7_relances", { tasks: true });
    s = await seedCrmBases(fx);
  }, 60000);
  afterAll(async () => {
    await fx?.teardown();
  }, 60000);

  const setRelance = async (idx: number, date: string | null) => {
    await fx.pool.query(
      "UPDATE user_database_rows SET cells = cells || $2::jsonb WHERE id = $1",
      [s.dossierIds[idx], JSON.stringify({ [s.col["dossiers.relance"]]: date })],
    );
  };
  beforeEach(async () => {
    await fx.pool.query("DELETE FROM tasks");
    await fx.pool.query("DELETE FROM user_database_views WHERE name LIKE 'Pipeline%'");
    for (let i = 0; i < 6; i++) await setRelance(i, null);
  });

  const ctxOf = async (user: string) => {
    const c = await loadCrmContext(s.orgA, user, s.deps);
    expect(c).not.toBeNull();
    return c!;
  };
  const load = async (user: string, q: { horizon?: number; mine?: boolean; tz?: string; now?: Date } = {}) =>
    loadRelances(await ctxOf(user), { horizon: 7, mine: false, now: NOW, tz: "Europe/Paris", ...q }, s.deps);

  it("classe à la frontière : veille, jour, J+7, J+8", async () => {
    await setRelance(0, "2026-11-17");
    await setRelance(1, "2026-11-18");
    await setRelance(2, "2026-11-25");
    await setRelance(3, "2026-11-26");
    const r = await load(s.editor);
    expect(r.groups.late.map((i) => i.title)).toEqual(["Dossier 1"]);
    expect(r.groups.today.map((i) => i.title)).toEqual(["Dossier 2"]);
    expect(r.groups.week.map((i) => i.title)).toEqual(["Dossier 3"]);
    expect(r.canEdit).toBe(true);
    expect(r.mineAvailable).toBe(true);
  });

  it("dossier clos exclu (statut clos de la vue Pipeline)", async () => {
    await fx.pool.query(
      "INSERT INTO user_database_views (database_id, name, type, scope, position, config) VALUES ($1,'Pipeline A','kanban','shared',5,$2)",
      [s.bases.dossiers, JSON.stringify({ kanbanTotals: { amountColumnId: "x", closedLanes: ["Signé", "Perdu"], weights: {}, showWeighted: false } })],
    );
    await setRelance(3, "2026-11-10"); // Signé
    await setRelance(4, "2026-11-10"); // Perdu
    await setRelance(5, "2026-11-10"); // Prospect
    const r = await load(s.editor);
    expect(r.groups.late.map((i) => i.title)).toEqual(["Dossier 6"]);
  });

  it("dernière interaction = la plus récente par date, contact et structure", async () => {
    await setRelance(0, "2026-11-17");
    const extra = await fx.pool.query(
      "INSERT INTO user_database_rows (database_id, cells, position) VALUES ($1,$2,9) RETURNING id",
      [s.bases.interactions, JSON.stringify({
        [s.col["interactions.date"]]: "2026-11-15",
        [s.col["interactions.type"]]: "Mail",
        [s.col["interactions.intitule"]]: "Relance mail",
        [s.col["interactions.dossier"]]: [s.dossierIds[0]],
      })],
    );
    try {
      const r = await load(s.editor);
      const item = r.groups.late[0];
      expect(item.contactName).toBe("Contact 1");
      expect(item.lastInteraction).toEqual({ date: "2026-11-15", type: "Mail", title: "Relance mail" });
    } finally {
      await fx.pool.query("DELETE FROM user_database_rows WHERE id = $1", [extra.rows[0].id]);
    }
  });

  it("tâches liées : seulement la base Dossiers, ouvertes, échues dans l'horizon", async () => {
    await setRelance(0, "2026-11-17");
    const ins = (db: string, row: string, due: string | null, status = "open") =>
      fx.pool.query(
        "INSERT INTO tasks (kind, title, status, due_at, assignee_id, created_by, database_id, row_id) VALUES ('database_row',$1,$2,$3,$4,$5,$6,$7)",
        [`T ${due}`, status, due, s.editor, s.editor, db, row],
      );
    await ins(s.bases.dossiers, s.dossierIds[0], "2026-11-17T10:00:00Z");
    await ins(s.bases.dossiers, s.dossierIds[0], "2026-12-30T10:00:00Z"); // hors horizon
    await ins(s.bases.dossiers, s.dossierIds[0], "2026-11-17T11:00:00Z", "done");
    await ins(s.bases.contacts, s.contactIds[0], "2026-11-17T12:00:00Z"); // autre base
    await ins(s.bases.dossiers, randomUUID(), "2026-11-17T13:00:00Z"); // ligne inexistante
    const r = await load(s.editor);
    expect(r.tasks).toHaveLength(1);
    expect(r.tasks[0]).toMatchObject({ dealId: s.dossierIds[0], dealTitle: "Dossier 1", assigneeName: "Editor" });
  });

  it("mine : mes dossiers seulement", async () => {
    await setRelance(0, "2026-11-17"); // editor
    await setRelance(1, "2026-11-17"); // viewer
    const mine = await load(s.editor, { mine: true });
    expect(mine.groups.late.map((i) => i.title)).toEqual(["Dossier 1"]);
    const all = await load(s.editor);
    expect(all.groups.late).toHaveLength(2);
  });

  it("fuseau : à 23:30 UTC, Europe/Paris compte le lendemain UTC comme Aujourd'hui", async () => {
    await setRelance(0, "2026-11-19");
    const now = new Date("2026-11-18T23:30:00Z");
    expect((await load(s.editor, { now })).groups.today).toHaveLength(1);
    expect((await load(s.editor, { now, tz: "UTC" })).groups.week).toHaveLength(1);
  });

  it("expose types d'interaction et canLog selon le droit", async () => {
    await fx.pool.query("UPDATE user_database_columns SET config = $2 WHERE id = $1", [
      s.col["interactions.type"],
      JSON.stringify({ options: ["Appel", "Mail"] }),
    ]);
    const e = await load(s.editor);
    expect(e.interactionTypes).toEqual(["Appel", "Mail"]);
    expect(e.canLog).toBe(true);
    expect((await load(s.viewer)).canLog).toBe(false);
  });

  it("count : mes dossiers en retard ou du jour seulement", async () => {
    await setRelance(0, "2026-11-17"); // editor, late
    await setRelance(2, "2026-11-18"); // editor, today
    await setRelance(4, "2026-11-25"); // editor, week
    await setRelance(1, "2026-11-10"); // viewer
    const ctx = await ctxOf(s.editor);
    expect(await countRelances(ctx, { tz: "Europe/Paris", now: NOW }, s.deps)).toBe(2);
  });

  it("count : 0 sans champ responsable raccordé", async () => {
    await setRelance(0, "2026-11-17");
    await fx.pool.query("UPDATE crm_connections SET field_map = jsonb_set(field_map, '{dossiers}', (field_map->'dossiers') - 'responsable') WHERE organization_id = $1", [s.orgA]);
    try {
      const ctx = await ctxOf(s.editor);
      expect(await countRelances(ctx, { now: NOW }, s.deps)).toBe(0);
    } finally {
      await fx.pool.query("UPDATE crm_connections SET field_map = jsonb_set(field_map, '{dossiers,responsable}', to_jsonb($2::text)) WHERE organization_id = $1", [s.orgA, s.col["dossiers.responsable"]]);
    }
  });
});
