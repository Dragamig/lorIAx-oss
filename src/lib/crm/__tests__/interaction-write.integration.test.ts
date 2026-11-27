import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from "vitest";
import { setupCrmFixture, seedCrmBases, type CrmFixture, type SeededCrm } from "./crm-fixture";

const dispatch = vi.hoisted(() => vi.fn());
vi.mock("@/lib/automations/dispatch-row-events", () => ({ dispatchRowEvents: dispatch }));

import { loadCrmContext } from "../context";
import { listDealInteractions } from "../deals";
import { createInteraction } from "../interaction-write";

const URL = process.env.RELATIONS_TEST_DATABASE_URL;
const NOW = new Date("2026-11-18T12:00:00Z");
const MISSING = "00000000-0000-4000-8000-000000000000";

describe.skipIf(!URL)("interaction-write (Postgres)", () => {
  let fx: CrmFixture;
  let s: SeededCrm;
  let twinCol: string;

  beforeAll(async () => {
    fx = await setupCrmFixture(URL!, "rh_l7_interaction_write");
    s = await seedCrmBases(fx);
    // Options du type et relation jumelée Dossier <-> Interactions.
    await fx.pool.query("UPDATE user_database_columns SET config = $2 WHERE id = $1", [
      s.col["interactions.type"],
      JSON.stringify({ options: ["Appel", "Mail"] }),
    ]);
    const { rows } = await fx.pool.query(
      "INSERT INTO user_database_columns (database_id, name, type, position, config) VALUES ($1,'Interactions','relation',9,$2) RETURNING id",
      [s.bases.dossiers, JSON.stringify({ targetDatabaseId: s.bases.interactions, inverseColumnId: s.col["interactions.dossier"] })],
    );
    twinCol = rows[0].id;
    await fx.pool.query("UPDATE user_database_columns SET config = $2 WHERE id = $1", [
      s.col["interactions.dossier"],
      JSON.stringify({ targetDatabaseId: s.bases.dossiers, inverseColumnId: twinCol }),
    ]);
  }, 60000);
  afterAll(async () => {
    await fx?.teardown();
  }, 60000);

  beforeEach(() => dispatch.mockClear());

  const count = async () =>
    Number((await fx.pool.query("SELECT count(*) FROM user_database_rows WHERE database_id = $1", [s.bases.interactions])).rows[0].count);
  const run = async (user: string, dealId: string, body: Parameters<typeof createInteraction>[2], orgId = s.orgA) => {
    const ctx = await loadCrmContext(orgId, user, s.deps);
    expect(ctx).not.toBeNull();
    return createInteraction(ctx!, dealId, body, { now: NOW, tz: "Europe/Paris", rowCtx: { source: "ui", actorUserId: user, batchId: crypto.randomUUID() } }, s.deps);
  };

  it("crée la ligne liée au dossier, visible en lecture, relation jumelée, historique, dispatch", async () => {
    const before = await count();
    const r = await run(s.editor, s.dossierIds[1], { type: "Mail", title: "Relance devis", note: "Envoyé" });
    expect(r.status).toBe("ok");
    if (r.status !== "ok") return;
    expect(await count()).toBe(before + 1);
    expect(r.interaction).toMatchObject({ type: "Mail", title: "Relance devis", note: "Envoyé", date: "2026-11-18", dealId: s.dossierIds[1] });

    const ctx = await loadCrmContext(s.orgA, s.editor, s.deps);
    const listed = await listDealInteractions(ctx!, s.dossierIds[1], s.deps);
    expect(listed!.map((i) => i.id)).toContain(r.interaction.id);

    const { rows } = await fx.pool.query("SELECT cells FROM user_database_rows WHERE id = $1", [s.dossierIds[1]]);
    expect(rows[0].cells[twinCol]).toContain(r.interaction.id);

    const h = (await fx.pool.query("SELECT * FROM database_row_changes WHERE row_id = $1", [r.interaction.id])).rows;
    expect(h.some((x) => x.kind === "created" && x.source === "ui" && x.actor_user_id === s.editor)).toBe(true);

    expect(dispatch).toHaveBeenCalledTimes(1);
    expect(dispatch.mock.calls[0][0]).toMatchObject({ databaseId: s.bases.interactions, rowId: r.interaction.id, before: null });
  });

  it("type hors options : invalid_type, rien écrit", async () => {
    const before = await count();
    expect(await run(s.editor, s.dossierIds[0], { type: "Fax" })).toEqual({ status: "error", code: "invalid_type" });
    expect(await count()).toBe(before);
    expect(dispatch).not.toHaveBeenCalled();
  });

  it("date invalide : invalid", async () => {
    expect(await run(s.editor, s.dossierIds[0], { type: "Appel", date: "pas une date" })).toEqual({ status: "error", code: "invalid" });
  });

  it("viewer : introuvable, sans écriture", async () => {
    const before = await count();
    expect(await run(s.viewer, s.dossierIds[0], { type: "Appel" })).toEqual({ status: "not_found" });
    expect(await count()).toBe(before);
    expect(dispatch).not.toHaveBeenCalled();
  });

  it("dossier d'une autre base, d'une autre organisation, inexistant ou non uuid : introuvable", async () => {
    const before = await count();
    const { rows } = await fx.pool.query("SELECT id FROM user_database_rows WHERE database_id = $1", [s.foreign.dossiers]);
    expect(await run(s.editor, rows[0].id, { type: "Appel" })).toEqual({ status: "not_found" });
    expect(await run(s.editor, s.contactIds[0], { type: "Appel" })).toEqual({ status: "not_found" });
    expect(await run(s.editor, MISSING, { type: "Appel" })).toEqual({ status: "not_found" });
    expect(await run(s.editor, "pas-un-uuid", { type: "Appel" })).toEqual({ status: "not_found" });
    expect(await count()).toBe(before);
    expect(dispatch).not.toHaveBeenCalled();
  });
});
