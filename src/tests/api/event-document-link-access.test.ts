/**
 * Contrôle d'accès — rattachement d'un document à un événement d'agenda
 *
 * PATCH /api/events/[id] et POST /api/calendars/[id]/events acceptaient un
 * `documentId` fourni par le client et le stockaient tel quel : il suffisait
 * d'un droit d'écriture sur un calendrier pour lier (et exposer via l'UI) un
 * document d'un autre espace ou d'une autre organisation. Les deux routes
 * exigent désormais checkDocumentViewAccess sur le document lié.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

let eventRows: unknown[] = [];
let docRows: unknown[] = [];
const returning = vi.fn(() => Promise.resolve([{ id: "event-1" }]));

const makeChainableMock = () => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const self: any = {
    then: (resolve: (v: unknown[]) => void, reject?: (e: unknown) => void) =>
      Promise.resolve(eventRows).then(resolve, reject),
    select: vi.fn().mockReturnThis(),
    from: vi.fn().mockReturnThis(),
    where: vi.fn().mockReturnThis(),
    limit: vi.fn(() => Promise.resolve(docRows)),
    update: vi.fn().mockReturnThis(),
    insert: vi.fn().mockReturnThis(),
    values: vi.fn().mockReturnThis(),
    set: vi.fn().mockReturnThis(),
    returning,
  };
  return self;
};

vi.mock("@/lib/auth/get-user", () => ({
  getSessionUser: vi.fn().mockResolvedValue({
    id: "user-a",
    name: "User A",
    email: "a@org-a.com",
    globalRole: "user",
  }),
}));

// Ces routes résolvent désormais l'organisation de la requête avant tout
// contrôle de calendrier (`checkCalendarAccess` la reçoit en paramètre
// obligatoire). Le contexte de requête Next n'existe pas ici : on rend une
// organisation fixe, la décision testée restant celle du mock de permission.
vi.mock("@/lib/org/get-request-org", () => ({
  getRequestOrgId: vi.fn().mockResolvedValue("org-test"),
}));

vi.mock("@/lib/calendar/permissions", () => ({
  checkCalendarAccess: vi.fn().mockResolvedValue(true),
}));

vi.mock("@/lib/auth/check-access", () => ({
  checkDocumentViewAccess: vi.fn(),
}));

vi.mock("@/lib/tasks/notify-task-assigned", () => ({
  notifyTaskAssigned: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("@/lib/onboarding/progress", () => ({
  recordOnboardingEvent: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("@/lib/calendar/recurrence", () => ({
  expandRecurrence: vi.fn(() => []),
}));

vi.mock("@/lib/db", () => ({ db: makeChainableMock() }));

import { checkDocumentViewAccess } from "@/lib/auth/check-access";

const mockView = vi.mocked(checkDocumentViewAccess);

const DOC_ID = "11111111-1111-4111-8111-111111111111";
const CAL_ID = "22222222-2222-4222-8222-222222222222";

beforeEach(() => {
  vi.clearAllMocks();
  eventRows = [{ id: "event-1", calendarId: CAL_ID, title: "Réunion", sequence: 1 }];
  docRows = [{ spaceId: "space-autre" }];
  returning.mockResolvedValue([{ id: "event-1" }] as never);
});

const patchReq = (body: unknown) =>
  new Request("http://localhost/api/events/event-1", {
    method: "PATCH",
    body: JSON.stringify(body),
    headers: { "content-type": "application/json" },
  });

const patchCtx = { params: Promise.resolve({ id: "event-1" }) };

describe("PATCH /api/events/[id] — documentId fourni par le client", () => {
  it("répond 403 quand l'utilisateur n'a pas accès au document lié", async () => {
    mockView.mockResolvedValue(false);
    const { PATCH } = await import("@/app/api/events/[id]/route");
    const res = await PATCH(patchReq({ documentId: DOC_ID }), patchCtx);
    expect(res.status).toBe(403);
    expect(returning).not.toHaveBeenCalled();
  });

  it("répond 404 quand le document lié n'existe pas", async () => {
    docRows = [];
    mockView.mockResolvedValue(true);
    const { PATCH } = await import("@/app/api/events/[id]/route");
    const res = await PATCH(patchReq({ documentId: DOC_ID }), patchCtx);
    expect(res.status).toBe(404);
    expect(mockView).not.toHaveBeenCalled();
  });

  it("enregistre le lien quand l'accès en lecture est accordé", async () => {
    mockView.mockResolvedValue(true);
    const { PATCH } = await import("@/app/api/events/[id]/route");
    const res = await PATCH(patchReq({ documentId: DOC_ID }), patchCtx);
    expect(res.status).toBe(200);
    expect(mockView).toHaveBeenCalledWith(
      expect.objectContaining({ id: "user-a" }),
      "space-autre",
      DOC_ID
    );
  });

  it("ne vérifie aucun document quand documentId n'est pas fourni", async () => {
    const { PATCH } = await import("@/app/api/events/[id]/route");
    const res = await PATCH(patchReq({ title: "Nouveau titre" }), patchCtx);
    expect(res.status).toBe(200);
    expect(mockView).not.toHaveBeenCalled();
  });

  it("accepte le détachement explicite (documentId null) sans contrôle", async () => {
    const { PATCH } = await import("@/app/api/events/[id]/route");
    const res = await PATCH(patchReq({ documentId: null }), patchCtx);
    expect(res.status).toBe(200);
    expect(mockView).not.toHaveBeenCalled();
  });
});

const createBody = (extra: Record<string, unknown>) => ({
  title: "Réunion",
  startAt: "2026-08-17T10:00:00.000Z",
  endAt: "2026-08-17T11:00:00.000Z",
  ...extra,
});

const postReq = (body: unknown) =>
  new Request(`http://localhost/api/calendars/${CAL_ID}/events`, {
    method: "POST",
    body: JSON.stringify(body),
    headers: { "content-type": "application/json" },
  });

const postCtx = { params: Promise.resolve({ id: CAL_ID }) };

describe("POST /api/calendars/[id]/events — documentId fourni par le client", () => {
  it("répond 403 quand l'utilisateur n'a pas accès au document lié", async () => {
    mockView.mockResolvedValue(false);
    const { POST } = await import("@/app/api/calendars/[id]/events/route");
    const res = await POST(postReq(createBody({ documentId: DOC_ID })), postCtx);
    expect(res.status).toBe(403);
    expect(returning).not.toHaveBeenCalled();
  });

  it("répond 404 quand le document lié n'existe pas", async () => {
    docRows = [];
    mockView.mockResolvedValue(true);
    const { POST } = await import("@/app/api/calendars/[id]/events/route");
    const res = await POST(postReq(createBody({ documentId: DOC_ID })), postCtx);
    expect(res.status).toBe(404);
    expect(mockView).not.toHaveBeenCalled();
  });

  it("crée l'événement quand l'accès en lecture est accordé", async () => {
    mockView.mockResolvedValue(true);
    const { POST } = await import("@/app/api/calendars/[id]/events/route");
    const res = await POST(postReq(createBody({ documentId: DOC_ID })), postCtx);
    expect(res.status).toBe(201);
    expect(mockView).toHaveBeenCalledWith(
      expect.objectContaining({ id: "user-a" }),
      "space-autre",
      DOC_ID
    );
  });
});
