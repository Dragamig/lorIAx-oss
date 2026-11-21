/**
 * Journal d'activité des actions de réunion : succès et refus tracés,
 * et un échec du journal ne fait jamais échouer l'action.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

const h = vi.hoisted(() => ({
  user: { id: "u1", globalRole: "member" } as { id: string; globalRole: string },
  meeting: { id: "m1", roomName: "room", createdBy: "u1", spaceId: null, status: "scheduled", egressId: null, title: "T" } as Record<string, unknown>,
  allowed: true,
}));

vi.mock("@/lib/activity", () => ({ logActivity: vi.fn() }));
vi.mock("@/lib/auth/get-user", () => ({ getSessionUser: vi.fn(async () => h.user) }));
vi.mock("@/lib/org/get-request-org", () => ({ getRequestOrgId: vi.fn(async () => "org-1") }));
vi.mock("@/lib/auth/check-access", () => ({ getSpacePermission: vi.fn(async () => null) }));
vi.mock("@/lib/db", () => ({ db: {} }));
vi.mock("@/lib/meet/egress", () => ({ startRecording: vi.fn(async () => "egress-1"), stopRecording: vi.fn() }));
vi.mock("@/lib/meet/rooms", () => ({
  getMeetingInOrg: vi.fn(async () => h.meeting),
  getMeetingUnscoped: vi.fn(async () => null),
  getMeetingParticipants: vi.fn(async () => []),
  updateMeetingTitle: vi.fn(),
  deleteMeeting: vi.fn(async () => undefined),
  canAccessMeeting: vi.fn(async () => h.allowed),
  updateMeetingStatus: vi.fn(async () => ({ status: "active" })),
}));

import { logActivity } from "@/lib/activity";
const log = vi.mocked(logActivity);
const ctx = { params: Promise.resolve({ id: "m1" }) };
const req = () => new NextRequest("http://localhost/x", { method: "POST" });

beforeEach(() => {
  vi.clearAllMocks();
  h.user = { id: "u1", globalRole: "member" };
  h.meeting = { id: "m1", roomName: "room", createdBy: "u1", spaceId: null, status: "scheduled", egressId: null, title: "T" };
  h.allowed = true;
});

const expectLogged = (action: string) =>
  expect(log).toHaveBeenCalledWith(
    expect.objectContaining({ action, entityType: "meeting", entityId: "m1", userId: "u1" }),
  );

describe("journal d'activité des réunions", () => {
  it("activation tracée, refus tracé", async () => {
    const { POST } = await import("@/app/api/meet/rooms/[id]/activate/route");
    expect((await POST(req(), ctx)).status).toBe(200);
    expectLogged("meeting.activate");
    log.mockClear();
    h.meeting.createdBy = "autre";
    expect((await POST(req(), ctx)).status).toBe(403);
    expectLogged("meeting.activate_denied");
  });

  it("fin tracée, refus tracé", async () => {
    const { POST } = await import("@/app/api/meet/rooms/[id]/end/route");
    h.meeting.createdBy = "autre";
    expect((await POST(req(), ctx)).status).toBe(403);
    expectLogged("meeting.end_denied");
    log.mockClear();
    h.meeting.createdBy = "u1";
    expect((await POST(req(), ctx)).status).toBe(200);
    expectLogged("meeting.end");
  });

  it("démarrage d'enregistrement tracé, refus tracé", async () => {
    const { POST } = await import("@/app/api/meet/rooms/[id]/start-recording/route");
    h.allowed = false;
    expect((await POST(req(), ctx)).status).toBe(403);
    expectLogged("meeting.recording_start_denied");
    log.mockClear();
    h.allowed = true;
    h.meeting.status = "active";
    expect((await POST(req(), ctx)).status).toBe(200);
    expectLogged("meeting.recording_start");
  });

  it("suppression et modification : succès et refus tracés", async () => {
    const { DELETE, PATCH } = await import("@/app/api/meet/rooms/[id]/route");
    expect((await DELETE(req(), ctx)).status).toBe(200);
    expectLogged("meeting.delete");
    log.mockClear();
    h.meeting.createdBy = "autre";
    expect((await DELETE(req(), ctx)).status).toBe(403);
    expectLogged("meeting.delete_denied");
    log.mockClear();
    expect((await PATCH(req(), ctx)).status).toBe(403);
    expectLogged("meeting.update_denied");
  });

  it("ne met aucune donnée sensible dans les métadonnées", async () => {
    const { POST } = await import("@/app/api/meet/rooms/[id]/start-recording/route");
    h.meeting.status = "active";
    await POST(req(), ctx);
    const meta = JSON.stringify(log.mock.calls[0][0].metadata ?? {});
    expect(meta).not.toMatch(/token|secret/i);
  });
});
