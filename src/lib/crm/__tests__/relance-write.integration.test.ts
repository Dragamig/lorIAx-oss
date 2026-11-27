import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from "vitest";
import { setupCrmFixture, seedCrmBases, type CrmFixture, type SeededCrm } from "./crm-fixture";

const dispatch = vi.hoisted(() => vi.fn());
vi.mock("@/lib/automations/dispatch-row-events", () => ({ dispatchRowEvents: dispatch }));

import { loadCrmContext } from "../context";
import { writeRelance } from "../relance-write";

const URL = process.env.RELATIONS_TEST_DATABASE_URL;
const NOW = new Date("2026-11-18T12:00:00Z");
const MISSING = "00000000-0000-4000-8000-000000000000";

describe.skipIf(!URL)("relance-write (Postgres)", () => {
  let fx: CrmFixture;
  let s: SeededCrm;

  beforeAll(async () => {
    fx = await setupCrmFixture(URL!, "rh_l7_relance_write");
    s = await seedCrmBases(fx);
  }, 60000);
  afterAll(async () => {
    await fx?.teardown();
  }, 60000);

  const col = () => s.col["dossiers.relance"];
  const setRelance = async (date: string | null) => {
    await fx.pool.query("UPDATE user_database_rows SET cells = cells || $2::jsonb WHERE id = $1", [
      s.dossierIds[0],
      JSON.stringify({ [col()]: date }),
    ]);
  };
  const stored = async () => {
    const { rows } = await fx.pool.query("SELECT cells FROM user_database_rows WHERE id = $1", [s.dossierIds[0]]);
    return rows[0].cells[col()] ?? null;
  };
  const history = async () =>
    (await fx.pool.query("SELECT * FROM database_row_changes WHERE row_id = $1 ORDER BY created_at", [s.dossierIds[0]])).rows;

  beforeEach(async () => {
    dispatch.mockClear();
    await fx.pool.query("DELETE FROM database_row_changes");
    await setRelance("2026-11-10");
    await fx.pool.query("DELETE FROM database_row_changes");
  });

  const run = async (user: string, rowId: string, body: Parameters<typeof writeRelance>[2]) => {
    const ctx = await loadCrmContext(s.orgA, user, s.deps);
    expect(ctx).not.toBeNull();
    return writeRelance(ctx!, rowId, body, { now: NOW, tz: "Europe/Paris", rowCtx: { source: "ui", actorUserId: user, batchId: crypto.randomUUID() } }, s.deps);
  };

  it("reporter : écrit, historique ui, dispatch comme le PATCH générique", async () => {
    const r = await run(s.editor, s.dossierIds[0], { snoozeDays: 7 });
    expect(r).toEqual({ status: "ok", relance: "2026-11-25" });
    expect(await stored()).toBe("2026-11-25");
    const h = await history();
    expect(h).toHaveLength(1);
    expect(h[0]).toMatchObject({ kind: "updated", source: "ui", actor_user_id: s.editor, database_id: s.bases.dossiers });
    expect(dispatch).toHaveBeenCalledTimes(1);
    const arg = dispatch.mock.calls[0][0];
    expect(arg).toMatchObject({ databaseId: s.bases.dossiers, rowId: s.dossierIds[0] });
    expect(arg.before[col()]).toBe("2026-11-10");
    expect(arg.after[col()]).toBe("2026-11-25");
  });

  it("faite : null, deuxième appel sans nouvelle entrée ni dispatch", async () => {
    expect(await run(s.editor, s.dossierIds[0], { done: true })).toEqual({ status: "ok", relance: null });
    expect(await stored()).toBeNull();
    expect(await history()).toHaveLength(1);
    expect(dispatch).toHaveBeenCalledTimes(1);
    expect(await run(s.editor, s.dossierIds[0], { done: true })).toEqual({ status: "ok", relance: null });
    expect(await history()).toHaveLength(1);
    expect(dispatch).toHaveBeenCalledTimes(1);
  });

  it("restore d'une date passée : écrit sans past_date", async () => {
    await run(s.editor, s.dossierIds[0], { snoozeDays: 7 });
    expect(await run(s.editor, s.dossierIds[0], { restore: "2026-11-10" })).toEqual({ status: "ok", relance: "2026-11-10" });
    expect(await stored()).toBe("2026-11-10");
  });

  it("date passée : erreur past_date, rien écrit", async () => {
    expect(await run(s.editor, s.dossierIds[0], { date: "2026-11-17" })).toEqual({ status: "error", code: "past_date" });
    expect(await stored()).toBe("2026-11-10");
    expect(await history()).toHaveLength(0);
  });

  it("viewer : introuvable, aucune écriture", async () => {
    expect(await run(s.viewer, s.dossierIds[0], { done: true })).toEqual({ status: "not_found" });
    expect(await stored()).toBe("2026-11-10");
    expect(await history()).toHaveLength(0);
    expect(dispatch).not.toHaveBeenCalled();
  });

  it("dossier d'une autre base, inexistant ou non uuid : introuvable", async () => {
    const { rows } = await fx.pool.query("SELECT id FROM user_database_rows WHERE database_id = $1", [s.foreign.dossiers]);
    expect(await run(s.editor, rows[0].id, { done: true })).toEqual({ status: "not_found" });
    expect(await run(s.editor, s.contactIds[0], { done: true })).toEqual({ status: "not_found" });
    expect(await run(s.editor, MISSING, { done: true })).toEqual({ status: "not_found" });
    expect(await run(s.editor, "pas-un-uuid", { done: true })).toEqual({ status: "not_found" });
    expect(dispatch).not.toHaveBeenCalled();
  });
});
