/**
 * Routes des propositions : cloisonnement et statuts HTTP contre la vraie base.
 * Requiert RELATIONS_TEST_DATABASE_URL ; ignore sinon.
 * La session est simulée (utilisateur, organisation courante, droit sur l'espace) ; la résolution de ressource
 * reprend la règle de requireOrgScoped : base d'une autre organisation = 404, y compris pour admin et super_admin.
 */
import { describe, it, expect, vi, beforeAll, afterAll, beforeEach } from "vitest";
import { randomUUID } from "crypto";
import { NextRequest, NextResponse } from "next/server";
import type { Pool } from "pg";
import { setupRowHistoryFixture } from "../../../../../lib/databases/__tests__/row-history-fixture";

type Session = { user: { id: string; globalRole: string }; orgId: string; permission: "editor" | "viewer" | "none" } | null;
const h = vi.hoisted(() => ({
  db: undefined as unknown,
  pool: undefined as unknown as Pool,
  session: null as Session,
}));

vi.mock("@/lib/db", () => ({
  db: new Proxy({}, { get: (_t, k) => (h.db as Record<string | symbol, unknown>)[k] }),
}));

vi.mock("@/lib/auth/require-org-scoped", () => {
  class OrgScopeError extends Error {
    constructor(
      public readonly response: Response,
      public readonly reason: string,
    ) {
      super(reason);
    }
  }
  return {
    OrgScopeError,
    requireOrgScoped: async (opts: { resource?: { id: string }; minPermission?: string }) => {
      const s = h.session;
      if (!s) throw new OrgScopeError(NextResponse.json({ error: "Non authentifié" }, { status: 401 }), "unauthenticated");
      if (!opts.resource) return { user: s.user, orgId: s.orgId, orgSlug: "x" };
      const r = await h.pool.query(
        "SELECT sp.id AS space_id, sp.organization_id AS org FROM user_databases d JOIN spaces sp ON sp.id = d.space_id WHERE d.id = $1",
        [opts.resource.id],
      );
      if (r.rows.length === 0 || r.rows[0].org !== s.orgId) {
        throw new OrgScopeError(NextResponse.json({ error: "Introuvable" }, { status: 404 }), "resource-not-found");
      }
      if (s.permission === "none") {
        throw new OrgScopeError(NextResponse.json({ error: "Accès refusé" }, { status: 403 }), "permission-denied");
      }
      if (opts.minPermission === "editor" && s.permission === "viewer") {
        throw new OrgScopeError(NextResponse.json({ error: "Accès refusé" }, { status: 403 }), "permission-denied");
      }
      return { user: s.user, orgId: s.orgId, orgSlug: "x", spaceId: r.rows[0].space_id, permission: s.permission };
    },
  };
});

vi.mock("@/lib/automations/dispatch-row-events", () => ({ dispatchRowEvents: vi.fn() }));

// Réglage des actions du chat : valeur lue au clic (le test pose tout activé).
const ALL_ON = { actionsEnabled: true, readDatabases: true, proposeUpdates: true, proposeDeletes: true, proposeMerges: true, proposeCreates: true };
const chatSettings = vi.hoisted(() => ({ value: null as unknown }));
vi.mock("@/lib/settings/system-settings", () => ({
  getSetting: vi.fn(async () => chatSettings.value),
  setSetting: vi.fn(),
}));

vi.mock("@/lib/databases/attachment-cell-guard", async (orig) => {
  const actual = await orig<typeof import("@/lib/databases/attachment-cell-guard")>();
  return { ...actual, assertMediaCells: async () => {} };
});

import { GET } from "../route";
import { POST as apply } from "../[id]/apply/route";
import { POST as dismiss } from "../[id]/dismiss/route";
import { POST as undo } from "../[id]/undo/route";
import { POST as recompute } from "../[id]/recompute/route";
import { createProposal } from "@/lib/ai/proposals/store";
import { planUpdateRows } from "@/lib/ai/proposals/plan-update";
import { planDeleteRows } from "@/lib/ai/proposals/plan-delete";
import { planCreateRows } from "@/lib/ai/proposals/plan-create";
import type { ProposalPlan } from "@/lib/ai/proposals/plan-shared";
import type { ChatToolContext } from "@/lib/ai/chat-tools/context";

const URL_ = process.env.RELATIONS_TEST_DATABASE_URL;
const DB_NAME = URL_ ? new globalThis.URL(URL_).pathname.replace(/^\//, "") : "";
if (URL_ && !DB_NAME.includes("test")) {
  throw new Error(`RELATIONS_TEST_DATABASE_URL doit viser une base de test, reçu "${DB_NAME}"`);
}

type RouteFn = (req: NextRequest, c: { params: Promise<{ id: string }> }) => Promise<Response>;

describe.skipIf(!URL_)("routes des propositions", () => {
  let pool: Pool;
  let teardown: () => Promise<void>;
  const ORG = randomUUID();
  const ORG2 = randomUUID();
  const SPACE = randomUUID();
  const SPACE2 = randomUUID();
  const DB_A = randomUUID();
  const DB_Z = randomUUID(); // base d'une autre organisation
  const NAME = randomUUID();
  const ROW1 = randomUUID();
  const ROW2 = randomUUID();
  const ROW_Z = randomUUID();
  const USER = randomUUID();
  const PEER = randomUUID();
  const OUTSIDER_ADMIN = randomUUID();
  const SUPER = randomUUID();
  const j = JSON.stringify;

  const asUser = (id: string, orgId = ORG, globalRole = "member", permission: "editor" | "viewer" = "editor") => {
    h.session = { user: { id, globalRole }, orgId, permission };
  };
  const ctxOf = (userId: string, orgId = ORG) => ({ user: { id: userId }, orgId }) as unknown as ChatToolContext;
  const propose = (plan: ProposalPlan, userId = USER, databaseId = DB_A, orgId = ORG) =>
    createProposal({ ctx: ctxOf(userId, orgId), databaseId, payload: plan.payload, freshness: plan.freshness });
  const proposeUpdate = (value = "b", userId = USER) =>
    planUpdateRows(DB_A, [{ rowId: ROW1, cells: { [NAME]: value } }]).then((p) => propose(p, userId));
  const statusOf = async (id: string) =>
    (await pool.query("SELECT status FROM ai_proposals WHERE id = $1", [id])).rows[0]?.status as string | undefined;
  const cells = async (id: string) =>
    (await pool.query("SELECT cells FROM user_database_rows WHERE id = $1", [id])).rows[0]?.cells;
  const call = (fn: RouteFn, id: string, body?: unknown) =>
    fn(
      new NextRequest(`http://localhost/api/ai/proposals/${id}/x`, {
        method: "POST",
        body: body === undefined ? undefined : typeof body === "string" ? body : j(body),
      }),
      { params: Promise.resolve({ id }) },
    );
  const list = (qs: string) => GET(new NextRequest(`http://localhost/api/ai/proposals${qs}`));

  beforeAll(async () => {
    const f = await setupRowHistoryFixture(URL_!, "rh_ai_proposal_routes");
    pool = f.pool;
    teardown = f.teardown;
    h.db = f.db;
    h.pool = f.pool;
    await pool.query(`
      ALTER TABLE user_databases ADD COLUMN archived_at timestamptz, ADD COLUMN deleted_at timestamptz,
        ADD COLUMN name varchar(255) NOT NULL DEFAULT 'Base';
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
    await pool.query("INSERT INTO users (id) VALUES ($1),($2),($3),($4)", [USER, PEER, OUTSIDER_ADMIN, SUPER]);
    await pool.query("INSERT INTO spaces (id, organization_id) VALUES ($1,$2),($3,$4)", [SPACE, ORG, SPACE2, ORG2]);
    await pool.query("INSERT INTO user_databases (id, space_id, name) VALUES ($1,$2,'Clients'),($3,$4,'Autre')", [DB_A, SPACE, DB_Z, SPACE2]);
    await pool.query("INSERT INTO user_database_columns (id, database_id, name, type) VALUES ($1,$2,'n','text')", [NAME, DB_A]);
  });
  afterAll(async () => {
    await teardown();
  });

  beforeEach(async () => {
    chatSettings.value = ALL_ON;
    asUser(USER);
    await pool.query("DELETE FROM ai_proposals");
    await pool.query("DELETE FROM user_database_rows");
    await pool.query("DELETE FROM database_row_changes");
    await pool.query("INSERT INTO user_database_rows (id, database_id, cells, position) VALUES ($1,$2,$3::jsonb,0),($4,$2,$5::jsonb,1)", [
      ROW1, DB_A, j({ [NAME]: "a" }), ROW2, j({ [NAME]: "c" }),
    ]);
    await pool.query("INSERT INTO user_database_rows (id, database_id, cells, position) VALUES ($1,$2,'{}'::jsonb,0)", [ROW_Z, DB_Z]);
  });

  const mutating: [string, RouteFn][] = [
    ["apply", apply],
    ["dismiss", dismiss],
    ["undo", undo],
    ["recompute", recompute],
  ];

  describe("authentification", () => {
    it("non authentifié : 401 sur les cinq routes", async () => {
      const p = await proposeUpdate();
      h.session = null;
      expect((await list("?status=pending")).status).toBe(401);
      for (const [, fn] of mutating) expect((await call(fn, p.id)).status).toBe(401);
      expect(await statusOf(p.id)).toBe("pending");
    });
  });

  describe.each(mutating)("%s : cloisonnement", (_name, fn) => {
    const probes: [string, () => void][] = [
      ["autre utilisateur de la même organisation", () => asUser(PEER)],
      ["admin d'une autre organisation", () => asUser(OUTSIDER_ADMIN, ORG2, "admin")],
      ["super_admin dans son organisation", () => asUser(SUPER, ORG2, "super_admin")],
      ["super_admin franchissant la frontière vers l'organisation de la proposition", () => asUser(SUPER, ORG, "super_admin")],
      ["admin de l'organisation de la proposition (non propriétaire)", () => asUser(OUTSIDER_ADMIN, ORG, "admin")],
    ];
    it.each(probes)("%s : 404, corps identique à une proposition inexistante, rien n'est modifié", async (_label, as) => {
      const p = await proposeUpdate();
      as();
      const foreign = await call(fn, p.id, _name === "apply" ? {} : undefined);
      const unknown = await call(fn, randomUUID(), _name === "apply" ? {} : undefined);
      expect(foreign.status).toBe(404);
      expect(unknown.status).toBe(404);
      expect(await foreign.json()).toEqual(await unknown.json());
      expect(await statusOf(p.id)).toBe("pending");
      expect(await cells(ROW1)).toEqual({ [NAME]: "a" });
    });

    it("identifiant non UUID : 404", async () => {
      expect((await call(fn, "pas-un-uuid")).status).toBe(404);
    });
  });

  describe("ligne et base d'une autre organisation", () => {
    it("apply, undo et recompute d'une proposition portant sur une base d'une autre organisation : 404", async () => {
      const row = await pool.query(
        `INSERT INTO ai_proposals (org_id, user_id, database_id, type, payload, freshness, expires_at)
         VALUES ($1,$2,$3,'update_rows',$4::jsonb,$5::jsonb, now() + interval '1 hour') RETURNING id`,
        [ORG, USER, DB_Z, j({ type: "update_rows", changes: [{ rowId: ROW_Z, before: {}, after: { [NAME]: "x" } }] }), j({ rows: [] })],
      );
      const id = row.rows[0].id as string;
      expect((await call(apply, id)).status).toBe(404);
      expect((await call(recompute, id)).status).toBe(404);
      expect((await call(undo, id)).status).toBe(404);
      expect(await cells(ROW_Z)).toEqual({});
      expect(await statusOf(id)).toBe("pending");
    });
  });

  describe("apply", () => {
    it("viewer : 403, rien n'est écrit, la proposition reste en attente", async () => {
      const p = await proposeUpdate();
      asUser(USER, ORG, "member", "viewer");
      expect((await call(apply, p.id)).status).toBe(403);
      expect(await statusOf(p.id)).toBe("pending");
      expect(await cells(ROW1)).toEqual({ [NAME]: "a" });
      const view = (await (await list("?status=pending")).json()).proposals[0];
      expect(view.canApply).toBe(false);
    });

    it("applique : 200, ligne écrite", async () => {
      const p = await proposeUpdate();
      const res = await call(apply, p.id);
      expect(res.status).toBe(200);
      expect(await res.json()).toMatchObject({ status: "applied" });
      expect(await cells(ROW1)).toEqual({ [NAME]: "b" });
    });

    it("proposition en échec : apply refusé (409), aucune écriture", async () => {
      const p = await proposeUpdate();
      await pool.query("UPDATE ai_proposals SET status = 'failed' WHERE id = $1", [p.id]);
      expect((await call(apply, p.id)).status).toBe(409);
      expect(await cells(ROW1)).toEqual({ [NAME]: "a" });
      expect(await statusOf(p.id)).toBe("failed");
    });

    it("double application : un 200 et un 409, une seule écriture", async () => {
      const p = await proposeUpdate();
      await pool.query("DELETE FROM database_row_changes");
      const [r1, r2] = await Promise.all([call(apply, p.id), call(apply, p.id)]);
      expect([r1.status, r2.status].sort()).toEqual([200, 409]);
      const loser = r1.status === 409 ? r1 : r2;
      expect(await loser.json()).toMatchObject({ code: "refused" });
      expect((await pool.query("SELECT count(*)::int AS n FROM database_row_changes")).rows[0].n).toBe(1);
    });

    it("type d'action désactivé : 409 avec message, aucune écriture", async () => {
      const p = await proposeUpdate();
      chatSettings.value = { actionsEnabled: false };
      const res = await call(apply, p.id);
      expect(res.status).toBe(409);
      expect(await res.json()).toMatchObject({ code: "refused", error: expect.stringMatching(/désactivée par l'administrateur/) });
      expect(await cells(ROW1)).toEqual({ [NAME]: "a" });
      expect(await statusOf(p.id)).toBe("pending");
    });

    it("proposition expirée : 409 expired, rien n'est écrit", async () => {
      const p = await proposeUpdate();
      await pool.query("UPDATE ai_proposals SET expires_at = now() - interval '1 minute' WHERE id = $1", [p.id]);
      const res = await call(apply, p.id);
      expect(res.status).toBe(409);
      expect(await res.json()).toMatchObject({ code: "expired" });
      expect(await cells(ROW1)).toEqual({ [NAME]: "a" });
    });

    it("base modifiée depuis la proposition : 409 stale", async () => {
      const p = await proposeUpdate();
      await pool.query("UPDATE user_database_rows SET cells = $2::jsonb WHERE id = $1", [ROW1, j({ [NAME]: "autre" })]);
      const res = await call(apply, p.id);
      expect(res.status).toBe(409);
      expect(await res.json()).toMatchObject({ code: "stale" });
      expect(await cells(ROW1)).toEqual({ [NAME]: "autre" });
    });

    it.each([
      ["champ userId dans le corps", { userId: PEER }],
      ["champ orgId dans le corps", { orgId: ORG2 }],
      ["overrides de mauvais type", { overrides: "x" }],
      ["excludedGroupIds de mauvais type", { excludedGroupIds: [1] }],
      ["JSON invalide", "{not json"],
    ])("corps invalide (%s) : 400, la proposition reste en attente", async (_l, body) => {
      const p = await proposeUpdate();
      expect((await call(apply, p.id, body)).status).toBe(400);
      expect(await statusOf(p.id)).toBe("pending");
    });

    it("arbitrage sur une proposition qui n'en accepte pas : 400", async () => {
      const p = await proposeUpdate();
      expect((await call(apply, p.id, { excludedGroupIds: ["g"] })).status).toBe(400);
      expect(await statusOf(p.id)).toBe("pending");
    });
  });

  describe("dismiss et undo", () => {
    it("proposition en échec : ignorable (200) et recalculable (200)", async () => {
      const p = await proposeUpdate("f");
      await pool.query("UPDATE ai_proposals SET status = 'failed' WHERE id = $1", [p.id]);
      expect((await call(recompute, p.id)).status).toBe(200);
      expect((await call(dismiss, p.id)).status).toBe(200);
      expect(await statusOf(p.id)).toBe("dismissed");
    });

    it("dismiss : 200 puis 409", async () => {
      const p = await proposeUpdate();
      expect((await call(dismiss, p.id)).status).toBe(200);
      expect(await statusOf(p.id)).toBe("dismissed");
      expect((await call(dismiss, p.id)).status).toBe(409);
      expect((await call(apply, p.id)).status).toBe(409);
    });

    it("undo après apply : 200 puis 409, ligne restaurée", async () => {
      const p = await proposeUpdate();
      expect((await call(apply, p.id)).status).toBe(200);
      expect((await call(undo, p.id)).status).toBe(200);
      expect(await cells(ROW1)).toEqual({ [NAME]: "a" });
      expect((await call(undo, p.id)).status).toBe(409);
    });

    it("undo d'une proposition non appliquée : 409", async () => {
      const p = await proposeUpdate();
      expect((await call(undo, p.id)).status).toBe(409);
    });

    it("viewer : undo refusé (403)", async () => {
      const p = await proposeUpdate();
      expect((await call(apply, p.id)).status).toBe(200);
      asUser(USER, ORG, "member", "viewer");
      expect((await call(undo, p.id)).status).toBe(403);
      expect(await statusOf(p.id)).toBe("applied");
    });
  });

  describe("recompute", () => {
    it("proposition périmée : nouvelle proposition (replaces_id), l'ancienne passe à stale", async () => {
      const p = await proposeUpdate("b");
      await pool.query("UPDATE user_database_rows SET cells = $2::jsonb WHERE id = $1", [ROW1, j({ [NAME]: "autre" })]);
      expect((await call(apply, p.id)).status).toBe(409);
      const res = await call(recompute, p.id);
      expect(res.status).toBe(200);
      const { proposal } = await res.json();
      expect(proposal).toMatchObject({ type: "update_rows", status: "pending", rowCount: 1, canApply: true });
      expect(proposal.id).not.toBe(p.id);
      const row = (await pool.query("SELECT replaces_id, status FROM ai_proposals WHERE id = $1", [proposal.id])).rows[0];
      expect(row).toMatchObject({ replaces_id: p.id, status: "pending" });
      expect(await statusOf(p.id)).toBe("stale");
      // L'intention est rejouée sur l'état actuel : le `before` reflète la valeur courante.
      expect(proposal.payload.changes[0]).toMatchObject({ before: { [NAME]: "autre" }, after: { [NAME]: "b" } });
      expect((await call(apply, proposal.id)).status).toBe(200);
      expect(await cells(ROW1)).toEqual({ [NAME]: "b" });
    });

    it("suppression : mêmes lignes rejouées", async () => {
      const p = await propose(await planDeleteRows(DB_A, [ROW1]));
      const res = await call(recompute, p.id);
      expect(res.status).toBe(200);
      expect((await res.json()).proposal).toMatchObject({ type: "delete_rows", rowCount: 1 });
    });

    it("ligne disparue depuis : 422 avec message, l'ancienne reste inchangée", async () => {
      const p = await proposeUpdate();
      await pool.query("DELETE FROM user_database_rows WHERE id = $1", [ROW1]);
      const res = await call(recompute, p.id);
      expect(res.status).toBe(422);
      expect(await res.json()).toMatchObject({ code: "plan_failed" });
      expect(await statusOf(p.id)).toBe("pending");
    });

    it("création de lignes : 400, non applicable", async () => {
      const p = await propose(await planCreateRows(DB_A, [{ cells: { [NAME]: "n" } }]));
      const res = await call(recompute, p.id);
      expect(res.status).toBe(400);
      expect(await res.json()).toMatchObject({ code: "not_applicable" });
    });

    it("type d'action désactivé : 409 avec message, aucune nouvelle proposition", async () => {
      const p = await proposeUpdate();
      chatSettings.value = { proposeUpdates: false };
      const res = await call(recompute, p.id);
      expect(res.status).toBe(409);
      expect(await res.json()).toMatchObject({ code: "refused", error: expect.stringMatching(/désactivée par l'administrateur/) });
      expect(await statusOf(p.id)).toBe("pending");
    });

    it("proposition appliquée : 409", async () => {
      const p = await proposeUpdate();
      expect((await call(apply, p.id)).status).toBe(200);
      expect((await call(recompute, p.id)).status).toBe(409);
    });
  });

  describe("GET", () => {
    it("pending : seulement les propositions en attente, non expirées, de l'utilisateur et de son organisation", async () => {
      const mine = await proposeUpdate("m");
      const done = await proposeUpdate("d");
      await pool.query("UPDATE ai_proposals SET status = 'dismissed' WHERE id = $1", [done.id]);
      const expired = await proposeUpdate("e");
      await pool.query("UPDATE ai_proposals SET expires_at = now() - interval '1 minute' WHERE id = $1", [expired.id]);
      const peers = await proposeUpdate("p", PEER);
      const otherOrg = await propose(await planUpdateRows(DB_A, [{ rowId: ROW1, cells: { [NAME]: "o" } }]), USER, DB_A, ORG2);
      const res = await list(`?status=pending&userId=${PEER}&orgId=${ORG2}`);
      expect(res.status).toBe(200);
      const ids = (await res.json()).proposals.map((v: { id: string }) => v.id);
      expect(ids).toEqual([mine.id]);
      expect(ids).not.toContain(peers.id);
      expect(ids).not.toContain(otherOrg.id);
    });

    it("open : pending, stale et failed de moins de 24 h de l'utilisateur, jamais ceux d'un autre utilisateur ou d'une autre organisation", async () => {
      const pend = await proposeUpdate("p1");
      const stale = await proposeUpdate("s");
      await pool.query("UPDATE ai_proposals SET status = 'stale' WHERE id = $1", [stale.id]);
      const failed = await proposeUpdate("f");
      await pool.query("UPDATE ai_proposals SET status = 'failed' WHERE id = $1", [failed.id]);
      const dismissed = await proposeUpdate("d");
      await pool.query("UPDATE ai_proposals SET status = 'dismissed' WHERE id = $1", [dismissed.id]);
      const oldFailed = await proposeUpdate("o");
      await pool.query(
        "UPDATE ai_proposals SET status = 'failed', expires_at = now() - interval '1 minute' WHERE id = $1",
        [oldFailed.id],
      );
      const peerFailed = await proposeUpdate("pf", PEER);
      await pool.query("UPDATE ai_proposals SET status = 'failed' WHERE id = $1", [peerFailed.id]);
      const otherOrg = await propose(await planUpdateRows(DB_A, [{ rowId: ROW1, cells: { [NAME]: "x" } }]), USER, DB_A, ORG2);
      await pool.query("UPDATE ai_proposals SET status = 'failed' WHERE id = $1", [otherOrg.id]);
      const res = await list(`?status=open&userId=${PEER}&orgId=${ORG2}`);
      expect(res.status).toBe(200);
      const ids = (await res.json()).proposals.map((v: { id: string }) => v.id);
      expect([...ids].sort()).toEqual([pend.id, stale.id, failed.id].sort());
      for (const bad of [dismissed.id, oldFailed.id, peerFailed.id, otherOrg.id]) expect(ids).not.toContain(bad);
    });

    it("sans paramètre : équivaut à pending ; statut inconnu : 400", async () => {
      const mine = await proposeUpdate();
      expect((await (await list("")).json()).proposals.map((v: { id: string }) => v.id)).toEqual([mine.id]);
      expect((await list("?status=applied")).status).toBe(400);
    });

    it("forme de la vue : résumé, nombre de lignes, conflits, nom de base, droit d'application", async () => {
      await proposeUpdate();
      const [v] = (await (await list("?status=pending")).json()).proposals;
      expect(v).toMatchObject({
        databaseId: DB_A,
        databaseName: "Clients",
        type: "update_rows",
        status: "pending",
        summary: "Mettre à jour 1 ligne",
        rowCount: 1,
        conflictCount: 0,
        canApply: true,
      });
      expect(typeof v.createdAt).toBe("string");
      expect(typeof v.expiresAt).toBe("string");
      expect(v.payload.type).toBe("update_rows");
    });

    it("ids : ignore les ids étrangers et invalides, renvoie tous statuts pour les siens", async () => {
      const mine = await proposeUpdate("m");
      const applied = await proposeUpdate("x");
      await pool.query("UPDATE ai_proposals SET status = 'applied' WHERE id = $1", [applied.id]);
      const peers = await proposeUpdate("p", PEER);
      const res = await list(`?ids=${mine.id},${applied.id},${peers.id},${randomUUID()},zzz`);
      const got = (await res.json()).proposals as { id: string; status: string }[];
      expect(got.map((v) => v.id).sort()).toEqual([mine.id, applied.id].sort());
      expect(got.find((v) => v.id === applied.id)?.status).toBe("applied");
    });

    it("accès retiré à l'espace : proposition absente de la liste et des ids, aucune cellule exposée", async () => {
      const plan = await planDeleteRows(DB_A, [ROW1]);
      const del = await propose(plan);
      expect((await (await list(`?ids=${del.id}`)).json()).proposals[0].payload.rows[0].cells).toEqual({});
      expect(JSON.stringify((await (await list(`?ids=${del.id}`)).json()).proposals)).not.toContain(ROW2);
      h.session = { ...h.session!, permission: "none" };
      expect((await (await list(`?ids=${del.id}`)).json()).proposals).toEqual([]);
      expect((await (await list("?status=pending")).json()).proposals).toEqual([]);
    });

    it("ids d'une autre organisation : ignorés", async () => {
      const foreign = await propose(await planUpdateRows(DB_A, [{ rowId: ROW1, cells: { [NAME]: "o" } }]), USER, DB_A, ORG2);
      const got = (await (await list(`?ids=${foreign.id}`)).json()).proposals;
      expect(got).toEqual([]);
    });
  });
});
