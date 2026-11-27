/**
 * Durcissement du cloisonnement du lot 7 (revue adversariale, constats M1, M2, M3, M5, M7) contre
 * la vraie base (schéma rh_l7_hardening). Les lecteurs et écrivains sont appelés directement.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { setupCrmFixture, seedCrmBases, type CrmFixture, type SeededCrm } from "./crm-fixture";

const dispatch = vi.hoisted(() => vi.fn());
vi.mock("@/lib/automations/dispatch-row-events", () => ({ dispatchRowEvents: dispatch }));

import { loadCrmContext, readRoleRows, readRoleViews, type CrmContext } from "../context";
import { loadRelances } from "../relances";
import { writeRelance } from "../relance-write";
import { createInteraction } from "../interaction-write";
import type { CrmDeps } from "../connection";

const URL = process.env.RELATIONS_TEST_DATABASE_URL;
const NOW = new Date("2026-11-18T12:00:00Z");

describe.skipIf(!URL)("durcissement du cloisonnement CRM (Postgres)", () => {
  let fx: CrmFixture;
  let s: SeededCrm;

  beforeAll(async () => {
    fx = await setupCrmFixture(URL!, "rh_l7_hardening", { tasks: true });
    s = await seedCrmBases(fx);
    await fx.pool.query("UPDATE user_database_columns SET config = $2 WHERE id = $1", [
      s.col["interactions.type"],
      JSON.stringify({ options: ["Appel", "Mail"] }),
    ]);
  }, 60000);
  afterAll(async () => {
    await fx?.teardown();
  }, 60000);

  beforeEach(async () => {
    dispatch.mockClear();
    await fx.pool.query("DELETE FROM tasks");
    await fx.pool.query("UPDATE crm_connections SET enabled = true, contacts_database_id = $2, deals_database_id = $3, interactions_database_id = $4 WHERE organization_id = $1", [
      s.orgA, s.bases.contacts, s.bases.dossiers, s.bases.interactions,
    ]);
    await fx.pool.query("UPDATE user_databases SET space_id = $1 WHERE id = ANY($2)", [
      s.spaceA, [s.bases.contacts, s.bases.dossiers, s.bases.interactions],
    ]);
    s.levels[s.editor][s.spaceA] = "editor";
    s.levels[s.viewer][s.spaceA] = "viewer";
  });

  const rowCtx = (user: string) => ({ source: "ui" as const, actorUserId: user, batchId: randomUUID() });
  const ctxOf = async (user: string, deps: CrmDeps = s.deps) => {
    const c = await loadCrmContext(s.orgA, user, deps);
    expect(c).not.toBeNull();
    return c!;
  };
  const relance = async (user: string, body: object) =>
    writeRelance(await ctxOf(user), s.dossierIds[0], body, { now: NOW, tz: "Europe/Paris", rowCtx: rowCtx(user) }, s.deps);
  const interaction = async (user: string, body: object) =>
    createInteraction(await ctxOf(user), s.dossierIds[0], body, { now: NOW, tz: "Europe/Paris", rowCtx: rowCtx(user) }, s.deps);
  const interactionCount = async () =>
    Number((await fx.pool.query("SELECT count(*) FROM user_database_rows WHERE database_id = $1", [s.bases.interactions])).rows[0].count);

  it("M2 : un contexte fabriqué à la main est refusé par les lecteurs", async () => {
    const forged = {
      orgId: s.orgA,
      userId: s.viewer,
      columns: { contacts: [], dossiers: [], interactions: [] },
      fieldColumn: () => null,
      fieldState: () => "none",
      databaseId: () => s.foreign.dossiers,
      spaceId: () => s.spaceB,
      canEdit: () => true,
    } as unknown as CrmContext;
    await expect(readRoleRows(forged, "dossiers", s.deps)).rejects.toThrow(/non emis/);
    await expect(readRoleViews(forged, s.deps)).rejects.toThrow(/non emis/);
    const real = await ctxOf(s.viewer);
    await expect(readRoleRows(real, "dossiers", s.deps)).resolves.toHaveLength(s.dossierIds.length);
  });

  it("M1 : connexion changée entre les deux chargements, canEdit refuse la base qui n'est pas celle lue", async () => {
    const other = randomUUID();
    await fx.pool.query("INSERT INTO user_databases (id, space_id, name) VALUES ($1,$2,'Dossiers bis')", [other, s.spaceA]);
    let calls = 0;
    const deps: CrmDeps = {
      executor: s.deps.executor,
      permissionOf: async (userId, spaceId) => {
        // Premier appel = chargement viewer, apres la lecture de la ligne de connexion.
        if (++calls === 1) {
          await fx.pool.query("UPDATE crm_connections SET deals_database_id = $2 WHERE organization_id = $1", [s.orgA, other]);
        }
        return s.deps.permissionOf(userId, spaceId);
      },
    };
    const ctx = await loadCrmContext(s.orgA, s.editor, deps);
    expect(ctx).not.toBeNull();
    expect(ctx!.databaseId("dossiers")).toBe(s.bases.dossiers);
    expect(ctx!.canEdit("dossiers")).toBe(false);
    expect(ctx!.canEdit("contacts")).toBe(true);
    // Sans changement, le droit editor est conserve.
    await fx.pool.query("UPDATE crm_connections SET deals_database_id = $2 WHERE organization_id = $1", [s.orgA, s.bases.dossiers]);
    expect((await ctxOf(s.editor)).canEdit("dossiers")).toBe(true);
    await fx.pool.query("DELETE FROM user_databases WHERE id = $1", [other]);
  });

  it("M7 F2 : editor sur Interactions et viewer sur Dossiers, interaction 201 et relance 404", async () => {
    const spaceI = randomUUID();
    await fx.pool.query("INSERT INTO spaces (id, organization_id, name) VALUES ($1,$2,'Espace I')", [spaceI, s.orgA]);
    await fx.pool.query("UPDATE user_databases SET space_id = $2 WHERE id = $1", [s.bases.interactions, spaceI]);
    s.levels[s.editor][s.spaceA] = "viewer";
    s.levels[s.editor][spaceI] = "editor";
    const before = await interactionCount();
    expect(await interaction(s.editor, { type: "Mail" })).toMatchObject({ status: "ok" });
    expect(await interactionCount()).toBe(before + 1);
    expect(await relance(s.editor, { snoozeDays: 3 })).toEqual({ status: "not_found" });
    delete s.levels[s.editor][spaceI];
  });

  it("M7 F2 inverse : editor sur Dossiers et viewer sur Interactions, relance ok et interaction 404", async () => {
    const spaceI = randomUUID();
    await fx.pool.query("INSERT INTO spaces (id, organization_id, name) VALUES ($1,$2,'Espace I2')", [spaceI, s.orgA]);
    await fx.pool.query("UPDATE user_databases SET space_id = $2 WHERE id = $1", [s.bases.interactions, spaceI]);
    s.levels[s.editor][spaceI] = "viewer";
    await fx.pool.query("UPDATE user_database_rows SET cells = cells || $2::jsonb WHERE id = $1", [
      s.dossierIds[0], JSON.stringify({ [s.col["dossiers.relance"]]: "2026-11-20" }),
    ]);
    const before = await interactionCount();
    expect((await interaction(s.editor, { type: "Mail" })).status).toBe("not_found");
    expect(await interactionCount()).toBe(before);
    expect((await relance(s.editor, { snoozeDays: 3 })).status).toBe("ok");
    delete s.levels[s.editor][spaceI];
  });

  it("M7 : un viewer reste en 404 (jamais de 400) sur un champ incompatible", async () => {
    await fx.pool.query("UPDATE user_database_columns SET type = 'text' WHERE id = ANY($1)", [
      [s.col["dossiers.relance"], s.col["interactions.date"]],
    ]);
    try {
      expect(await relance(s.viewer, { snoozeDays: 3 })).toEqual({ status: "not_found" });
      expect(await interaction(s.viewer, { type: "Appel" })).toEqual({ status: "not_found" });
    } finally {
      await fx.pool.query("UPDATE user_database_columns SET type = 'date' WHERE id = ANY($1)", [
        [s.col["dossiers.relance"], s.col["interactions.date"]],
      ]);
    }
  });

  it("M3 : champ obligatoire ou relance en etat bad, 400 field_incompatible pour qui peut ecrire, lectures bornees", async () => {
    await fx.pool.query("UPDATE user_database_columns SET type = 'text' WHERE id = ANY($1)", [
      [s.col["dossiers.relance"], s.col["interactions.date"]],
    ]);
    try {
      const ctx = await ctxOf(s.editor);
      expect(ctx.fieldState("dossiers", "relance")).toBe("bad");
      expect(ctx.fieldColumn("dossiers", "relance")).toBeNull();
      expect(await relance(s.editor, { snoozeDays: 3 })).toEqual({ status: "error", code: "field_incompatible" });
      const before = await interactionCount();
      expect(await interaction(s.editor, { type: "Appel" })).toEqual({ status: "error", code: "field_incompatible" });
      expect(await interactionCount()).toBe(before);
      // Lecture toujours bornee a la base du role.
      const rows = await readRoleRows(ctx, "dossiers", s.deps);
      expect(rows.every((r) => r.databaseId === s.bases.dossiers)).toBe(true);
    } finally {
      await fx.pool.query("UPDATE user_database_columns SET type = 'date' WHERE id = ANY($1)", [
        [s.col["dossiers.relance"], s.col["interactions.date"]],
      ]);
    }
  });

  it("M5 : le nom d'un assigne hors organisation n'est pas expose dans la file des relances", async () => {
    const stranger = randomUUID();
    await fx.pool.query("INSERT INTO users (id, name) VALUES ($1,'Etranger')", [stranger]);
    await fx.pool.query("UPDATE user_database_rows SET cells = cells || $2::jsonb WHERE id = $1", [
      s.dossierIds[0], JSON.stringify({ [s.col["dossiers.relance"]]: "2026-11-17" }),
    ]);
    const ins = (assignee: string | null) =>
      fx.pool.query(
        "INSERT INTO tasks (kind, title, status, due_at, assignee_id, created_by, database_id, row_id) VALUES ('database_row',$1,'open','2026-11-17T10:00:00Z',$2,$3,$4,$5)",
        [`T ${assignee ?? "none"}`, assignee, s.editor, s.bases.dossiers, s.dossierIds[0]],
      );
    await ins(stranger);
    await ins(s.editor);
    await ins(null);
    const r = await loadRelances(await ctxOf(s.editor), { horizon: 7, mine: false, now: NOW, tz: "Europe/Paris" }, s.deps);
    const names = r.tasks.map((t) => t.assigneeName).sort((a, b) => String(a).localeCompare(String(b)));
    expect(r.tasks).toHaveLength(3);
    expect(names).toEqual(["Editor", null, null]);
    expect(JSON.stringify(r)).not.toContain("Etranger");
  });
});
