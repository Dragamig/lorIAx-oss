import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

const calls: string[] = [];
const txMock = {
  execute: vi.fn(async (q: unknown) => {
    const chunks = (q as { queryChunks?: unknown[] }).queryChunks ?? [];
    const text = chunks.map((c) => (typeof c === "string" ? c : [(c as { value?: string | string[] }).value ?? ""].flat().join(""))).join("");
    calls.push(text.includes("SET") && text.includes("created_by") ? "reassign" : "other");
  }),
  delete: vi.fn(() => ({ where: vi.fn(async () => { calls.push("delete-user"); }) })),
};
const selectChain = { from: () => ({ where: () => ({ limit: async () => [{ name: "X", email: "x@x.fr" }] }) }) };

vi.mock("@/lib/db", () => ({
  db: {
    select: () => selectChain,
    transaction: async (fn: (tx: unknown) => Promise<void>) => fn(txMock),
  },
}));
vi.mock("@/lib/auth", () => ({ clearAuthUserStateCache: vi.fn() }));
vi.mock("@/lib/auth/get-user", () => ({ getSessionUser: async () => ({ id: "admin", globalRole: "super_admin" }) }));
vi.mock("@/lib/auth/rbac", () => ({ hasGlobalRole: () => true }));
vi.mock("@/lib/org/get-request-org", () => ({ getRequestOrgId: async () => "org" }));
vi.mock("@/lib/org/org-members", () => ({ getOrgMemberIds: async () => ["victim"] }));
vi.mock("@/lib/databases/view-cleanup", () => ({
  deletePersonalViewsOf: vi.fn(async () => { calls.push("personal-views"); }),
}));
vi.mock("@/lib/email/send", () => ({ sendEmail: vi.fn() }));
vi.mock("@/lib/git/repository", () => ({ initRepository: vi.fn() }));
vi.mock("@/lib/calendar/auto-provision", () => ({ ensurePersonalCalendar: vi.fn() }));

import { DELETE } from "@/app/api/admin/users/route";
import { deletePersonalViewsOf } from "@/lib/databases/view-cleanup";

describe("DELETE /api/admin/users : vues personnelles", () => {
  beforeEach(() => { calls.length = 0; });

  it("supprime les vues personnelles dans la transaction, avant la réattribution et la suppression du compte", async () => {
    const res = await DELETE(new NextRequest("http://x/api/admin/users", { method: "DELETE", body: JSON.stringify({ id: "victim" }) }));
    expect(res.status).toBe(200);
    expect(deletePersonalViewsOf).toHaveBeenCalledWith(txMock, "victim");
    const iPersonal = calls.indexOf("personal-views");
    expect(iPersonal).toBeGreaterThanOrEqual(0);
    expect(iPersonal).toBeLessThan(calls.indexOf("reassign"));
    expect(calls.indexOf("reassign")).toBeLessThan(calls.indexOf("delete-user"));
  });
});
