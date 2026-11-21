/**
 * Contrôle d'accès — DELETE /api/documents/[id]/comments
 *
 * La suppression n'exigeait que checkDocumentViewAccess, puis « auteur du
 * commentaire OU admin global ». Deux défauts : un simple lecteur du document
 * n'aurait pas dû pouvoir supprimer, et un admin d'espace (modération légitime)
 * ne le pouvait pas. La règle est désormais : lecture du document exigée, puis
 * auteur du commentaire OU droit d'édition sur le document (qui couvre l'admin
 * d'espace et l'admin global).
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

let commentRows: unknown[] = [];
let docRows: unknown[] = [];
let selectCall = 0;
const deleteWhere = vi.fn(() => Promise.resolve([]));

const makeChainableMock = () => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const self: any = {
    select: vi.fn(() => {
      selectCall += 1;
      return self;
    }),
    from: vi.fn().mockReturnThis(),
    innerJoin: vi.fn().mockReturnThis(),
    where: vi.fn().mockReturnThis(),
    orderBy: vi.fn(() => Promise.resolve([])),
    limit: vi.fn(() => Promise.resolve(selectCall === 1 ? commentRows : docRows)),
    delete: vi.fn(() => ({ where: deleteWhere })),
  };
  return self;
};

vi.mock("@/lib/auth/get-user", () => ({
  getSessionUser: vi.fn(),
}));

vi.mock("@/lib/auth/check-access", () => ({
  checkDocumentViewAccess: vi.fn(),
  checkDocumentEditAccess: vi.fn(),
}));

vi.mock("@/lib/notifications", () => ({
  createNotification: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("@/lib/db", () => ({ db: makeChainableMock() }));

import { getSessionUser } from "@/lib/auth/get-user";
import {
  checkDocumentViewAccess,
  checkDocumentEditAccess,
} from "@/lib/auth/check-access";

const mockUser = vi.mocked(getSessionUser);
const mockView = vi.mocked(checkDocumentViewAccess);
const mockEdit = vi.mocked(checkDocumentEditAccess);

const asUser = (id: string) =>
  mockUser.mockResolvedValue({
    id,
    name: id,
    email: `${id}@org-a.com`,
    globalRole: "user",
  } as never);

const ctx = { params: Promise.resolve({ id: "doc-1" }) };
const req = () =>
  new NextRequest("http://localhost/api/documents/doc-1/comments", {
    method: "DELETE",
    body: JSON.stringify({ commentId: "comment-1" }),
    headers: { "content-type": "application/json" },
  });

beforeEach(() => {
  vi.clearAllMocks();
  selectCall = 0;
  commentRows = [{ id: "comment-1", documentId: "doc-1", userId: "author" }];
  docRows = [{ spaceId: "space-1" }];
  mockView.mockResolvedValue(true);
  mockEdit.mockResolvedValue(false);
  asUser("author");
});

describe("DELETE /api/documents/[id]/comments — contrôle d'accès", () => {
  it("laisse l'auteur supprimer son propre commentaire sans droit d'édition", async () => {
    asUser("author");
    mockEdit.mockResolvedValue(false);
    const { DELETE } = await import("@/app/api/documents/[id]/comments/route");
    const res = await DELETE(req(), ctx);
    expect(res.status).toBe(200);
    expect(deleteWhere).toHaveBeenCalled();
    // L'auteur n'a même pas besoin d'un contrôle d'édition
    expect(mockEdit).not.toHaveBeenCalled();
  });

  it("refuse 403 à un tiers qui n'a qu'un accès en lecture", async () => {
    asUser("lecteur");
    mockEdit.mockResolvedValue(false);
    const { DELETE } = await import("@/app/api/documents/[id]/comments/route");
    const res = await DELETE(req(), ctx);
    expect(res.status).toBe(403);
    expect(deleteWhere).not.toHaveBeenCalled();
  });

  it("autorise un tiers ayant le droit d'édition sur le document (modération)", async () => {
    asUser("admin-espace");
    mockEdit.mockResolvedValue(true);
    const { DELETE } = await import("@/app/api/documents/[id]/comments/route");
    const res = await DELETE(req(), ctx);
    expect(res.status).toBe(200);
    expect(mockEdit).toHaveBeenCalledWith(
      expect.objectContaining({ id: "admin-espace" }),
      "space-1",
      "doc-1"
    );
    expect(deleteWhere).toHaveBeenCalled();
  });

  it("refuse 403 même à l'auteur si l'accès en lecture au document est refusé", async () => {
    asUser("author");
    mockView.mockResolvedValue(false);
    const { DELETE } = await import("@/app/api/documents/[id]/comments/route");
    const res = await DELETE(req(), ctx);
    expect(res.status).toBe(403);
    expect(deleteWhere).not.toHaveBeenCalled();
  });

  it("répond 404 si le commentaire n'existe pas", async () => {
    commentRows = [];
    const { DELETE } = await import("@/app/api/documents/[id]/comments/route");
    const res = await DELETE(req(), ctx);
    expect(res.status).toBe(404);
  });
});
