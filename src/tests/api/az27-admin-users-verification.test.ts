/**
 * AZ-27 task 9: admin actions on email verification (resend link, mark as
 * verified) and the `emailVerifiedAt` field of the admin users list.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const state = vi.hoisted(() => ({
  queue: [] as unknown[][],
  selectArg: null as Record<string, unknown> | null,
}));

vi.mock("@/lib/db", () => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const self: any = {
    select: vi.fn((arg: Record<string, unknown>) => {
      state.selectArg = arg;
      return self;
    }),
    from: vi.fn(() => self),
    where: vi.fn(() => self),
    orderBy: vi.fn(() => Promise.resolve(state.queue.shift() ?? [])),
    limit: vi.fn(() => Promise.resolve(state.queue.shift() ?? [])),
  };
  return { db: self };
});

const getSessionUser = vi.hoisted(() => vi.fn());
vi.mock("@/lib/auth", () => ({ clearAuthUserStateCache: vi.fn() }));
vi.mock("@/lib/auth/revoke-sessions", () => ({ revokeUserSessions: vi.fn(async () => {}) }));
vi.mock("@/lib/auth/get-user", () => ({ getSessionUser }));
vi.mock("@/lib/org/get-request-org", () => ({ getRequestOrgId: vi.fn(async () => "org-1") }));
const getOrgMemberIds = vi.hoisted(() => vi.fn(async () => ["u-1"]));
vi.mock("@/lib/org/org-members", () => ({ getOrgMemberIds }));

const sendVerificationEmail = vi.hoisted(() => vi.fn());
const markEmailVerified = vi.hoisted(() => vi.fn(async () => {}));
vi.mock("@/lib/auth/email-verification", () => ({ sendVerificationEmail, markEmailVerified }));

import { POST } from "@/app/api/admin/users/verification/route";
import { GET } from "@/app/api/admin/users/route";

function req(body: unknown) {
  return new Request("http://localhost/api/admin/users/verification", {
    method: "POST",
    body: JSON.stringify(body),
  }) as unknown as Parameters<typeof POST>[0];
}

const unverified = { id: "u-1", name: "Ana", email: "ana@x.fr", emailVerifiedAt: null };

beforeEach(() => {
  state.queue = [];
  state.selectArg = null;
  sendVerificationEmail.mockReset();
  markEmailVerified.mockClear();
  getSessionUser.mockResolvedValue({ id: "a-1", globalRole: "admin" });
  getOrgMemberIds.mockResolvedValue(["u-1"]);
});

describe("POST /api/admin/users/verification", () => {
  it.each(["viewer", "editor"])("%s => 403", async (role) => {
    getSessionUser.mockResolvedValue({ id: "a-1", globalRole: role });
    const res = await POST(req({ id: "u-1", action: "resend" }));
    expect(res.status).toBe(403);
    expect(sendVerificationEmail).not.toHaveBeenCalled();
  });

  it("id outside the org members => silent 404, no service call", async () => {
    getOrgMemberIds.mockResolvedValue(["other"]);
    const res = await POST(req({ id: "u-1", action: "resend" }));
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: "Utilisateur introuvable" });
    expect(sendVerificationEmail).not.toHaveBeenCalled();
    expect(markEmailVerified).not.toHaveBeenCalled();
  });

  it("resend on unverified account calls sendVerificationEmail", async () => {
    state.queue = [[unverified]];
    sendVerificationEmail.mockResolvedValue({ sent: true });
    const res = await POST(req({ id: "u-1", action: "resend" }));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ success: true, sent: true });
    expect(sendVerificationEmail).toHaveBeenCalledWith({ id: "u-1", name: "Ana", email: "ana@x.fr" });
  });

  it("resend with cooldown => 200 sent:false", async () => {
    state.queue = [[unverified]];
    sendVerificationEmail.mockResolvedValue({ sent: false, reason: "cooldown" });
    const res = await POST(req({ id: "u-1", action: "resend" }));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ success: true, sent: false, reason: "cooldown" });
  });

  it("resend on verified account => 409 already_verified", async () => {
    state.queue = [[{ ...unverified, emailVerifiedAt: new Date() }]];
    const res = await POST(req({ id: "u-1", action: "resend" }));
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ code: "already_verified" });
    expect(sendVerificationEmail).not.toHaveBeenCalled();
  });

  it("mark_verified calls markEmailVerified and returns 200", async () => {
    state.queue = [[unverified]];
    const res = await POST(req({ id: "u-1", action: "mark_verified" }));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ success: true });
    expect(markEmailVerified).toHaveBeenCalledWith("u-1");
  });

  it("unknown action => 400", async () => {
    const res = await POST(req({ id: "u-1", action: "nope" }));
    expect(res.status).toBe(400);
  });
});

describe("GET /api/admin/users", () => {
  it("selects emailVerifiedAt", async () => {
    state.queue = [[{ id: "u-1", emailVerifiedAt: null }]];
    const res = await GET();
    expect(res.status).toBe(200);
    expect(state.selectArg).toHaveProperty("emailVerifiedAt");
  });
});
