/**
 * Moteur d'application contre la vraie base : atomicité, concurrence, fraîcheur, droits, historique, fusion avec
 * relations et pièces jointes. Requiert RELATIONS_TEST_DATABASE_URL ; ignore sinon.
 */
import { describe, it, expect, vi, beforeAll, afterAll, beforeEach } from "vitest";
import { randomUUID } from "crypto";
import type { Pool } from "pg";
import { setupRowHistoryFixture } from "../../../databases/__tests__/row-history-fixture";

const h = vi.hoisted(() => ({
  db: undefined as unknown,
  acl: { permission: "editor" as "editor" | "viewer", denied: new Set<string>(), orgId: "", spaceId: "" },
  guard: { fn: undefined as unknown as (...a: unknown[]) => Promise<void> },
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

vi.mock("@/lib/databases/attachment-cell-guard", async (orig) => {
  const actual = await orig<typeof import("@/lib/databases/attachment-cell-guard")>();
  return { ...actual, assertMediaCells: (...a: unknown[]) => h.guard.fn(...a) };
});

import { applyProposal, ApplyBodyError } from "../apply";
import { createProposal } from "../store";
import { planUpdateRows } from "../plan-update";
import { planDeleteRows } from "../plan-delete";
import { planCreateRows } from "../plan-create";
import { planMergeDuplicates } from "../plan-merge";
import { computeFingerprint } from "../freshness";
import { ToolAccessError, type ChatToolContext } from "@/lib/ai/chat-tools/context";
import { MediaCellError } from "@/lib/databases/attachment-cell-guard";
import type { ProposalPlan } from "../plan-shared";
import type { SessionUser } from "@/types";

const URL = process.env.RELATIONS_TEST_DATABASE_URL;
const DB_NAME = URL ? new globalThis.URL(URL).pathname.replace(/^\//, "") : "";
if (URL && !DB_NAME.includes("test")) {
  throw new Error(`RELATIONS_TEST_DATABASE_URL doit viser une base de test, reçu "${DB_NAME}"`);
}

describe.skipIf(!URL)("applyProposal", () => {
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
  const ATT = randomUUID();
  const A_PAIRED = randomUUID(); // A -> X, jumelée avec X_PAIRED
  const X_PAIRED = randomUUID();
  const X_UNI = randomUUID(); // X -> A, unidirectionnelle
  const R1 = randomUUID();
  const R2 = randomUUID();
  const P1 = randomUUID();
  const X_ROW = randomUUID();
  const j = JSON.stringify;
  const user = { id: USER } as unknown as SessionUser;
  const ctx = { user, orgId: ORG } as unknown as ChatToolContext;

  const cellsOf = async (id: string) =>
    (await pool.query("SELECT cells FROM user_database_rows WHERE id = $1", [id])).rows[0]?.cells as
      | Record<string, unknown>
      | undefined;
  const history = async () => (await pool.query("SELECT * FROM database_row_changes")).rows;
  const statusOf = async (id: string) =>
    (await pool.query("SELECT status, applied_at, undo_snapshot, failure_message FROM ai_proposals WHERE id = $1", [id])).rows[0];
  const propose = (plan: ProposalPlan, databaseId = DB_A) =>
    createProposal({ ctx, databaseId, payload: plan.payload, freshness: plan.freshness });
  const addRow = (id: string, db: string, cells: unknown, pos: number, updated = "2026-01-01T00:00:00Z") =>
    pool.query("INSERT INTO user_database_rows (id, database_id, cells, position, updated_at) VALUES ($1,$2,$3::jsonb,$4,$5)", [
      id, db, j(cells), pos, updated,
    ]);
  const apply = (id: string, body?: Parameters<typeof applyProposal>[0]["body"]) =>
    applyProposal({ proposalId: id, user, orgId: ORG, body });

  beforeAll(async () => {
    const f = await setupRowHistoryFixture(URL!, "rh_ai_apply");
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
    await col(ATT, DB_A, "attachment", {});
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
    h.guard.fn = async () => {};
    chatSettings.value = ALL_ON;
    dispatch.mockReset();
    await pool.query("DELETE FROM ai_proposals");
    await pool.query("DELETE FROM user_database_rows");
    await pool.query("DELETE FROM database_row_changes");
  });

  /** Groupe de doublons : R2 (récente, conservée) et R1 (retirée) ; relations, pièces jointes et conflit. */
  async function seedMerge() {
    await addRow(P1, DB_X, { [X_PAIRED]: [R1] }, 0);
    await addRow(R1, DB_A, { [KEY]: "k", [NAME]: "old", [ATT]: [{ mediaId: "m1" }, { mediaId: "m2" }], [A_PAIRED]: [P1] }, 0, "2026-01-01T00:00:00Z");
    await addRow(R2, DB_A, { [KEY]: "k", [NAME]: "new", [ATT]: [{ mediaId: "m2" }] }, 1, "2026-02-01T00:00:00Z");
    await addRow(X_ROW, DB_X, { [X_UNI]: [R1, "z"] }, 1);
    await pool.query("DELETE FROM database_row_changes");
  }

  it("applique les cellules after, historique source ai, acteur humain, lot de la proposition, instantané", async () => {
    await addRow(R1, DB_A, { [NAME]: "a" }, 0);
    const started = Date.now();
    const plan = await planUpdateRows(DB_A, [{ rowId: R1, cells: { [NAME]: "b" } }]);
    const p = await propose(plan);
    h.guard.fn = vi.fn(async () => {});
    await pool.query("DELETE FROM database_row_changes");
    const out = await apply(p.id);
    expect(out).toMatchObject({ status: "applied" });
    // Verrou aperçu = écriture : exactement le payload stocké.
    const payload = p.payload as { changes: { after: Record<string, unknown> }[] };
    expect(await cellsOf(R1)).toEqual(payload.changes[0].after);
    const rows = await history();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ source: "ai", actor_user_id: USER, batch_id: p.batchId });
    expect(h.guard.fn).toHaveBeenCalledWith(DB_A, { [NAME]: "b" }, { user, orgId: ORG }, undefined);
    const st = await statusOf(p.id);
    expect(st.status).toBe("applied");
    expect(st.applied_at.getTime()).toBeGreaterThanOrEqual(started);
    expect(st.undo_snapshot.previousCells).toEqual([{ rowId: R1, cells: { [NAME]: "a" } }]);
    expect(st.undo_snapshot.postApply).toEqual(computeFingerprint([{ id: R1, cells: (await cellsOf(R1))! }]));
  });

  it("automatismes : événements de ligne envoyés une fois après un apply réussi (mise à jour, création, suppression)", async () => {
    await addRow(R1, DB_A, { [NAME]: "a" }, 0);
    await addRow(R2, DB_A, { [NAME]: "z" }, 1);
    const upd = await propose(await planUpdateRows(DB_A, [{ rowId: R1, cells: { [NAME]: "b" } }]));
    expect((await apply(upd.id)).status).toBe("applied");
    expect(dispatch).toHaveBeenCalledTimes(1);
    expect(dispatch).toHaveBeenCalledWith({ databaseId: DB_A, rowId: R1, before: { [NAME]: "a" }, after: { [NAME]: "b" } });

    dispatch.mockClear();
    const cre = await propose(await planCreateRows(DB_A, [{ cells: { [NAME]: "n" } }]));
    expect((await apply(cre.id)).status).toBe("applied");
    expect(dispatch).toHaveBeenCalledTimes(1);
    expect(dispatch.mock.calls[0][0]).toMatchObject({ databaseId: DB_A, before: null, after: { [NAME]: "n" } });

    dispatch.mockClear();
    const del = await propose(await planDeleteRows(DB_A, [R2]));
    expect((await apply(del.id)).status).toBe("applied");
    expect(dispatch).toHaveBeenCalledTimes(1);
    expect(dispatch).toHaveBeenCalledWith({ databaseId: DB_A, rowId: R2, before: { [NAME]: "z" }, after: null });
  });

  it("automatismes : aucun événement sur proposition périmée ni sur échec", async () => {
    await addRow(R1, DB_A, { [NAME]: "a" }, 0);
    const stale = await propose(await planUpdateRows(DB_A, [{ rowId: R1, cells: { [NAME]: "b" } }]));
    await pool.query("UPDATE user_database_rows SET cells = $2::jsonb WHERE id = $1", [R1, j({ [NAME]: "autre" })]);
    expect((await apply(stale.id)).status).toBe("stale");
    const failing = await propose(await planUpdateRows(DB_A, [{ rowId: R1, cells: { [NAME]: "c" } }]));
    h.guard.fn = async () => {
      throw new Error("boom");
    };
    expect((await apply(failing.id)).status).toBe("failed");
    expect(dispatch).not.toHaveBeenCalled();
  });

  it("deux applications simultanées : une seule écriture, l'autre est refusée proprement", async () => {
    await addRow(R1, DB_A, { [NAME]: "a" }, 0);
    const p = await propose(await planUpdateRows(DB_A, [{ rowId: R1, cells: { [NAME]: "b" } }]));
    await pool.query("DELETE FROM database_row_changes");
    const outs = await Promise.all([apply(p.id), apply(p.id)]);
    expect(outs.map((o) => o.status).sort()).toEqual(["applied", "refused"]);
    expect(await history()).toHaveLength(1);
    expect((await statusOf(p.id)).status).toBe("applied");
  });

  it("ligne modifiée entre la proposition et l'apply : stale, aucune écriture", async () => {
    await addRow(R1, DB_A, { [NAME]: "a" }, 0);
    const p = await propose(await planUpdateRows(DB_A, [{ rowId: R1, cells: { [NAME]: "b" } }]));
    await pool.query("UPDATE user_database_rows SET cells = $2::jsonb WHERE id = $1", [R1, j({ [NAME]: "autre" })]);
    await pool.query("DELETE FROM database_row_changes");
    expect((await apply(p.id)).status).toBe("stale");
    expect(await cellsOf(R1)).toEqual({ [NAME]: "autre" });
    expect(await history()).toHaveLength(0);
    expect((await statusOf(p.id)).status).toBe("stale");
  });

  it("nouvelle ligne rejoignant un groupe de doublons : stale, aucune écriture", async () => {
    await seedMerge();
    const p = await propose(await planMergeDuplicates(DB_A, [KEY]));
    await addRow(randomUUID(), DB_A, { [KEY]: "K" }, 5);
    await pool.query("DELETE FROM database_row_changes");
    expect((await apply(p.id)).status).toBe("stale");
    expect(await cellsOf(R1)).toBeDefined();
    expect(await history()).toHaveLength(0);
  });

  it("proposition expirée : refusée sans écriture", async () => {
    await addRow(R1, DB_A, { [NAME]: "a" }, 0);
    const p = await propose(await planUpdateRows(DB_A, [{ rowId: R1, cells: { [NAME]: "b" } }]));
    await pool.query("UPDATE ai_proposals SET expires_at = now() - interval '1 minute' WHERE id = $1", [p.id]);
    expect((await apply(p.id)).status).toBe("expired");
    expect(await cellsOf(R1)).toEqual({ [NAME]: "a" });
  });

  it("type d'action désactivé depuis la création : refusé sans écriture, proposition intacte ; les autres types passent", async () => {
    await addRow(R1, DB_A, { [NAME]: "a" }, 0);
    const del = await propose(await planDeleteRows(DB_A, [R1]));
    const upd = await propose(await planUpdateRows(DB_A, [{ rowId: R1, cells: { [NAME]: "b" } }]));
    chatSettings.value = { proposeDeletes: false };
    const out = await apply(del.id);
    expect(out.status).toBe("refused");
    expect(out.message).toMatch(/désactivée par l'administrateur/);
    expect((await statusOf(del.id)).status).toBe("pending");
    expect(await cellsOf(R1)).toEqual({ [NAME]: "a" });
    expect((await apply(upd.id)).status).toBe("applied");
  });

  it("interrupteur maître éteint depuis la création : refusé sans écriture", async () => {
    await addRow(R1, DB_A, { [NAME]: "a" }, 0);
    const p = await propose(await planUpdateRows(DB_A, [{ rowId: R1, cells: { [NAME]: "b" } }]));
    chatSettings.value = { actionsEnabled: false };
    expect((await apply(p.id)).status).toBe("refused");
    expect(await cellsOf(R1)).toEqual({ [NAME]: "a" });
  });

  it("droit editor retiré avant le clic : refus, proposition intacte", async () => {
    await addRow(R1, DB_A, { [NAME]: "a" }, 0);
    const p = await propose(await planUpdateRows(DB_A, [{ rowId: R1, cells: { [NAME]: "b" } }]));
    h.acl.permission = "viewer";
    await expect(apply(p.id)).rejects.toBeInstanceOf(ToolAccessError);
    expect(await cellsOf(R1)).toEqual({ [NAME]: "a" });
    expect((await statusOf(p.id)).status).toBe("pending");
  });

  it("proposition d'un autre utilisateur ou inconnue : not_found", async () => {
    await addRow(R1, DB_A, { [NAME]: "a" }, 0);
    const p = await propose(await planUpdateRows(DB_A, [{ rowId: R1, cells: { [NAME]: "b" } }]));
    await expect(
      applyProposal({ proposalId: p.id, user: { id: OTHER } as unknown as SessionUser, orgId: ORG }),
    ).rejects.toMatchObject({ code: "not_found" });
    await expect(apply(randomUUID())).rejects.toMatchObject({ code: "not_found" });
  });

  it("fusion sans corps : valeurs de la conservée, pièces jointes réunies sans doublon, relations repatriées", async () => {
    await seedMerge();
    const p = await propose(await planMergeDuplicates(DB_A, [KEY]));
    const out = await apply(p.id);
    expect(out.status).toBe("applied");
    expect(await cellsOf(R1)).toBeUndefined();
    const keep = (await cellsOf(R2))!;
    expect(keep[NAME]).toBe("new");
    expect(keep[ATT]).toEqual([{ mediaId: "m2" }, { mediaId: "m1" }]);
    expect(keep[A_PAIRED]).toEqual([P1]);
    // Inverse jumelée resynchronisée : la liée pointe vers la conservée, plus vers la supprimée.
    expect((await cellsOf(P1))![X_PAIRED]).toEqual([R2]);
    // Unidirectionnelle d'une autre ligne repointée.
    expect((await cellsOf(X_ROW))![X_UNI]).toEqual([R2, "z"]);
    const st = await statusOf(p.id);
    expect(st.undo_snapshot.restoredRows.map((r: { id: string }) => r.id)).toEqual([R1]);
    expect(st.undo_snapshot.repointedRelations).toEqual([
      { databaseId: DB_X, rowId: X_ROW, columnId: X_UNI, before: [R1, "z"] },
    ]);
    expect(st.undo_snapshot.postApply.map((f: { id: string }) => f.id).sort()).toEqual([R2, X_ROW].sort());
    expect((await history()).every((r) => r.source === "ai" || r.source === "relation_sync")).toBe(true);
  });

  it("fusion avec overrides : la valeur choisie est écrite", async () => {
    await seedMerge();
    const plan = await planMergeDuplicates(DB_A, [KEY]);
    const g = (plan.payload as { groups: { groupId: string }[] }).groups[0];
    const p = await propose(plan);
    expect((await apply(p.id, { overrides: { [g.groupId]: { [NAME]: R1 } } })).status).toBe("applied");
    expect((await cellsOf(R2))![NAME]).toBe("old");
  });

  it("groupe exclu : ses lignes restent ; corps incohérent : ApplyBodyError sans rien réclamer", async () => {
    await seedMerge();
    const plan = await planMergeDuplicates(DB_A, [KEY]);
    const g = (plan.payload as { groups: { groupId: string }[] }).groups[0];
    const p = await propose(plan);
    await expect(apply(p.id, { excludedGroupIds: ["inconnu"] })).rejects.toBeInstanceOf(ApplyBodyError);
    await expect(apply(p.id, { excludedGroupIds: [g.groupId] })).rejects.toBeInstanceOf(ApplyBodyError);
    expect((await statusOf(p.id)).status).toBe("pending");
    expect(await cellsOf(R1)).toBeDefined();
  });

  it("suppression et création : lignes retirées avec instantané, lignes créées tracées", async () => {
    await addRow(R1, DB_A, { [NAME]: "a" }, 0);
    const del = await propose(await planDeleteRows(DB_A, [R1]));
    expect((await apply(del.id)).status).toBe("applied");
    expect(await cellsOf(R1)).toBeUndefined();
    expect((await statusOf(del.id)).undo_snapshot.restoredRows[0]).toMatchObject({ id: R1, cells: { [NAME]: "a" } });

    const cre = await propose(await planCreateRows(DB_A, [{ cells: { [NAME]: "n1" } }, { cells: { [NAME]: "n2" } }]));
    expect((await apply(cre.id)).status).toBe("applied");
    const ids: string[] = (await statusOf(cre.id)).undo_snapshot.createdRowIds;
    expect(ids).toHaveLength(2);
    const made = await pool.query("SELECT cells FROM user_database_rows WHERE database_id = $1", [DB_A]);
    expect(made.rows.map((r) => r.cells[NAME]).sort()).toEqual(["n1", "n2"]);
  });

  it("échec au milieu : rollback complet, aucune écriture partielle, statut failed", async () => {
    const [A1, A2, B1, B2] = [randomUUID(), randomUUID(), randomUUID(), randomUUID()];
    await addRow(A1, DB_A, { [KEY]: "k" }, 0, "2026-02-01T00:00:00Z");
    await addRow(A2, DB_A, { [KEY]: "k", [NAME]: "x" }, 1, "2026-01-01T00:00:00Z");
    await addRow(B1, DB_A, { [KEY]: "j" }, 2, "2026-02-01T00:00:00Z");
    await addRow(B2, DB_A, { [KEY]: "j", [NAME]: "y" }, 3, "2026-01-01T00:00:00Z");
    const p = await propose(await planMergeDuplicates(DB_A, [KEY]));
    await pool.query("DELETE FROM database_row_changes");
    let n = 0;
    h.guard.fn = async () => {
      if (++n === 2) throw new MediaCellError("Média refusé");
    };
    const out = await apply(p.id);
    expect(out).toMatchObject({ status: "failed", message: "Média refusé" });
    expect(n).toBe(2);
    for (const id of [A1, A2, B1, B2]) expect(await cellsOf(id)).toBeDefined();
    expect((await cellsOf(A1))![NAME]).toBeUndefined();
    expect(await history()).toHaveLength(0);
    const st = await statusOf(p.id);
    expect(st).toMatchObject({ status: "failed", failure_message: "Média refusé" });
    expect(st.undo_snapshot).toBeNull();
  });

  it("base liée devenue inaccessible (C10) : échec sans écriture", async () => {
    await seedMerge();
    const p = await propose(await planMergeDuplicates(DB_A, [KEY]));
    h.acl.denied.add(DB_X);
    await pool.query("DELETE FROM database_row_changes");
    // La base X est refusée aussi par le contrôle d'accès de la base proposée ? Non : seule la base liée l'est.
    const out = await apply(p.id);
    expect(out).toMatchObject({ status: "failed", message: "Accès refusé à une base liée" });
    expect(await cellsOf(R1)).toBeDefined();
    expect((await cellsOf(X_ROW))![X_UNI]).toEqual([R1, "z"]);
    expect(await history()).toHaveLength(0);
  });
  it("écriture concurrente non validée au moment de l'apply : l'apply attend le verrou puis conclut stale, sans écriture", async () => {
    await addRow(R1, DB_A, { [NAME]: "a" }, 0);
    const p = await propose(await planUpdateRows(DB_A, [{ rowId: R1, cells: { [NAME]: "b" } }]));
    await pool.query("DELETE FROM database_row_changes");
    const other = await pool.connect();
    try {
      await other.query("BEGIN");
      await other.query("UPDATE user_database_rows SET cells = $2::jsonb WHERE id = $1", [R1, j({ [NAME]: "concurrent" })]);
      const pending = apply(p.id);
      await new Promise((r) => setTimeout(r, 300));
      // Toujours en attente du verrou de ligne : rien n'est tranché.
      expect((await statusOf(p.id)).status).toBe("applying");
      await other.query("COMMIT");
      expect((await pending).status).toBe("stale");
    } finally {
      other.release();
    }
    expect(await cellsOf(R1)).toEqual({ [NAME]: "concurrent" });
    expect((await history()).filter((r) => r.source === "ai")).toHaveLength(0);
    expect((await statusOf(p.id)).status).toBe("stale");
  });

  it("échec de clôture du statut failed : le résultat reste un failed propre", async () => {
    await addRow(R1, DB_A, { [NAME]: "a" }, 0);
    const p = await propose(await planUpdateRows(DB_A, [{ rowId: R1, cells: { [NAME]: "b" } }]));
    h.guard.fn = async () => {
      // Casse la clôture : la table de statut devient illisible pour l'UPDATE de failed.
      await pool.query("ALTER TABLE ai_proposals RENAME TO ai_proposals_off");
      throw new MediaCellError("Média refusé");
    };
    try {
      const out = await apply(p.id);
      expect(out).toMatchObject({ status: "failed", message: "Média refusé" });
    } finally {
      await pool.query("ALTER TABLE ai_proposals_off RENAME TO ai_proposals");
    }
  });
});
