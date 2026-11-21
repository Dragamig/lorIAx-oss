/**
 * Contrôle d'accès — POST /api/meet/rooms
 *
 * Le `documentId` du corps de la requête n'était jamais validé : le titre et le
 * slug d'un document arbitraire, potentiellement d'une autre organisation,
 * finissaient dans le titre auto-généré de la réunion (et la réunion restait
 * liée à ce document). L'accès en lecture est désormais vérifié via
 * checkDocumentViewAccess avant toute utilisation du document.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

let docRows: unknown[] = [];

const makeChainableMock = () => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const self: any = {
    select: vi.fn().mockReturnThis(),
    from: vi.fn().mockReturnThis(),
    where: vi.fn().mockReturnThis(),
    limit: vi.fn(() => Promise.resolve(docRows)),
  };
  return self;
};

vi.mock("@/lib/auth/get-user", () => ({
  getSessionUser: vi.fn().mockResolvedValue({
    id: "user-a",
    name: "User A",
    email: "a@org-a.com",
    globalRole: "admin",
  }),
}));

vi.mock("@/lib/rate-limit", () => ({
  // AZ-26 : variante asynchrone (compteur partagé). AZ-25 : `getClientIpOrNull`
  // rend une ABSENCE plutôt qu'une constante commune à tous les clients.
  checkRateLimitAsync: vi.fn(async () => ({ success: true })),
  getClientIpOrNull: vi.fn(() => "127.0.0.1"),
  RATE_LIMITS: { meet: { windowMs: 1000, max: 100 } },
}));

vi.mock("@/lib/org/get-request-org", () => ({
  getRequestOrgId: vi.fn().mockResolvedValue("org-a"),
}));

vi.mock("@/lib/meet/permissions", () => ({
  checkVisioPermission: vi.fn().mockResolvedValue(true),
}));

vi.mock("@/lib/meet/rooms", () => ({
  createMeeting: vi.fn().mockResolvedValue({ id: "meeting-1" }),
  generateAutoTitle: vi.fn().mockResolvedValue("2026-01-01_space_doc"),
  listMeetings: vi.fn().mockResolvedValue([]),
}));

vi.mock("@/lib/onboarding/progress", () => ({
  recordOnboardingEvent: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("@/lib/auth/check-access", () => ({
  checkDocumentViewAccess: vi.fn(),
}));

vi.mock("@/lib/db", () => ({ db: makeChainableMock() }));

import { checkDocumentViewAccess } from "@/lib/auth/check-access";
import { createMeeting, generateAutoTitle } from "@/lib/meet/rooms";

const mockAccess = vi.mocked(checkDocumentViewAccess);
const mockCreate = vi.mocked(createMeeting);
const mockTitle = vi.mocked(generateAutoTitle);

const SPACE_ID = "22222222-2222-4222-8222-222222222222";
const DOC_ID = "11111111-1111-4111-8111-111111111111";

const req = (body: Record<string, unknown>) =>
  new NextRequest("http://localhost/api/meet/rooms", {
    method: "POST",
    body: JSON.stringify(body),
    headers: { "content-type": "application/json" },
  });

beforeEach(() => {
  vi.clearAllMocks();
  docRows = [{ spaceId: "space-org-b" }];
  mockCreate.mockResolvedValue({ id: "meeting-1" } as never);
  mockTitle.mockResolvedValue("2026-01-01_space_doc");
});

describe("POST /api/meet/rooms — contrôle d'accès au documentId", () => {
  it("répond 403 et ne crée aucune réunion si le document n'est pas lisible", async () => {
    mockAccess.mockResolvedValue(false);
    const { POST } = await import("@/app/api/meet/rooms/route");
    const res = await POST(req({ spaceId: SPACE_ID, documentId: DOC_ID }));
    expect(res.status).toBe(403);
    expect(mockTitle).not.toHaveBeenCalled();
    expect(mockCreate).not.toHaveBeenCalled();
  });

  it("répond 404 si le document n'existe pas", async () => {
    docRows = [];
    mockAccess.mockResolvedValue(true);
    const { POST } = await import("@/app/api/meet/rooms/route");
    const res = await POST(req({ spaceId: SPACE_ID, documentId: DOC_ID }));
    expect(res.status).toBe(404);
    expect(mockCreate).not.toHaveBeenCalled();
  });

  it("crée la réunion quand le document est lisible", async () => {
    mockAccess.mockResolvedValue(true);
    const { POST } = await import("@/app/api/meet/rooms/route");
    const res = await POST(req({ spaceId: SPACE_ID, documentId: DOC_ID }));
    expect(res.status).toBe(201);
    expect(mockAccess).toHaveBeenCalledWith(
      expect.objectContaining({ id: "user-a" }),
      "space-org-b",
      DOC_ID
    );
    expect(mockCreate).toHaveBeenCalled();
  });

  it("ne vérifie rien de plus quand aucun documentId n'est fourni", async () => {
    const { POST } = await import("@/app/api/meet/rooms/route");
    const res = await POST(req({ spaceId: SPACE_ID }));
    expect(res.status).toBe(201);
    expect(mockAccess).not.toHaveBeenCalled();
  });
});
