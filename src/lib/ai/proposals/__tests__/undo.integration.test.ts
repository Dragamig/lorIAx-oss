/**
 * Moteur d'annulation contre la vraie base : suppression, mise à jour, création, fusion (relations repointées,
 * cible de relation retirée par la même proposition), refus sur modification ultérieure, double annulation
 * simultanée, fenêtre de 24 h. Requiert RELATIONS_TEST_DATABASE_URL ; ignore sinon.
 */
import { describe, it, expect, vi, beforeAll, afterAll, beforeEach } from "vitest";
import { randomUUID } from "crypto";
import type { Pool } from "pg";
import { setupRowHistoryFixture } from "../../../databases/__tests__/row-history-fixture";

const h = vi.hoisted(() => ({
  db: undefined as unknown,
  acl: { permission: "editor" as "editor" | "viewer", denied: new Set<string>(), orgId: "", spaceId: "" },
}));

vi.mock("@/lib/db", () => ({
  db: new Proxy({}, { get: (_t, k) => (h.db as Record<string | symbol, unknown>)[k] }),
}));

vi.mock("@/lib/auth/require-org-scoped", () => {
  class OrgScopeError extends Error {
    constructor(
      public readonly response: unknown,
      public readonly reason: string,
    ) {
      super(reason);
    }
  }
  return {
    OrgScopeError,
    requireOrgScoped: async (opts: { resource?: { id: string }; minPermission?: string }) => {
      if (opts.resource && h.acl.denied.has(opts.resource.id)) throw new OrgScopeError(null, "resource-not-found");
      if (opts.minPermission === "editor" && h.acl.permission === "viewer") throw new OrgScopeError(null, "permission-denied");
      return { user: {}, orgId: h.acl.orgId, orgSlug: "x", spaceId: h.acl.spaceId, permission: h.acl.permission };
    },
  };
});

const dispatch = vi.hoisted(() => vi.fn());
vi.mock("@/lib/automations/dispatch-row-events", () => ({ dispatchRowEvents: dispatch }));

// Réglage des actions du chat : valeur lue au clic (le test pose tout activé).
const ALL_ON = { actionsEnabled: true, readDatabases: true, proposeUpdates: true, proposeDeletes: true, proposeMerges: true, proposeCreates: true };
const chatSettings = vi.hoisted(() => ({ value: null as unknown }));
vi.mock("@/lib/settings/system-settings", () => ({
  getSetting: vi.fn(async () => chatSettings.value),
  setSetting: vi.fn(),
}));

import { applyProposal } from "../apply";
import { undoProposal } from "../undo";
import { createProposal } from "../store";
import { planUpdateRows } from "../plan-update";
import { planDeleteRows } from "../plan-delete";
import { planCreateRows } from "../plan-create";
import { planMergeDuplicates } from "../plan-merge";
import { ToolAccessError, type ChatToolContext } from "@/lib/ai/chat-tools/context";
import type { ProposalPlan } from "../plan-shared";
import type { SessionUser } from "@/types";

const URL = process.env.RELATIONS_TEST_DATABASE_URL;
const DB_NAME = URL ? new globalThis.URL(URL).pathname.replace(/^\//, "") : "";
if (URL && !DB_NAME.includes("test")) {
  throw new Error(`RELATIONS_TEST_DATABASE_URL doit viser une base de test, reçu "${DB_NAME}"`);
}

describe.skipIf(!URL)("undoProposal", () => {
  let pool: Pool;
  let teardown: () => Promise<void>;
  const ORG = randomUUID();
  const SPACE = randomUUID();
  const USER = randomUUID();
  const OTHER = randomUUID();
  const DB_A = randomUUID();
  const DB_X = randomUUID();
  const KEY = randomUUID();
  const NAME = randomUUID();
  const SELF = randomUUID(); // A -> A, unidirectionnelle
  const A_PAIRED = randomUUID();
  const X_PAIRED = randomUUID();
  const X_UNI = randomUUID(); // X -> A, unidirectionnelle
  const K = randomUUID();
  const R1 = randomUUID();
  const R3 = randomUUID();
  const P1 = randomUUID();
  const X_ROW = randomUUID();
  const j = JSON.stringify;
  const user = { id: USER } as unknown as SessionUser;
  const ctx = { user, orgId: ORG } as unknown as ChatToolContext;

  const cellsOf = async (id: string) =>
    (await pool.query("SELECT cells FROM user_database_rows WHERE id = $1", [id])).rows[0]?.cells as
      | Record<string, unknown>
      | undefined;
  const posOf = async (id: string) =>
    (await pool.query("SELECT position FROM user_database_rows WHERE id = $1", [id])).rows[0]?.position as number | undefined;
  const statusOf = async (id: string) =>
    (await pool.query("SELECT status, undone_at FROM ai_proposals WHERE id = $1", [id])).rows[0];
  const history = async () => (await pool.query("SELECT * FROM database_row_changes")).rows;
  const addRow = (id: string, db: string, cells: unknown, pos: number, updated = "2026-01-01T00:00:00Z") =>
    pool.query("INSERT INTO user_database_rows (id, database_id, cells, position, updated_at) VALUES ($1,$2,$3::jsonb,$4,$5)", [
      id, db, j(cells), pos, updated,
    ]);
  const appliedProposal = async (plan: ProposalPlan, databaseId = DB_A) => {
    const p = await createProposal({ ctx, databaseId, payload: plan.payload, freshness: plan.freshness });
    const out = await applyProposal({ proposalId: p.id, user, orgId: ORG });
    expect(out.status).toBe("applied");
    return p;
  };
  const undo = (id: string) => undoProposal({ proposalId: id, user, orgId: ORG });

  beforeAll(async () => {
    const f = await setupRowHistoryFixture(URL!, "rh_ai_undo");
    pool = f.pool;
    teardown = f.teardown;
    h.db = f.db;
    await pool.query(`
      ALTER TABLE user_databases ADD COLUMN archived_at timestamptz, ADD COLUMN deleted_at timestamptz;
      CREATE TYPE ai_proposal_type AS ENUM ('update_rows','delete_rows','merge_duplicates','create_rows');
      CREATE TYPE ai_proposal_status AS ENUM ('pending','applying','applied','dismissed','stale','undone','expired','failed');
      CREATE TABLE ai_proposals (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        org_id uuid NOT NULL,
        user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        database_id uuid NOT NULL REFERENCES user_databases(id) ON DELETE CASCADE,
        type ai_proposal_type NOT NULL, payload jsonb NOT NULL, freshness jsonb NOT NULL,
        status ai_proposal_status NOT NULL DEFAULT 'pending', undo_snapshot jsonb,
        batch_id uuid NOT NULL DEFAULT gen_random_uuid(), replaces_id uuid, failure_message text,
        created_at timestamptz NOT NULL DEFAULT now(), applied_at timestamptz, dismissed_at timestamptz,
        undone_at timestamptz, expires_at timestamptz NOT NULL
      );
    `);
    await pool.query("INSERT INTO users (id) VALUES ($1),($2)", [USER, OTHER]);
    await pool.query("INSERT INTO spaces (id, organization_id) VALUES ($1,$2)", [SPACE, ORG]);
    await pool.query("INSERT INTO user_databases (id, space_id) VALUES ($1,$2),($3,$2)", [DB_A, SPACE, DB_X]);
    const col = (id: string, db: string, type: string, config: unknown) =>
      pool.query("INSERT INTO user_database_columns (id, database_id, name, type, config) VALUES ($1,$2,'c',$3,$4::jsonb)", [id, db, type, j(config)]);
    await col(KEY, DB_A, "text", {});
    await col(NAME, DB_A, "text", {});
    await col(SELF, DB_A, "relation", { targetDatabaseId: DB_A });
    await col(A_PAIRED, DB_A, "relation", { targetDatabaseId: DB_X, inverseColumnId: X_PAIRED });
    await col(X_PAIRED, DB_X, "relation", { targetDatabaseId: DB_A, inverseColumnId: A_PAIRED });
    await col(X_UNI, DB_X, "relation", { targetDatabaseId: DB_A });
  });
  afterAll(async () => {
    await teardown();
  });

  beforeEach(async () => {
    h.acl.permission = "editor";
    h.acl.denied.clear();
    h.acl.orgId = ORG;
    h.acl.spaceId = SPACE;
    chatSettings.value = ALL_ON;
    dispatch.mockReset();
    await pool.query("DELETE FROM ai_proposals");
    await pool.query("DELETE FROM user_database_rows");
    await pool.query("DELETE FROM database_row_changes");
  });

  it("suppression : mêmes ids, positions et relations rétablis, historique source ai", async () => {
    await addRow(P1, DB_X, { [X_PAIRED]: [R1] }, 0);
    await addRow(K, DB_A, { [NAME]: "k" }, 0);
    await addRow(R1, DB_A, { [NAME]: "r1", [A_PAIRED]: [P1], [SELF]: [K] }, 1);
    await addRow(R3, DB_A, { [NAME]: "r3" }, 2);
    const p = await appliedProposal(await planDeleteRows(DB_A, [R1]));
    expect(await cellsOf(R1)).toBeUndefined();
    expect((await cellsOf(P1))![X_PAIRED]).toEqual([]);
    await pool.query("DELETE FROM database_row_changes");
    expect(await undo(p.id)).toEqual({ status: "undone" });
    expect(await cellsOf(R1)).toEqual({ [NAME]: "r1", [A_PAIRED]: [P1], [SELF]: [K] });
    expect(await posOf(R1)).toBe(1);
    expect((await cellsOf(P1))![X_PAIRED]).toEqual([R1]);
    const st = await statusOf(p.id);
    expect(st.status).toBe("undone");
    expect(st.undone_at).toBeTruthy();
    const rows = await history();
    expect(rows.length).toBeGreaterThan(0);
    expect(rows.every((r) => r.source === "ai" || r.source === "relation_sync")).toBe(true);
    expect(rows.some((r) => r.source === "ai" && r.actor_user_id === USER && r.batch_id === p.batchId)).toBe(true);
  });

  it("mise à jour : anciennes cellules réécrites", async () => {
    await addRow(R1, DB_A, { [NAME]: "a", [KEY]: "x" }, 0);
    const p = await appliedProposal(await planUpdateRows(DB_A, [{ rowId: R1, cells: { [NAME]: "b" } }]));
    expect((await cellsOf(R1))![NAME]).toBe("b");
    expect(await undo(p.id)).toEqual({ status: "undone" });
    expect(await cellsOf(R1)).toEqual({ [NAME]: "a", [KEY]: "x" });
  });

  it("annulation toujours permise quand le type d'action a été désactivé depuis l'application", async () => {
    await addRow(R1, DB_A, { [NAME]: "a", [KEY]: "x" }, 0);
    const p = await appliedProposal(await planUpdateRows(DB_A, [{ rowId: R1, cells: { [NAME]: "b" } }]));
    chatSettings.value = { actionsEnabled: false };
    expect(await undo(p.id)).toEqual({ status: "undone" });
    expect(await cellsOf(R1)).toEqual({ [NAME]: "a", [KEY]: "x" });
  });

  it("automatismes : événements envoyés une fois après une annulation réussie, aucun sur refus", async () => {
    await addRow(R1, DB_A, { [NAME]: "a" }, 0);
    const p = await appliedProposal(await planUpdateRows(DB_A, [{ rowId: R1, cells: { [NAME]: "b" } }]));
    dispatch.mockClear();
    expect(await undo(p.id)).toEqual({ status: "undone" });
    expect(dispatch).toHaveBeenCalledTimes(1);
    expect(dispatch).toHaveBeenCalledWith({ databaseId: DB_A, rowId: R1, before: { [NAME]: "b" }, after: { [NAME]: "a" } });
    dispatch.mockClear();
    expect((await undo(p.id)).status).toBe("refused");
    expect(dispatch).not.toHaveBeenCalled();
  });

  it("création : lignes créées supprimées", async () => {
    await addRow(R1, DB_A, { [NAME]: "a" }, 0);
    const p = await appliedProposal(await planCreateRows(DB_A, [{ cells: { [NAME]: "n1" } }, { cells: { [NAME]: "n2" } }]));
    const before = (await pool.query("SELECT count(*)::int AS n FROM user_database_rows WHERE database_id = $1", [DB_A])).rows[0].n;
    expect(before).toBe(3);
    expect(await undo(p.id)).toEqual({ status: "undone" });
    const rows = (await pool.query("SELECT id FROM user_database_rows WHERE database_id = $1", [DB_A])).rows;
    expect(rows.map((r) => r.id)).toEqual([R1]);
  });

  /** Groupe K (conservée), R1 et R3 (retirées) ; R1 -> R3 (cible retirée par la même proposition). */
  async function seedMergeGroup() {
    await addRow(P1, DB_X, { [X_PAIRED]: [R1] }, 0);
    await addRow(K, DB_A, { [KEY]: "k", [NAME]: "new" }, 0, "2026-03-01T00:00:00Z");
    await addRow(R1, DB_A, { [KEY]: "k", [NAME]: "old", [A_PAIRED]: [P1], [SELF]: [R3] }, 1, "2026-02-01T00:00:00Z");
    await addRow(R3, DB_A, { [KEY]: "k", [NAME]: "older" }, 2, "2026-01-01T00:00:00Z");
    await addRow(X_ROW, DB_X, { [X_UNI]: [R1, "z"] }, 1);
    await pool.query("DELETE FROM database_row_changes");
  }

  it("fusion : lignes retirées, cellules de la conservée et relations repointées rétablies, cible retirée cohérente", async () => {
    await seedMergeGroup();
    const snapshot = {
      k: await cellsOf(K),
      r1: await cellsOf(R1),
      r3: await cellsOf(R3),
      p1: await cellsOf(P1),
      x: await cellsOf(X_ROW),
    };
    const p = await appliedProposal(await planMergeDuplicates(DB_A, [KEY]));
    expect(await cellsOf(R1)).toBeUndefined();
    expect(await cellsOf(R3)).toBeUndefined();
    expect((await cellsOf(X_ROW))![X_UNI]).toEqual([K, "z"]);
    expect(await undo(p.id)).toEqual({ status: "undone" });
    expect(await cellsOf(R1)).toEqual(snapshot.r1); // R1 pointe toujours vers R3, rétablie avec le même id
    expect(await cellsOf(R3)).toEqual(snapshot.r3);
    expect(await posOf(R1)).toBe(1);
    expect(await posOf(R3)).toBe(2);
    expect((await cellsOf(X_ROW))![X_UNI]).toEqual(snapshot.x![X_UNI]);
    expect((await cellsOf(P1))![X_PAIRED]).toEqual(snapshot.p1![X_PAIRED]);
    const k = (await cellsOf(K))!;
    expect(k[KEY]).toBe("k");
    expect(k[NAME]).toBe("new");
    expect(k[A_PAIRED] ?? []).toEqual([]);
    expect(k[SELF] ?? []).toEqual([]);
  });

  it("ligne modifiée après l'application : refus, rien d'écrit, statut inchangé", async () => {
    await addRow(R1, DB_A, { [NAME]: "a" }, 0);
    const p = await appliedProposal(await planUpdateRows(DB_A, [{ rowId: R1, cells: { [NAME]: "b" } }]));
    await pool.query("UPDATE user_database_rows SET cells = $2::jsonb WHERE id = $1", [R1, j({ [NAME]: "autre" })]);
    await pool.query("DELETE FROM database_row_changes");
    const out = await undo(p.id);
    expect(out).toEqual({ status: "refused", message: "Des modifications ultérieures empêchent l'annulation" });
    expect(await cellsOf(R1)).toEqual({ [NAME]: "autre" });
    expect(await history()).toHaveLength(0);
    expect((await statusOf(p.id)).status).toBe("applied");
  });

  it("fusion : ligne repointée modifiée ailleurs depuis : refus, rien d'écrit", async () => {
    await seedMergeGroup();
    const p = await appliedProposal(await planMergeDuplicates(DB_A, [KEY]));
    await pool.query("UPDATE user_database_rows SET cells = $2::jsonb WHERE id = $1", [X_ROW, j({ [X_UNI]: [K] })]);
    expect((await undo(p.id)).status).toBe("refused");
    expect(await cellsOf(R1)).toBeUndefined();
    expect((await statusOf(p.id)).status).toBe("applied");
  });

  it("deuxième annulation : refus propre", async () => {
    await addRow(R1, DB_A, { [NAME]: "a" }, 0);
    const p = await appliedProposal(await planUpdateRows(DB_A, [{ rowId: R1, cells: { [NAME]: "b" } }]));
    expect((await undo(p.id)).status).toBe("undone");
    expect(await undo(p.id)).toEqual({ status: "refused", message: "Proposition déjà annulée" });
    expect(await cellsOf(R1)).toEqual({ [NAME]: "a" });
  });

  it("deux annulations simultanées : une seule écriture", async () => {
    await addRow(R1, DB_A, { [NAME]: "a" }, 0);
    const p = await appliedProposal(await planUpdateRows(DB_A, [{ rowId: R1, cells: { [NAME]: "b" } }]));
    await pool.query("DELETE FROM database_row_changes");
    const outs = await Promise.all([undo(p.id), undo(p.id)]);
    expect(outs.map((o) => o.status).sort()).toEqual(["refused", "undone"]);
    expect(await history()).toHaveLength(1);
    expect(await cellsOf(R1)).toEqual({ [NAME]: "a" });
  });

  it("passé 24 h : refus sans écriture", async () => {
    await addRow(R1, DB_A, { [NAME]: "a" }, 0);
    const p = await appliedProposal(await planUpdateRows(DB_A, [{ rowId: R1, cells: { [NAME]: "b" } }]));
    await pool.query("UPDATE ai_proposals SET applied_at = now() - interval '25 hours' WHERE id = $1", [p.id]);
    const out = await undo(p.id);
    expect(out.status).toBe("refused");
    expect(out.message).toMatch(/24 h/);
    expect((await cellsOf(R1))![NAME]).toBe("b");
    expect((await statusOf(p.id)).status).toBe("applied");
  });

  it("statut autre qu'applied (pending, appliedAt absent) : refus", async () => {
    await addRow(R1, DB_A, { [NAME]: "a" }, 0);
    const plan = await planUpdateRows(DB_A, [{ rowId: R1, cells: { [NAME]: "b" } }]);
    const p = await createProposal({ ctx, databaseId: DB_A, payload: plan.payload, freshness: plan.freshness });
    expect((await undo(p.id)).status).toBe("refused");
    expect((await statusOf(p.id)).status).toBe("pending");
  });

  it("droit editor retiré : ToolAccessError ; autre utilisateur ou inconnue : not_found", async () => {
    await addRow(R1, DB_A, { [NAME]: "a" }, 0);
    const p = await appliedProposal(await planUpdateRows(DB_A, [{ rowId: R1, cells: { [NAME]: "b" } }]));
    h.acl.permission = "viewer";
    await expect(undo(p.id)).rejects.toBeInstanceOf(ToolAccessError);
    h.acl.permission = "editor";
    await expect(undoProposal({ proposalId: p.id, user: { id: OTHER } as unknown as SessionUser, orgId: ORG })).rejects.toMatchObject({
      code: "not_found",
    });
    await expect(undo(randomUUID())).rejects.toMatchObject({ code: "not_found" });
    expect((await cellsOf(R1))![NAME]).toBe("b");
    expect((await statusOf(p.id)).status).toBe("applied");
  });
});
