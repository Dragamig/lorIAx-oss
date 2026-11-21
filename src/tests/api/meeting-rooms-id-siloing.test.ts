/**
 * Cloisonnement multi-tenant — /api/meeting-rooms/[id] (GET/PATCH/DELETE)
 *
 * Toutes les sous-routes salles confinent via getMeetingRoomForRequest : une
 * salle d'une autre org renvoie 404 (fail-closed), même pour un admin/facility
 * manager qui passe canManageRooms.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

const makeChainableMock = () => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const self: any = {
    update: vi.fn().mockReturnThis(),
    set: vi.fn().mockReturnThis(),
    where: vi.fn().mockReturnThis(),
    delete: vi.fn().mockReturnThis(),
    returning: vi.fn(() => Promise.resolve([{ id: "room-1" }])),
  };
  return self;
};

vi.mock("@/lib/auth/get-user", () => ({
  getSessionUser: vi.fn().mockResolvedValue({
    id: "admin-a", globalRole: "admin", capabilities: [],
  }),
}));

vi.mock("@/lib/meeting-rooms/guards", () => ({
  guardMeetingRoomsEnabled: vi.fn().mockResolvedValue(null),
}));

vi.mock("@/lib/meeting-rooms/scoped-room", () => ({
  getMeetingRoomForRequest: vi.fn(),
}));

vi.mock("@/lib/meeting-rooms/permissions", () => ({
  canManageRooms: vi.fn().mockReturnValue(true),
  canBookRoom: vi.fn().mockResolvedValue(true),
}));

vi.mock("@/lib/meeting-rooms/opening-hours", () => ({
  isValidOpeningHours: vi.fn().mockReturnValue(true),
}));

vi.mock("@/lib/db", () => ({ db: makeChainableMock() }));

import { getMeetingRoomForRequest } from "@/lib/meeting-rooms/scoped-room";
const mockRoom = vi.mocked(getMeetingRoomForRequest);

beforeEach(() => vi.clearAllMocks());

const ctx = (id: string) => ({ params: Promise.resolve({ id }) });

describe("/api/meeting-rooms/[id] — cloisonnement", () => {
  it("GET 404 si la salle relève d'une autre org", async () => {
    mockRoom.mockResolvedValue(null);
    const { GET } = await import("@/app/api/meeting-rooms/[id]/route");
    const res = await GET(new NextRequest("http://localhost/x") as never, ctx("room-1"));
    expect(res.status).toBe(404);
  });

  it("PATCH 404 si la salle relève d'une autre org (même admin)", async () => {
    mockRoom.mockResolvedValue(null);
    const { PATCH } = await import("@/app/api/meeting-rooms/[id]/route");
    const r = new NextRequest("http://localhost/x", { method: "PATCH", body: JSON.stringify({ name: "hack" }) });
    const res = await PATCH(r as never, ctx("room-1"));
    expect(res.status).toBe(404);
  });

  it("DELETE 404 si la salle relève d'une autre org (même admin)", async () => {
    mockRoom.mockResolvedValue(null);
    const { DELETE } = await import("@/app/api/meeting-rooms/[id]/route");
    const res = await DELETE(new NextRequest("http://localhost/x", { method: "DELETE" }) as never, ctx("room-1"));
    expect(res.status).toBe(404);
  });

  it("GET 200 si la salle appartient à l'org courante", async () => {
    mockRoom.mockResolvedValue({ id: "room-1", organizationId: "org-a" } as never);
    const { GET } = await import("@/app/api/meeting-rooms/[id]/route");
    const res = await GET(new NextRequest("http://localhost/x") as never, ctx("room-1"));
    expect(res.status).toBe(200);
  });
});
