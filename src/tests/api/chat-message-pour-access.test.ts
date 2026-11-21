/**
 * Contrôle d'accès — POST /api/chat/messages/[id]/pour
 *
 * La permission était lue directement dans spacePermissions, sans filtre
 * d'organisation ni contrôle de classification du document. Le contrôle passe
 * désormais par checkDocumentViewAccess (org + classification) puis
 * checkDocumentEditAccess (droit d'écriture).
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

let messageRows: unknown[] = [];
let membershipRows: unknown[] = [];
let docRows: unknown[] = [];
let selectCall = 0;
const updateWhere = vi.fn(() => Promise.resolve([]));

const makeChainableMock = () => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const self: any = {
    select: vi.fn(() => {
      selectCall += 1;
      return self;
    }),
    from: vi.fn().mockReturnThis(),
    where: vi.fn().mockReturnThis(),
    limit: vi.fn(() =>
      Promise.resolve(
        selectCall === 1 ? messageRows : selectCall === 2 ? membershipRows : docRows
      )
    ),
    update: vi.fn(() => ({ set: vi.fn(() => ({ where: updateWhere })) })),
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
  checkDocumentViewAccess: vi.fn(),
  checkDocumentEditAccess: vi.fn(),
}));

vi.mock("@/lib/db", () => ({ db: makeChainableMock() }));

import {
  checkDocumentViewAccess,
  checkDocumentEditAccess,
} from "@/lib/auth/check-access";

const mockView = vi.mocked(checkDocumentViewAccess);
const mockEdit = vi.mocked(checkDocumentEditAccess);

const DOC_ID = "11111111-1111-4111-8111-111111111111";

const req = () =>
  new NextRequest("http://localhost/api/chat/messages/msg-1/pour", {
    method: "POST",
    body: JSON.stringify({ documentId: DOC_ID }),
    headers: { "content-type": "application/json" },
  });

const ctx = { params: Promise.resolve({ id: "msg-1" }) };

beforeEach(() => {
  vi.clearAllMocks();
  selectCall = 0;
  messageRows = [
    {
      id: "msg-1",
      channelId: "chan-1",
      authorId: "user-b",
      content: "Bonjour",
      createdAt: new Date("2026-08-17T10:00:00.000Z"),
      deletedAt: null,
    },
  ];
  membershipRows = [{ channelId: "chan-1", userId: "user-a" }];
  docRows = [{ spaceId: "space-autre" }];
});

describe("POST /api/chat/messages/[id]/pour — contrôle d'accès document", () => {
  it("répond 403 si l'accès en lecture au document est refusé", async () => {
    mockView.mockResolvedValue(false);
    mockEdit.mockResolvedValue(true);
    const { POST } = await import("@/app/api/chat/messages/[id]/pour/route");
    const res = await POST(req(), ctx);
    expect(res.status).toBe(403);
    expect(updateWhere).not.toHaveBeenCalled();
  });

  it("répond 403 si l'utilisateur n'a pas le droit d'écriture sur le document", async () => {
    mockView.mockResolvedValue(true);
    mockEdit.mockResolvedValue(false);
    const { POST } = await import("@/app/api/chat/messages/[id]/pour/route");
    const res = await POST(req(), ctx);
    expect(res.status).toBe(403);
    expect(updateWhere).not.toHaveBeenCalled();
  });

  it("verse le message quand lecture et écriture sont accordées", async () => {
    mockView.mockResolvedValue(true);
    mockEdit.mockResolvedValue(true);
    const { POST } = await import("@/app/api/chat/messages/[id]/pour/route");
    const res = await POST(req(), ctx);
    expect(res.status).toBe(200);
    expect(mockView).toHaveBeenCalledWith(
      expect.objectContaining({ id: "user-a" }),
      "space-autre",
      DOC_ID
    );
    expect(updateWhere).toHaveBeenCalled();
  });
});
