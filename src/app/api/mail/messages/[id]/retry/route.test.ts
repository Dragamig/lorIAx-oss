import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

const h = vi.hoisted(() => ({ retry: vi.fn(), visible: vi.fn(), access: vi.fn() }));
vi.mock("@/lib/crm/access", () => ({ requireCrm: (...a: unknown[]) => h.access(...a) }));
vi.mock("@/lib/mailing/retry", () => ({ retryFailed: (...a: unknown[]) => h.retry(...a) }));
vi.mock("@/lib/mailing/threads", () => ({ getVisibleMail: (...a: unknown[]) => h.visible(...a) }));

import { POST } from "./route";

const ID = "44444444-4444-4444-8444-444444444444";
const call = (id = ID) =>
  POST(new NextRequest(`http://x/api/mail/messages/${id}/retry`, { method: "POST" }), { params: Promise.resolve({ id }) });

beforeEach(() => {
  h.retry.mockReset();
  h.visible.mockReset();
  h.access.mockReset();
  h.access.mockResolvedValue({ ok: true, user: { id: "u1" }, orgId: "org1", isAdmin: false, enabled: true });
});

describe("POST /api/mail/messages/[id]/retry", () => {
  it("returns the auth response when not authenticated", async () => {
    h.access.mockResolvedValue({ ok: false, response: new Response(null, { status: 401 }) });
    expect((await call()).status).toBe(401);
    expect(h.retry).not.toHaveBeenCalled();
  });
  it("returns 404 on a malformed id", async () => {
    expect((await call("zzz")).status).toBe(404);
    expect(h.retry).not.toHaveBeenCalled();
  });
  it("retries with the session org and user", async () => {
    h.retry.mockResolvedValue({ ok: true });
    const res = await call();
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ id: ID, status: "scheduled" });
    expect(h.retry).toHaveBeenCalledWith("org1", "u1", ID);
  });
  it("returns a silent 404 for another user's or another org's mail", async () => {
    h.retry.mockResolvedValue({ ok: false, reason: "not_found" });
    const res = await call();
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: "Introuvable" });
  });
  it("returns 409 not_failed with the current status", async () => {
    h.retry.mockResolvedValue({ ok: false, reason: "not_failed" });
    h.visible.mockResolvedValue({ id: ID, status: "sent" });
    const res = await call();
    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({ code: "not_failed", status: "sent" });
    expect(h.visible).toHaveBeenCalledWith("org1", "u1", ID);
  });
  it("returns 404 when not_failed but the mail is no longer visible", async () => {
    h.retry.mockResolvedValue({ ok: false, reason: "not_failed" });
    h.visible.mockResolvedValue(null);
    expect((await call()).status).toBe(404);
  });
  it("returns 409 delivery_unknown", async () => {
    h.retry.mockResolvedValue({ ok: false, reason: "delivery_unknown" });
    const res = await call();
    expect(res.status).toBe(409);
    expect((await res.json()).code).toBe("delivery_unknown");
  });
  it("returns 409 no_account", async () => {
    h.retry.mockResolvedValue({ ok: false, reason: "no_account" });
    const res = await call();
    expect(res.status).toBe(409);
    expect((await res.json()).code).toBe("no_account");
  });
  it("returns 429 on quota", async () => {
    h.retry.mockResolvedValue({ ok: false, reason: "quota", code: "quota_plan", limit: 50 });
    const res = await call();
    expect(res.status).toBe(429);
    expect(await res.json()).toMatchObject({ code: "quota_plan", limit: 50 });
  });
  it("returns 429 quota_abuse with a null limit", async () => {
    h.retry.mockResolvedValue({ ok: false, reason: "quota", code: "quota_abuse", limit: null });
    const res = await call();
    expect(res.status).toBe(429);
    expect(await res.json()).toMatchObject({ code: "quota_abuse", limit: null });
  });
  it("returns 500 on an unknown reason", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    h.retry.mockResolvedValue({ ok: false, reason: "mystery" });
    expect((await call()).status).toBe(500);
    expect(spy).toHaveBeenCalled();
    spy.mockRestore();
  });
});
