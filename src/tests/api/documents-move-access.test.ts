/**
 * Contrôle d'accès — POST /api/documents/[id]/move
 *
 * La route s'appuyait sur getSpacePermission seul (aucun filtre d'organisation,
 * "admin" rendu à tout admin global) : un admin de l'org A pouvait déplacer un
 * document de l'org B, ou l'aspirer vers un espace de sa propre org. Le contrôle
 * passe désormais par checkDocumentEditAccess (source) et checkSpaceWriteAccess
 * (destination), qui incluent le cloisonnement multi-tenant.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

let docRows: unknown[] = [];
let targetSpaceRows: unknown[] = [];
let selectCall = 0;

const updateMock = vi.fn();

const makeChainableMock = () => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const self: any = {
    select: vi.fn(() => {
      selectCall += 1;
      return self;
    }),
    from: vi.fn().mockReturnThis(),
    limit: vi.fn(() => Promise.resolve(selectCall === 1 ? docRows : targetSpaceRows)),
    update: vi.fn(() => {
      updateMock();
      return self;
    }),
    set: vi.fn().mockReturnThis(),
    where: vi.fn(() => self),
    then: (resolve: (v: unknown) => void, reject?: (e: unknown) => void) =>
      Promise.resolve(undefined).then(resolve, reject),
  };
  return self;
};

vi.mock("@/lib/auth/get-user", () => ({
  getSessionUser: vi.fn().mockResolvedValue({
    id: "admin-a",
    name: "Admin A",
    email: "admin@org-a.com",
    globalRole: "admin",
  }),
}));

vi.mock("@/lib/auth/check-access", () => ({
  checkDocumentEditAccess: vi.fn(),
  checkSpaceWriteAccess: vi.fn(),
}));

vi.mock("@/lib/db", () => ({ db: makeChainableMock() }));

import { checkDocumentEditAccess, checkSpaceWriteAccess } from "@/lib/auth/check-access";

const mockEdit = vi.mocked(checkDocumentEditAccess);
const mockWrite = vi.mocked(checkSpaceWriteAccess);

const req = () =>
  new NextRequest("http://localhost/api/documents/doc-1/move", {
    method: "POST",
    body: JSON.stringify({ targetSpaceSlug: "espace-cible" }),
    headers: { "content-type": "application/json" },
  });

const ctx = (id: string) => ({ params: Promise.resolve({ id }) });

beforeEach(() => {
  vi.clearAllMocks();
  selectCall = 0;
  docRows = [{ id: "doc-1", title: "Doc secret", spaceId: "space-org-b", isFolder: false }];
  targetSpaceRows = [{ id: "space-cible", slug: "espace-cible" }];
});

describe("POST /api/documents/[id]/move — contrôle d'accès", () => {
  it("répond 403 et ne déplace rien si l'écriture sur le document source est refusée", async () => {
    mockEdit.mockResolvedValue(false);
    mockWrite.mockResolvedValue(true);
    const { POST } = await import("@/app/api/documents/[id]/move/route");
    const res = await POST(req(), ctx("doc-1"));
    expect(res.status).toBe(403);
    expect(updateMock).not.toHaveBeenCalled();
  });

  it("répond 403 et ne déplace rien si l'espace de destination est hors de portée", async () => {
    mockEdit.mockResolvedValue(true);
    mockWrite.mockResolvedValue(false);
    const { POST } = await import("@/app/api/documents/[id]/move/route");
    const res = await POST(req(), ctx("doc-1"));
    expect(res.status).toBe(403);
    expect(updateMock).not.toHaveBeenCalled();
  });

  it("déplace le document quand source et destination sont autorisées", async () => {
    mockEdit.mockResolvedValue(true);
    mockWrite.mockResolvedValue(true);
    const { POST } = await import("@/app/api/documents/[id]/move/route");
    const res = await POST(req(), ctx("doc-1"));
    expect(res.status).toBe(200);
    expect(mockEdit).toHaveBeenCalledWith(
      expect.objectContaining({ id: "admin-a" }),
      "space-org-b",
      "doc-1"
    );
    expect(mockWrite).toHaveBeenCalledWith(
      expect.objectContaining({ id: "admin-a" }),
      "space-cible"
    );
    expect(updateMock).toHaveBeenCalled();
  });
});
