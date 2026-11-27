import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

const h = vi.hoisted(() => ({ cancel: vi.fn(), visible: vi.fn() }));
vi.mock("@/lib/crm/access", () => ({
  requireCrm: async () => ({ ok: true, user: { id: "u1" }, orgId: "org1", isAdmin: false, enabled: true }),
}));
vi.mock("@/lib/mailing/outbox", () => ({ cancelScheduled: (...a: unknown[]) => h.cancel(...a) }));
vi.mock("@/lib/mailing/threads", () => ({ getVisibleMail: (...a: unknown[]) => h.visible(...a) }));

import { POST } from "./route";

const ID = "44444444-4444-4444-8444-444444444444";
const call = (id = ID) =>
  POST(new NextRequest(`http://x/api/mail/messages/${id}/cancel`, { method: "POST" }), { params: Promise.resolve({ id }) });

beforeEach(() => {
  h.cancel.mockReset();
  h.visible.mockReset();
});

describe("POST /api/mail/messages/[id]/cancel", () => {
  it("cancels with the session org and user", async () => {
    h.cancel.mockResolvedValue(true);
    expect((await call()).status).toBe(200);
    expect(h.cancel).toHaveBeenCalledWith("org1", "u1", ID);
  });
  it("returns 404 for another user's mail (not visible)", async () => {
    h.cancel.mockResolvedValue(false);
    h.visible.mockResolvedValue(null);
    expect((await call()).status).toBe(404);
    expect(h.visible).toHaveBeenCalledWith("org1", "u1", ID);
  });
  it("returns 409 after the send started", async () => {
    h.cancel.mockResolvedValue(false);
    h.visible.mockResolvedValue({ id: ID, status: "sending" });
    const res = await call();
    expect(res.status).toBe(409);
    expect((await res.json()).code).toBe("already_sent");
  });
  it("returns 404 on a malformed id", async () => {
    expect((await call("zzz")).status).toBe(404);
    expect(h.cancel).not.toHaveBeenCalled();
  });
});
