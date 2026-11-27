import { describe, it, expect, vi, beforeEach } from "vitest";

const h = vi.hoisted(() => ({
  results: [] as unknown[][],
  wheres: [] as unknown[],
  sets: [] as unknown[],
  inserts: [] as unknown[],
}));

vi.mock("drizzle-orm", () => ({
  and: (...c: unknown[]) => ({ op: "and", c }),
  eq: (col: unknown, v: unknown) => ({ op: "eq", col, v }),
  gt: (col: unknown, v: unknown) => ({ op: "gt", col, v }),
  lt: (col: unknown, v: unknown) => ({ op: "lt", col, v }),
  isNull: (col: unknown) => ({ op: "isNull", col }),
  or: (...c: unknown[]) => ({ op: "or", c }),
  count: () => "count",
}));

vi.mock("@/lib/db/schema-ai-creation-proposals", () => ({
  aiCreationProposals: {
    id: "id",
    orgId: "orgId",
    userId: "userId",
    status: "status",
    expiresAt: "expiresAt",
    resultId: "resultId",
    appliedAt: "appliedAt",
  },
}));

function chain() {
  const c: Record<string, unknown> = {};
  const next = () => Promise.resolve(h.results.shift() ?? []);
  c.from = () => c;
  c.limit = next;
  c.values = (v: unknown) => {
    h.inserts.push(v);
    return c;
  };
  c.set = (v: unknown) => {
    h.sets.push(v);
    return c;
  };
  c.where = (w: unknown) => {
    h.wheres.push(w);
    const p = next();
    return Object.assign(p, { returning: () => p, limit: () => p });
  };
  c.returning = next;
  return c;
}

vi.mock("@/lib/db", () => ({
  db: { select: () => chain(), insert: () => chain(), update: () => chain() },
}));

import {
  createCreationProposal,
  getOwnCreationProposal,
  claimForApply,
  markApplied,
  markFailed,
  markDismissed,
  markUndone,
  markRestored,
  countPendingCreationProposals,
  CREATION_STALE_APPLYING_MS,
  CREATION_PROPOSAL_TTL_MS,
} from "../store";

const flat = (w: unknown): unknown[] => {
  const x = w as { op: string; c?: unknown[] };
  return x.op === "and" || x.op === "or" ? x.c!.flatMap(flat) : [x];
};
const has = (w: unknown, op: string, col: string, v?: unknown) =>
  flat(w).some((n) => {
    const e = n as { op: string; col: string; v: unknown };
    return e.op === op && e.col === col && (v === undefined || e.v === v);
  });

beforeEach(() => {
  h.results = [];
  h.wheres = [];
  h.sets = [];
  h.inserts = [];
});

describe("creation proposals store", () => {
  it("createCreationProposal pose une expiration future et le statut pending", async () => {
    const now = new Date("2026-01-01T00:00:00Z");
    h.results = [[{ id: "p1" }]];
    await createCreationProposal({
      orgId: "o",
      userId: "u",
      spaceId: "s",
      kind: "document",
      payload: { a: 1 },
      now,
    });
    const v = h.inserts[0] as { expiresAt: Date; orgId: string; userId: string };
    expect(v.orgId).toBe("o");
    expect(v.userId).toBe("u");
    expect(v.expiresAt.getTime()).toBe(now.getTime() + CREATION_PROPOSAL_TTL_MS);
  });

  it("getOwnCreationProposal filtre sur id, organisation ET propriétaire", async () => {
    h.results = [[]];
    const r = await getOwnCreationProposal("orgB", "user2", "p1");
    expect(r).toBeNull();
    const w = h.wheres[0];
    expect(has(w, "eq", "id", "p1")).toBe(true);
    expect(has(w, "eq", "orgId", "orgB")).toBe(true);
    expect(has(w, "eq", "userId", "user2")).toBe(true);
  });

  it("getOwnCreationProposal renvoie null pour une proposition pending expirée", async () => {
    const now = new Date("2026-01-02T00:00:00Z");
    h.results = [[{ id: "p1", status: "pending", expiresAt: new Date("2026-01-01T00:00:00Z") }]];
    expect(await getOwnCreationProposal("o", "u", "p1", now)).toBeNull();
  });

  it("getOwnCreationProposal renvoie la proposition non expirée", async () => {
    const now = new Date("2026-01-01T00:00:00Z");
    const row = { id: "p1", status: "pending", expiresAt: new Date("2026-01-02T00:00:00Z") };
    h.results = [[row]];
    expect(await getOwnCreationProposal("o", "u", "p1", now)).toEqual(row);
  });

  it("claimForApply est conditionnel : pending et non expirée", async () => {
    const now = new Date("2026-01-01T00:00:00Z");
    h.results = [[{ id: "p1" }]];
    expect(await claimForApply("p1", now)).toBe(true);
    const w = h.wheres[0];
    expect(has(w, "eq", "status", "pending")).toBe(true);
    expect(has(w, "gt", "expiresAt", now)).toBe(true);
    expect((h.sets[0] as { status: string }).status).toBe("applying");
  });

  it("claimForApply reprend une proposition applying depuis plus de 10 minutes, sans result_id", async () => {
    const now = new Date("2026-01-01T12:00:00Z");
    h.results = [[{ id: "p1" }]];
    expect(await claimForApply("p1", now)).toBe(true);
    const w = h.wheres[0];
    expect(has(w, "eq", "status", "applying")).toBe(true);
    expect(has(w, "isNull", "resultId")).toBe(true);
    const lt = flat(w).find((n) => (n as { op: string }).op === "lt") as { v: Date };
    expect(lt.v.getTime()).toBe(now.getTime() - CREATION_STALE_APPLYING_MS);
    expect(CREATION_STALE_APPLYING_MS).toBe(600_000);
    expect((h.sets[0] as { appliedAt: Date }).appliedAt).toEqual(now);
  });

  it("markDismissed renvoie false si rien n'a été mis à jour", async () => {
    h.results = [[]];
    expect(await markDismissed("p1")).toBe(false);
    h.results = [[{ id: "p1" }]];
    expect(await markDismissed("p1")).toBe(true);
  });

  it("countPendingCreationProposals compte les pending non échues du propriétaire", async () => {
    const now = new Date("2026-01-01T00:00:00Z");
    h.results = [[{ n: 7 }]];
    expect(await countPendingCreationProposals("o", "u", now)).toBe(7);
    const w = h.wheres[0];
    expect(has(w, "eq", "orgId", "o")).toBe(true);
    expect(has(w, "eq", "userId", "u")).toBe(true);
    expect(has(w, "eq", "status", "pending")).toBe(true);
    expect(has(w, "gt", "expiresAt", now)).toBe(true);
  });

  it("deux claimForApply concurrents : un seul gagne", async () => {
    h.results = [[{ id: "p1" }], []];
    const [a, b] = await Promise.all([claimForApply("p1"), claimForApply("p1")]);
    expect([a, b].filter(Boolean)).toHaveLength(1);
  });

  it("claimForApply renvoie false pour une proposition expirée (aucune ligne mise à jour)", async () => {
    h.results = [[]];
    expect(await claimForApply("p1", new Date("2030-01-01T00:00:00Z"))).toBe(false);
  });

  it("markApplied, markFailed, markDismissed posent le bon statut, gardés par l'état attendu", async () => {
    h.results = [[], [], [{ id: "p1" }]];
    await markApplied("p1", "doc1", "document");
    await markFailed("p1");
    await markDismissed("p1");
    expect((h.sets[0] as { status: string; resultId: string }).status).toBe("applied");
    expect((h.sets[0] as { resultId: string }).resultId).toBe("doc1");
    expect((h.sets[1] as { status: string }).status).toBe("failed");
    expect((h.sets[2] as { status: string }).status).toBe("dismissed");
    expect(has(h.wheres[0], "eq", "status", "applying")).toBe(true);
    expect(has(h.wheres[1], "eq", "status", "applying")).toBe(true);
    expect(has(h.wheres[2], "eq", "status", "pending")).toBe(true);
  });

  it("markUndone : applied vers undone, gardé par l'état applied", async () => {
    h.results = [[{ id: "p1" }]];
    expect(await markUndone("p1", "org1", "u1")).toBe(true);
    expect((h.sets[0] as { status: string }).status).toBe("undone");
    expect(has(h.wheres[0], "eq", "status", "applied")).toBe(true);
    expect(has(h.wheres[0], "eq", "orgId", "org1")).toBe(true);
    expect(has(h.wheres[0], "eq", "userId", "u1")).toBe(true);
  });

  it("markRestored : dismissed vers pending, seulement si non expirée", async () => {
    const now = new Date("2026-01-01T00:00:00Z");
    h.results = [[{ id: "p1" }], []];
    expect(await markRestored("p1", "org1", "u1", now)).toBe(true);
    expect((h.sets[0] as { status: string }).status).toBe("pending");
    expect(has(h.wheres[0], "eq", "status", "dismissed")).toBe(true);
    expect(has(h.wheres[0], "gt", "expiresAt", now)).toBe(true);
    expect(has(h.wheres[0], "eq", "orgId", "org1")).toBe(true);
    expect(has(h.wheres[0], "eq", "userId", "u1")).toBe(true);
    expect(await markRestored("p1", "org1", "u1", now)).toBe(false);
  });
});
