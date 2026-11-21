import { describe, it, expect, vi, beforeEach } from "vitest";

type MockDb = {
  select: ReturnType<typeof vi.fn>;
  from: ReturnType<typeof vi.fn>;
  where: ReturnType<typeof vi.fn>;
};

vi.mock("@/lib/db", () => ({
  db: {
    select: vi.fn().mockReturnThis(),
    from: vi.fn().mockReturnThis(),
    where: vi.fn(),
  },
}));

import { getOrgMemberIds } from "@/lib/org/org-members";
import { db } from "@/lib/db";

const mockDb = db as unknown as MockDb;

describe("getOrgMemberIds — cloisonnement des annuaires", () => {
  beforeEach(() => vi.clearAllMocks());

  it("retourne les identifiants des membres de l'organisation ciblée", async () => {
    mockDb.where.mockResolvedValueOnce([
      { userId: "u1" },
      { userId: "u2" },
    ]);
    const ids = await getOrgMemberIds("org-acme");
    expect(ids).toEqual(["u1", "u2"]);
    expect(mockDb.where).toHaveBeenCalledTimes(1);
  });

  it("retourne un tableau vide pour une org sans membre", async () => {
    mockDb.where.mockResolvedValueOnce([]);
    const ids = await getOrgMemberIds("org-vide");
    expect(ids).toEqual([]);
  });
});
