import { describe, it, expect, vi, beforeEach } from "vitest";

const h = vi.hoisted(() => ({ plan: "free" as "free" | "growth" | "enterprise" }));
const getOrgPlan = vi.hoisted(() => vi.fn(async (_orgId: string) => null as "free" | "growth" | "enterprise" | null));
vi.mock("@/lib/modules/hooks", () => ({ getHooks: () => ({ usage: { getOrgPlan } }) }));

import { checkMailQuota, peekMailQuota, MAIL_QUOTA_BY_PLAN, MAIL_ABUSE_TIERS } from "../quota";

let n = 0;
const ids = () => ({ org: `org-${++n}-${Math.random()}`, user: `user-${n}-${Math.random()}` });

beforeEach(() => {
  h.plan = "free";
  getOrgPlan.mockReset();
  getOrgPlan.mockImplementation(async () => h.plan);
});

describe("mail quota", () => {
  it("exposes the plan values and the abuse tier", () => {
    expect(MAIL_QUOTA_BY_PLAN).toEqual({ free: 50, growth: 500, enterprise: null });
    expect(MAIL_ABUSE_TIERS).toEqual([{ maxRequests: 200, windowMs: 3_600_000 }]);
  });

  it("free plan allows 50 recipients then refuses", async () => {
    const { org, user } = ids();
    for (let i = 0; i < 50; i++) expect(await checkMailQuota(org, user + i, 1)).toEqual({ ok: true });
    expect(await checkMailQuota(org, user + "x", 1)).toEqual({ ok: false, reason: "plan", limit: 50 });
  });

  it("refuses all or nothing when a mail would cross the plan limit", async () => {
    const { org, user } = ids();
    expect(await checkMailQuota(org, user, 48)).toEqual({ ok: true });
    expect(await checkMailQuota(org, user, 3)).toEqual({ ok: false, reason: "plan", limit: 50 });
    // rien n'a ete consomme par le refus : 2 destinataires passent encore
    expect(await checkMailQuota(org, user, 2)).toEqual({ ok: true });
    expect(await checkMailQuota(org, user, 1)).toMatchObject({ ok: false, reason: "plan" });
  });

  it("growth allows 500", async () => {
    h.plan = "growth";
    const { org } = ids();
    for (let i = 0; i < 5; i++) expect(await checkMailQuota(org, `u${i}${n}`, 100)).toEqual({ ok: true });
    expect(await checkMailQuota(org, "ux" + n, 1)).toEqual({ ok: false, reason: "plan", limit: 500 });
  });

  it("enterprise has no plan limit", async () => {
    h.plan = "enterprise";
    const { org } = ids();
    for (let i = 0; i < 4; i++) expect(await checkMailQuota(org, `e${i}${n}`, 100)).toEqual({ ok: true });
  });

  it("abuse tier refuses the 201st recipient within an hour on every plan", async () => {
    h.plan = "enterprise";
    const { org, user } = ids();
    expect(await checkMailQuota(org, user, 50)).toEqual({ ok: true });
    expect(await checkMailQuota(org, user, 50)).toEqual({ ok: true });
    expect(await checkMailQuota(org, user, 50)).toEqual({ ok: true });
    expect(await checkMailQuota(org, user, 50)).toEqual({ ok: true });
    expect(await checkMailQuota(org, user, 1)).toEqual({ ok: false, reason: "abuse", limit: 200 });
  });

  it("uses the effective plan hook so an expired growth org counts as free", async () => {
    h.plan = "free"; // le hook renvoie free pour une offre growth echue
    const { org, user } = ids();
    expect(await checkMailQuota(org, user, 51)).toEqual({ ok: false, reason: "plan", limit: 50 });
    expect(getOrgPlan).toHaveBeenCalledWith(org);
  });

  it("a 3-recipient mail consumes 3 on both counters", async () => {
    const { org, user } = ids();
    expect(await checkMailQuota(org, user, 3)).toEqual({ ok: true });
    expect(await checkMailQuota(org, user, 47)).toEqual({ ok: true });
    expect(await checkMailQuota(org, user, 1)).toMatchObject({ ok: false, reason: "plan" });
  });

  it("peekMailQuota does not consume and tolerates the last token", async () => {
    const { org, user } = ids();
    await checkMailQuota(org, user, 50);
    expect(await peekMailQuota(org, user)).toEqual({ exceeded: false, limit: 50 });
    expect(await peekMailQuota(org, user)).toEqual({ exceeded: false, limit: 50 });
  });

  it("peekMailQuota reports exceeded when the counter is above the limit", async () => {
    h.plan = "growth";
    const { org, user } = ids();
    await checkMailQuota(org, user, 60);
    h.plan = "free";
    expect(await peekMailQuota(org, user)).toEqual({ exceeded: true, limit: 50 });
  });

  it("peekMailQuota is never exceeded for enterprise", async () => {
    h.plan = "enterprise";
    const { org, user } = ids();
    expect(await peekMailQuota(org, user)).toEqual({ exceeded: false, limit: null });
  });
});
