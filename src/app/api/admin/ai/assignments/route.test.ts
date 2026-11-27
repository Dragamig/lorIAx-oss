import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

const getSessionUser = vi.fn();
const deleteWhere = vi.fn();

vi.mock("@/lib/auth/get-user", () => ({ getSessionUser: () => getSessionUser() }));
vi.mock("@/lib/db", () => ({
  db: { delete: () => ({ where: (...a: unknown[]) => deleteWhere(...a) }) },
}));

vi.mock("@/lib/db/schema-ai", () => ({
  aiModelAssignments: { usageType: "usageType" },
  aiUsageTypeEnum: { enumValues: ["chat", "creation"] },
}));
vi.mock("drizzle-orm", () => ({ eq: (...a: unknown[]) => a }));

import { DELETE } from "./route";

const mk = (usageType?: string) =>
  new NextRequest(
    `http://x/api/admin/ai/assignments${usageType ? `?usageType=${usageType}` : ""}`,
    { method: "DELETE" },
  );

beforeEach(() => {
  vi.clearAllMocks();
  getSessionUser.mockResolvedValue({ id: "u1", globalRole: "super_admin" });
});

describe("DELETE /api/admin/ai/assignments", () => {
  it("400 sur un usage inconnu, sans suppression", async () => {
    expect((await DELETE(mk("bogus"))).status).toBe(400);
    expect(deleteWhere).not.toHaveBeenCalled();
  });

  it("400 sans usageType", async () => {
    expect((await DELETE(mk())).status).toBe(400);
  });

  it("403 pour un admin non super_admin", async () => {
    getSessionUser.mockResolvedValue({ id: "u2", globalRole: "admin" });
    expect((await DELETE(mk("chat"))).status).toBe(403);
    expect(deleteWhere).not.toHaveBeenCalled();
  });

  it("200 pour un usage valide", async () => {
    const res = await DELETE(mk("chat"));
    expect(res.status).toBe(200);
    expect(deleteWhere).toHaveBeenCalledTimes(1);
  });
});
