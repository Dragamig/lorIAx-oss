/**
 * getMeetingRoomForRequest — brique de cloisonnement des salles de réunion.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

let selectResult: unknown[] = [];

function makeChainableMock() {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const self: any = {
    select: vi.fn().mockReturnThis(),
    from: vi.fn().mockReturnThis(),
    where: vi.fn().mockReturnThis(),
    limit: vi.fn(() => Promise.resolve(selectResult)),
  };
  return self;
}

vi.mock("@/lib/org/get-request-org", () => ({
  getRequestOrgId: vi.fn(),
}));

vi.mock("@/lib/db", () => ({ db: makeChainableMock() }));

import { getMeetingRoomForRequest } from "./scoped-room";
import { getRequestOrgId } from "@/lib/org/get-request-org";
import { db } from "@/lib/db";

const mockOrg = vi.mocked(getRequestOrgId);
const user = { id: "u", globalRole: "admin" };

beforeEach(() => {
  vi.clearAllMocks();
  selectResult = [];
});

describe("getMeetingRoomForRequest", () => {
  it("retourne null sans requêter si l'org n'est pas résolue (fail-closed)", async () => {
    mockOrg.mockResolvedValue(null);
    const room = await getMeetingRoomForRequest("room-1", user);
    expect(room).toBeNull();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect((db as any).select).not.toHaveBeenCalled();
  });

  it("retourne la salle si elle appartient à l'org courante", async () => {
    mockOrg.mockResolvedValue("org-a");
    selectResult = [{ id: "room-1", organizationId: "org-a" }];
    const room = await getMeetingRoomForRequest("room-1", user);
    expect(room).toEqual({ id: "room-1", organizationId: "org-a" });
    expect(mockOrg).toHaveBeenCalledWith(user);
  });

  it("retourne null si aucune salle ne matche (autre org → filtre SQL)", async () => {
    mockOrg.mockResolvedValue("org-a");
    selectResult = [];
    const room = await getMeetingRoomForRequest("room-of-org-b", user);
    expect(room).toBeNull();
  });
});
