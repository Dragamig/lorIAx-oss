/**
 * Contrôle d'accès — POST /api/tasks/sync-document et POST /api/tasks/unassign
 *
 * Ces deux routes HTTP utilisaient `checkDocumentEditAccess` importé de
 * `@/lib/collab/auth-ws` : un homonyme du helper sûr, sans cloisonnement
 * multi-tenant et avec bypass admin inconditionnel. Elles doivent désormais
 * passer par `checkDocumentEditAccess` de `@/lib/auth/check-access`, appelé
 * avec le spaceId du document.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

let docRows: unknown[] = [];

const makeChainableMock = () => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const self: any = {
    select: vi.fn().mockReturnThis(),
    from: vi.fn().mockReturnThis(),
    where: vi.fn(() => self),
    limit: vi.fn(() => Promise.resolve(docRows)),
    update: vi.fn().mockReturnThis(),
    set: vi.fn().mockReturnThis(),
  };
  // `update().set().where()` doit être awaitable
  self.where = vi.fn(() => {
    const r = Object.create(self);
    r.then = (res: (v: unknown) => void) => Promise.resolve(undefined).then(res);
    return r;
  });
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

vi.mock("@/lib/auth/check-access", () => ({
  checkDocumentEditAccess: vi.fn(),
}));

vi.mock("@/lib/collab/auth-ws", () => ({
  checkCollabDocumentEditAccess: vi.fn().mockResolvedValue(true),
}));

vi.mock("@/lib/tasks/sync-document-tasks", () => ({
  syncDocumentTasks: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("@/lib/db", () => ({ db: makeChainableMock() }));

import { checkDocumentEditAccess } from "@/lib/auth/check-access";
import { syncDocumentTasks } from "@/lib/tasks/sync-document-tasks";

const mockAccess = vi.mocked(checkDocumentEditAccess);
const mockSync = vi.mocked(syncDocumentTasks);

const DOC_ID = "11111111-1111-4111-8111-111111111111";

const syncReq = () =>
  new NextRequest("http://localhost/api/tasks/sync-document", {
    method: "POST",
    body: JSON.stringify({ documentId: DOC_ID, content: { type: "doc" } }),
    headers: { "content-type": "application/json" },
  });

const unassignReq = () =>
  new NextRequest("http://localhost/api/tasks/unassign", {
    method: "POST",
    body: JSON.stringify({ documentId: DOC_ID, nodeId: "node-1" }),
    headers: { "content-type": "application/json" },
  });

beforeEach(() => {
  vi.clearAllMocks();
  docRows = [{ spaceId: "space-org-b" }];
});

describe("POST /api/tasks/sync-document — contrôle d'accès", () => {
  it("répond 403 et ne synchronise rien si l'accès en écriture est refusé", async () => {
    mockAccess.mockResolvedValue(false);
    const { POST } = await import("@/app/api/tasks/sync-document/route");
    const res = await POST(syncReq());
    expect(res.status).toBe(403);
    expect(mockSync).not.toHaveBeenCalled();
  });

  it("répond 404 si le document n'existe pas", async () => {
    docRows = [];
    mockAccess.mockResolvedValue(true);
    const { POST } = await import("@/app/api/tasks/sync-document/route");
    const res = await POST(syncReq());
    expect(res.status).toBe(404);
    expect(mockSync).not.toHaveBeenCalled();
  });

  it("utilise le helper sûr avec le spaceId du document et synchronise si accès accordé", async () => {
    mockAccess.mockResolvedValue(true);
    const { POST } = await import("@/app/api/tasks/sync-document/route");
    const res = await POST(syncReq());
    expect(res.status).toBe(200);
    expect(mockAccess).toHaveBeenCalledWith(
      expect.objectContaining({ id: "user-a" }),
      "space-org-b",
      DOC_ID
    );
    expect(mockSync).toHaveBeenCalled();
  });
});

describe("POST /api/tasks/unassign — contrôle d'accès", () => {
  it("répond 403 si l'accès en écriture est refusé", async () => {
    mockAccess.mockResolvedValue(false);
    const { POST } = await import("@/app/api/tasks/unassign/route");
    const res = await POST(unassignReq());
    expect(res.status).toBe(403);
  });

  it("répond 404 si le document n'existe pas", async () => {
    docRows = [];
    mockAccess.mockResolvedValue(true);
    const { POST } = await import("@/app/api/tasks/unassign/route");
    const res = await POST(unassignReq());
    expect(res.status).toBe(404);
  });

  it("utilise le helper sûr avec le spaceId du document", async () => {
    mockAccess.mockResolvedValue(true);
    const { POST } = await import("@/app/api/tasks/unassign/route");
    const res = await POST(unassignReq());
    expect(res.status).toBe(200);
    expect(mockAccess).toHaveBeenCalledWith(
      expect.objectContaining({ id: "user-a" }),
      "space-org-b",
      DOC_ID
    );
  });
});
