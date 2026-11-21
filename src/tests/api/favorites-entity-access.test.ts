/**
 * Contrôle d'accès — POST /api/favorites
 *
 * La route stockait l'`entityId` fourni par le client sans aucune vérification.
 * Le GET filtrait bien documents, espaces, modèles et réunions, mais pas les
 * événements d'agenda : un UUID forgé suffisait à faire résoudre le titre et la
 * date d'un événement d'une autre organisation. Le POST vérifie désormais
 * l'accès à l'entité, et le GET filtre aussi les événements par calendrier.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

let results: unknown[][] = [];
let idx = 0;

const returning = vi.fn(() => Promise.resolve([{ id: "fav-1" }]));

const makeChainableMock = () => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const self: any = {
    select: vi.fn(() => {
      idx += 1;
      return self;
    }),
    from: vi.fn().mockReturnThis(),
    innerJoin: vi.fn().mockReturnThis(),
    where: vi.fn().mockReturnThis(),
    orderBy: vi.fn().mockReturnThis(),
    limit: vi.fn(() => Promise.resolve(results[idx - 1] ?? [])),
    then: (resolve: (v: unknown[]) => void, reject?: (e: unknown) => void) =>
      Promise.resolve(results[idx - 1] ?? []).then(resolve, reject),
    insert: vi.fn().mockReturnThis(),
    values: vi.fn().mockReturnThis(),
    onConflictDoNothing: vi.fn().mockReturnThis(),
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

vi.mock("@/lib/auth/check-access", () => ({
  getAccessibleSpaceIds: vi.fn().mockResolvedValue([]),
  checkDocumentViewAccess: vi.fn(),
  checkSpaceReadAccess: vi.fn(),
}));

// Ces routes résolvent désormais l'organisation de la requête avant tout
// contrôle de calendrier (`checkCalendarAccess` la reçoit en paramètre
// obligatoire). Le contexte de requête Next n'existe pas ici : on rend une
// organisation fixe, la décision testée restant celle du mock de permission.
vi.mock("@/lib/org/get-request-org", () => ({
  getRequestOrgId: vi.fn().mockResolvedValue("org-test"),
}));

vi.mock("@/lib/calendar/permissions", () => ({
  checkCalendarAccess: vi.fn(),
}));

vi.mock("@/lib/db", () => ({ db: makeChainableMock() }));

import {
  checkDocumentViewAccess,
  checkSpaceReadAccess,
} from "@/lib/auth/check-access";
import { checkCalendarAccess } from "@/lib/calendar/permissions";

const mockDocView = vi.mocked(checkDocumentViewAccess);
const mockSpaceRead = vi.mocked(checkSpaceReadAccess);
const mockCalendarAccess = vi.mocked(checkCalendarAccess);

const DOC_ID = "11111111-1111-4111-8111-111111111111";
const EVENT_ID = "55555555-5555-4555-8555-555555555555";

beforeEach(() => {
  vi.clearAllMocks();
  results = [];
  idx = 0;
  returning.mockResolvedValue([{ id: "fav-1" }] as never);
});

const postReq = (body: unknown) =>
  new NextRequest("http://localhost/api/favorites", {
    method: "POST",
    body: JSON.stringify(body),
    headers: { "content-type": "application/json" },
  });

describe("POST /api/favorites — entityId fourni par le client", () => {
  it("rejette un entityId qui n'est pas un UUID", async () => {
    const { POST } = await import("@/app/api/favorites/route");
    const res = await POST(postReq({ entityType: "document", entityId: "x" }));
    expect(res.status).toBe(400);
    expect(returning).not.toHaveBeenCalled();
  });

  it("répond 404 quand le document n'existe pas", async () => {
    results = [[]];
    const { POST } = await import("@/app/api/favorites/route");
    const res = await POST(
      postReq({ entityType: "document", entityId: DOC_ID })
    );
    expect(res.status).toBe(404);
    expect(mockDocView).not.toHaveBeenCalled();
    expect(returning).not.toHaveBeenCalled();
  });

  it("répond 403 quand le document appartient à un espace inaccessible", async () => {
    results = [[{ spaceId: "space-autre" }]];
    mockDocView.mockResolvedValue(false);
    const { POST } = await import("@/app/api/favorites/route");
    const res = await POST(
      postReq({ entityType: "document", entityId: DOC_ID })
    );
    expect(res.status).toBe(403);
    expect(mockDocView).toHaveBeenCalledWith(
      expect.objectContaining({ id: "user-a" }),
      "space-autre",
      DOC_ID
    );
    expect(returning).not.toHaveBeenCalled();
  });

  it("enregistre le favori quand l'accès au document est accordé", async () => {
    results = [[{ spaceId: "space-a" }], [{ maxPos: 2 }]];
    mockDocView.mockResolvedValue(true);
    const { POST } = await import("@/app/api/favorites/route");
    const res = await POST(
      postReq({ entityType: "document", entityId: DOC_ID })
    );
    expect(res.status).toBe(201);
    expect(returning).toHaveBeenCalled();
  });

  it("répond 403 quand l'événement d'agenda vit dans un calendrier inaccessible", async () => {
    results = [[{ calendarId: "cal-autre" }]];
    mockCalendarAccess.mockResolvedValue(false);
    const { POST } = await import("@/app/api/favorites/route");
    const res = await POST(
      postReq({ entityType: "calendar_event", entityId: EVENT_ID })
    );
    expect(res.status).toBe(403);
    expect(mockCalendarAccess).toHaveBeenCalledWith(
      "user-a",
      "cal-autre",
      "read",
      "org-test"
    );
    expect(returning).not.toHaveBeenCalled();
  });

  it("répond 403 quand l'espace visé est inaccessible", async () => {
    results = [[{ id: "space-autre" }]];
    mockSpaceRead.mockResolvedValue(false);
    const { POST } = await import("@/app/api/favorites/route");
    const res = await POST(
      postReq({ entityType: "space", entityId: DOC_ID })
    );
    expect(res.status).toBe(403);
    expect(returning).not.toHaveBeenCalled();
  });
});

describe("GET /api/favorites : favoris de type base", () => {
  const BASE_OK = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
  const BASE_AUTRE = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
  const BASE_SUPPR = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";

  it("résout la base accessible, exclut espace inaccessible/autre org et base supprimée", async () => {
    const { getAccessibleSpaceIds } = await import("@/lib/auth/check-access");
    vi.mocked(getAccessibleSpaceIds).mockResolvedValue(["space-ok"]);
    results = [
      [
        { id: "f1", entityType: "database", entityId: BASE_OK, position: 0 },
        { id: "f2", entityType: "database", entityId: BASE_AUTRE, position: 1 },
        { id: "f3", entityType: "database", entityId: BASE_SUPPR, position: 2 },
      ],
      // La requête filtre deletedAt : la base supprimée n'est pas renvoyée.
      [
        { id: BASE_OK, name: "Clients", spaceId: "space-ok" },
        { id: BASE_AUTRE, name: "Secrète", spaceId: "space-autre-org" },
      ],
    ];
    const { GET } = await import("@/app/api/favorites/route");
    const res = await GET();
    const body = await res.json();
    expect(body).toHaveLength(1);
    expect(body[0]).toMatchObject({
      id: "f1",
      entityType: "database",
      label: "Clients",
      title: "Clients",
      href: `/bases/${BASE_OK}`,
      badge: "Base",
    });
  });
});
