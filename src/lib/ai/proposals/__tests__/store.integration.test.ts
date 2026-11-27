/**
 * Magasin de propositions contre la vraie base : cloisonnement utilisateur et organisation, expiration,
 * reprise des `applying` orphelins, purge. Requiert RELATIONS_TEST_DATABASE_URL ; ignore sinon.
 */
import { describe, it, expect, vi, beforeAll, afterAll, beforeEach } from "vitest";
import { randomUUID } from "crypto";
import type { Pool } from "pg";
import { setupRowHistoryFixture } from "../../../databases/__tests__/row-history-fixture";

const h = vi.hoisted(() => ({ db: undefined as unknown }));

vi.mock("@/lib/db", () => ({
  db: new Proxy({}, { get: (_t, k) => (h.db as Record<string | symbol, unknown>)[k] }),
}));

import {
  createProposal,
  getOwnProposal,
  listPendingProposals,
  claimForApply,
  purgeClosedProposals,
  APPLYING_ORPHAN_MS,
} from "../store";
import type { ChatToolContext } from "@/lib/ai/chat-tools/context";
import type { ProposalPayload } from "../types";

const URL = process.env.RELATIONS_TEST_DATABASE_URL;
const DB_NAME = URL ? new globalThis.URL(URL).pathname.replace(/^\//, "") : "";
if (URL && !DB_NAME.includes("test")) {
  throw new Error(`RELATIONS_TEST_DATABASE_URL doit viser une base de test, reçu "${DB_NAME}"`);
}

const PAYLOAD: ProposalPayload = { type: "create_rows", rows: [{ cells: { a: 1 } }] };

describe.skipIf(!URL)("proposals store", () => {
  let pool: Pool;
  let teardown: () => Promise<void>;
  const ORG_A = randomUUID();
  const ORG_B = randomUUID();
  const USER_1 = randomUUID();
  const USER_2 = randomUUID();
  const DB_ID = randomUUID();
  const SPACE = randomUUID();

  const ctx = (userId: string, orgId: string) => ({ user: { id: userId }, orgId }) as unknown as ChatToolContext;
  const make = (userId = USER_1, orgId = ORG_A) =>
    createProposal({ ctx: ctx(userId, orgId), databaseId: DB_ID, payload: PAYLOAD, freshness: { rows: [] } });
  const setRow = (id: string, sets: string, params: unknown[] = []) =>
    pool.query(`UPDATE ai_proposals SET ${sets} WHERE id = $1`, [id, ...params]);

  beforeAll(async () => {
    const f = await setupRowHistoryFixture(URL!, "rh_ai_proposals");
    pool = f.pool;
    teardown = f.teardown;
    h.db = f.db;
    await pool.query(`
      CREATE TYPE ai_proposal_type AS ENUM ('update_rows','delete_rows','merge_duplicates','create_rows');
      CREATE TYPE ai_proposal_status AS ENUM ('pending','applying','applied','dismissed','stale','undone','expired','failed');
      CREATE TABLE ai_proposals (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        org_id uuid NOT NULL,
        user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        database_id uuid NOT NULL REFERENCES user_databases(id) ON DELETE CASCADE,
        type ai_proposal_type NOT NULL,
        payload jsonb NOT NULL,
        freshness jsonb NOT NULL,
        status ai_proposal_status NOT NULL DEFAULT 'pending',
        undo_snapshot jsonb,
        batch_id uuid NOT NULL DEFAULT gen_random_uuid(),
        replaces_id uuid,
        failure_message text,
        created_at timestamptz NOT NULL DEFAULT now(),
        applied_at timestamptz,
        dismissed_at timestamptz,
        undone_at timestamptz,
        expires_at timestamptz NOT NULL
      );
    `);
  });
  afterAll(async () => {
    await teardown();
  });

  beforeEach(async () => {
    await pool.query("DELETE FROM ai_proposals");
    await pool.query("DELETE FROM user_databases");
    await pool.query("DELETE FROM users");
    await pool.query("INSERT INTO users (id) VALUES ($1),($2)", [USER_1, USER_2]);
    await pool.query("INSERT INTO user_databases (id, space_id) VALUES ($1,$2)", [DB_ID, SPACE]);
  });

  it("createProposal pose une échéance à 24 h, un lot aléatoire et le statut pending", async () => {
    const row = await make();
    expect(row.status).toBe("pending");
    expect(row.type).toBe("create_rows");
    const ttl = row.expiresAt.getTime() - Date.now();
    expect(ttl).toBeGreaterThan(86_400_000 - 5_000);
    expect(ttl).toBeLessThanOrEqual(86_400_000);
    expect(row.batchId).toMatch(/^[0-9a-f-]{36}$/);
  });

  it("getOwnProposal rend null pour un autre utilisateur ET pour une autre organisation", async () => {
    const row = await make();
    expect((await getOwnProposal({ id: row.id, userId: USER_1, orgId: ORG_A }))?.id).toBe(row.id);
    expect(await getOwnProposal({ id: row.id, userId: USER_2, orgId: ORG_A })).toBeNull();
    expect(await getOwnProposal({ id: row.id, userId: USER_1, orgId: ORG_B })).toBeNull();
  });

  it("listPendingProposals exclut autre utilisateur, autre organisation, échues et non pending", async () => {
    const mine = await make();
    await make(USER_2, ORG_A);
    await make(USER_1, ORG_B);
    const expired = await make();
    await setRow(expired.id, "expires_at = now() - interval '1 minute'");
    const dismissed = await make();
    await setRow(dismissed.id, "status = 'dismissed'");
    const list = await listPendingProposals({ userId: USER_1, orgId: ORG_A });
    expect(list.map((r) => r.id)).toEqual([mine.id]);
  });

  it("getOwnProposal rend expired une pending échue et le persiste", async () => {
    const row = await make();
    await setRow(row.id, "expires_at = now() - interval '1 minute'");
    expect((await getOwnProposal({ id: row.id, userId: USER_1, orgId: ORG_A }))?.status).toBe("expired");
    const { rows } = await pool.query("SELECT status FROM ai_proposals WHERE id = $1", [row.id]);
    expect(rows[0].status).toBe("expired");
  });

  it("un applying de plus de 10 minutes est traité comme failed (lecture et liste), pas avant", async () => {
    const old = await make();
    await setRow(old.id, "status = 'applying', applied_at = now() - interval '11 minutes'");
    const fresh = await make();
    await setRow(fresh.id, "status = 'applying', applied_at = now() - interval '2 minutes'");
    expect(APPLYING_ORPHAN_MS).toBe(600_000);
    const got = await getOwnProposal({ id: old.id, userId: USER_1, orgId: ORG_A });
    expect(got?.status).toBe("failed");
    expect(got?.failureMessage).toBeTruthy();
    expect((await getOwnProposal({ id: fresh.id, userId: USER_1, orgId: ORG_A }))?.status).toBe("applying");

    const old2 = await make();
    await setRow(old2.id, "status = 'applying', applied_at = now() - interval '30 minutes'");
    await listPendingProposals({ userId: USER_1, orgId: ORG_A });
    const { rows } = await pool.query("SELECT status FROM ai_proposals WHERE id = $1", [old2.id]);
    expect(rows[0].status).toBe("failed");
  });

  it("claimForApply ne reprend jamais une proposition failed (ni récente, ni ancienne)", async () => {
    const row = await make();
    await setRow(row.id, "status = 'failed'");
    expect(await claimForApply({ id: row.id, userId: USER_1, orgId: ORG_A })).toBeNull();
    await setRow(row.id, "expires_at = now() - interval '1 minute'");
    expect(await claimForApply({ id: row.id, userId: USER_1, orgId: ORG_A })).toBeNull();
    expect((await pool.query("SELECT status FROM ai_proposals WHERE id = $1", [row.id])).rows[0].status).toBe("failed");
  });

  it("claimForApply est atomique : un seul gagnant, refus pour autrui ou échue", async () => {
    const row = await make();
    expect(await claimForApply({ id: row.id, userId: USER_2, orgId: ORG_A })).toBeNull();
    const [a, b] = await Promise.all([
      claimForApply({ id: row.id, userId: USER_1, orgId: ORG_A }),
      claimForApply({ id: row.id, userId: USER_1, orgId: ORG_A }),
    ]);
    expect([a, b].filter(Boolean)).toHaveLength(1);
    expect((a ?? b)?.status).toBe("applying");
    const expired = await make();
    await setRow(expired.id, "expires_at = now() - interval '1 minute'");
    expect(await claimForApply({ id: expired.id, userId: USER_1, orgId: ORG_A })).toBeNull();
  });

  it("purgeClosedProposals supprime les closes de plus de 30 jours, jamais pending ni applying", async () => {
    const pending = await make();
    await setRow(pending.id, "created_at = now() - interval '90 days', expires_at = now() + interval '1 hour'");
    const applying = await make();
    await setRow(applying.id, "status = 'applying', applied_at = now()");
    const oldClosed = await make();
    await setRow(oldClosed.id, "status = 'dismissed', dismissed_at = now() - interval '31 days'");
    const oldExpired = await make();
    await setRow(oldExpired.id, "status = 'expired', expires_at = now() - interval '40 days'");
    const recentClosed = await make();
    await setRow(recentClosed.id, "status = 'applied', applied_at = now() - interval '5 days'");
    const n = await purgeClosedProposals();
    expect(n).toBe(2);
    const { rows } = await pool.query("SELECT id FROM ai_proposals");
    expect(rows.map((r) => r.id).sort()).toEqual([pending.id, applying.id, recentClosed.id].sort());
  });
});
