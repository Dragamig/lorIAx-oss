import { describe, it, expect, vi, beforeEach } from "vitest";

interface Call { op: string; set?: Record<string, unknown> }
const h = vi.hoisted(() => ({
  calls: [] as { op: string; set?: Record<string, unknown> }[],
  results: { select: [] as unknown[][], update: [] as unknown[][] },
  peekQuota: vi.fn(),
}));

function chain(op: string, result: unknown[]) {
  const call: Call = { op };
  h.calls.push(call);
  const p: unknown = new Proxy(function () {}, {
    get(_t, k) {
      if (k === "then") return (res: (v: unknown) => void, rej: (e: unknown) => void) => Promise.resolve(result).then(res, rej);
      return (...a: unknown[]) => {
        if (k === "set") call.set = a[0] as Record<string, unknown>;
        return p;
      };
    },
  });
  return p;
}
vi.mock("@/lib/db", () => ({
  db: {
    select: () => chain("select", h.results.select.shift() ?? []),
    update: () => chain("update", h.results.update.shift() ?? []),
  },
}));
vi.mock("../quota", () => ({ peekMailQuota: (...a: unknown[]) => h.peekQuota(...a) }));

import { retryFailed } from "../retry";

const base = { id: "m1", status: "failed", lastError: "smtp 550", accountId: "a1", messageId: "<x@y>" };
const writes = () => h.calls.filter((c) => c.op === "update");

beforeEach(() => {
  h.calls.length = 0;
  h.results.select = [];
  h.results.update = [];
  h.peekQuota.mockReset().mockResolvedValue({ exceeded: false, limit: 50 });
});

describe("retryFailed", () => {
  it("remet le mail en file avec l'état attendu", async () => {
    h.results.select = [[base]];
    h.results.update = [[{ id: "m1" }]];
    expect(await retryFailed("o", "u", "m1")).toEqual({ ok: true });
    const set = writes()[0].set!;
    expect(set.status).toBe("scheduled");
    expect(set.lastError).toBeNull();
    expect(set.attempts).toBe(0);
    // horloge de la base (sql`now()`), pas celle de JS
    expect(set.scheduledAt).not.toBeInstanceOf(Date);
    expect(set.scheduledAt).toBeDefined();
    expect(set.updatedAt).not.toBeInstanceOf(Date);
  });

  it("conserve messageId, sentAt, clientKey et interactionRowId", async () => {
    h.results.select = [[base]];
    h.results.update = [[{ id: "m1" }]];
    await retryFailed("o", "u", "m1");
    const keys = Object.keys(writes()[0].set!);
    for (const k of ["messageId", "sentAt", "clientKey", "interactionRowId"]) expect(keys).not.toContain(k);
  });

  it("autre utilisateur ou organisation : not_found, aucune écriture", async () => {
    h.results.select = [[]];
    expect(await retryFailed("o2", "u2", "m1")).toEqual({ ok: false, reason: "not_found" });
    expect(writes()).toHaveLength(0);
  });

  it.each(["sent", "scheduled", "cancelled", "sending"])("statut %s : not_failed", async (status) => {
    h.results.select = [[{ ...base, status }]];
    expect(await retryFailed("o", "u", "m1")).toEqual({ ok: false, reason: "not_failed" });
    expect(writes()).toHaveLength(0);
  });

  it("delivery_unknown refusé", async () => {
    h.results.select = [[{ ...base, lastError: "delivery_unknown" }]];
    expect(await retryFailed("o", "u", "m1")).toEqual({ ok: false, reason: "delivery_unknown" });
    expect(writes()).toHaveLength(0);
  });

  it("boîte supprimée : no_account", async () => {
    h.results.select = [[{ ...base, accountId: null }]];
    expect(await retryFailed("o", "u", "m1")).toEqual({ ok: false, reason: "no_account" });
    expect(writes()).toHaveLength(0);
  });

  it("quota dépassé : refus sans écriture", async () => {
    h.results.select = [[base]];
    h.peekQuota.mockResolvedValue({ exceeded: true, limit: 50 });
    expect(await retryFailed("o", "u", "m1")).toEqual({ ok: false, reason: "quota", code: "quota_plan", limit: 50 });
    expect(h.peekQuota).toHaveBeenCalledWith("o", "u");
    expect(writes()).toHaveLength(0);
  });

  it("quota dépassé sans plafond d'offre : quota_abuse", async () => {
    h.results.select = [[base]];
    h.peekQuota.mockResolvedValue({ exceeded: true, limit: null });
    expect(await retryFailed("o", "u", "m1")).toEqual({ ok: false, reason: "quota", code: "quota_abuse", limit: null });
  });

  it("double appel concurrent : un seul succès (second UPDATE sans ligne)", async () => {
    h.results.select = [[base], [base]];
    h.results.update = [[{ id: "m1" }], []];
    const [a, b] = await Promise.all([retryFailed("o", "u", "m1"), retryFailed("o", "u", "m1")]);
    expect([a, b]).toContainEqual({ ok: true });
    expect([a, b]).toContainEqual({ ok: false, reason: "not_failed" });
  });
});
