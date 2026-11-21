import { describe, it, expect, vi, beforeEach } from "vitest";

const getSpacePermission = vi.fn();
vi.mock("@/lib/auth/check-access", () => ({
  getSpacePermission: (...a: unknown[]) => getSpacePermission(...a),
}));
vi.mock("@/lib/db", () => ({ db: {} }));

import { makeCanView } from "@/lib/databases/row-eligibility";

describe("makeCanView", () => {
  beforeEach(() => getSpacePermission.mockReset());

  it("met en cache : un seul appel par utilisateur", async () => {
    getSpacePermission.mockResolvedValue("viewer");
    const canView = makeCanView("space-1");
    expect(await canView("u1")).toBe(true);
    expect(await canView("u1")).toBe(true);
    expect(getSpacePermission).toHaveBeenCalledTimes(1);
    expect(getSpacePermission).toHaveBeenCalledWith("u1", "space-1");
  });

  it("permission nulle : faux", async () => {
    getSpacePermission.mockResolvedValue(null);
    expect(await makeCanView("space-1")("u2")).toBe(false);
  });
});
