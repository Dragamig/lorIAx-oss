/**
 * Contrôle d'accès — POST /api/documents/[id]/copy
 *
 * La route s'appuyait sur getSpacePermission seul, qui n'applique aucun filtre
 * d'organisation et renvoie "admin" à tout admin global : un admin de l'org A
 * pouvait copier (donc lire intégralement) un document de l'org B, ou déverser
 * une copie dans un espace de l'org B. Le contrôle passe désormais par
 * checkDocumentViewAccess (source) et checkSpaceWriteAccess (destination), qui
 * incluent tous deux le cloisonnement multi-tenant.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

let docRows: unknown[] = [];
let sourceSpaceRows: unknown[] = [];
let targetSpaceRows: unknown[] = [];
let selectCall = 0;

const insertMock = vi.fn();

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
        selectCall === 1 ? docRows : selectCall === 2 ? sourceSpaceRows : targetSpaceRows
      )
    ),
    insert: vi.fn(() => {
      insertMock();
      return self;
    }),
    values: vi.fn().mockReturnThis(),
    returning: vi.fn(() => Promise.resolve([{ id: "copy-1" }])),
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
  checkDocumentViewAccess: vi.fn(),
  checkSpaceWriteAccess: vi.fn(),
}));

vi.mock("@/lib/storage/filesystem", () => ({
  readDocument: vi.fn().mockResolvedValue("Contenu confidentiel"),
  writeDocument: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("@/lib/git/repository", () => ({
  commitFile: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("@/lib/activity", () => ({
  logActivity: vi.fn(),
}));

vi.mock("@/lib/db", () => ({ db: makeChainableMock() }));

import { checkDocumentViewAccess, checkSpaceWriteAccess } from "@/lib/auth/check-access";
import { readDocument, writeDocument } from "@/lib/storage/filesystem";

const mockView = vi.mocked(checkDocumentViewAccess);
const mockWrite = vi.mocked(checkSpaceWriteAccess);
const mockRead = vi.mocked(readDocument);
const mockWriteDoc = vi.mocked(writeDocument);

const req = () =>
  new NextRequest("http://localhost/api/documents/doc-1/copy", {
    method: "POST",
    body: JSON.stringify({ targetSpaceSlug: "espace-cible" }),
    headers: { "content-type": "application/json" },
  });

const ctx = (id: string) => ({ params: Promise.resolve({ id }) });

beforeEach(() => {
  vi.clearAllMocks();
  selectCall = 0;
  docRows = [
    {
      id: "doc-1",
      title: "Doc secret",
      slug: "doc-secret",
      spaceId: "space-org-b",
      filePath: "doc.md",
      contentText: "Contenu confidentiel",
      isFolder: false,
      visibility: "private",
      classification: "confidential",
    },
  ];
  sourceSpaceRows = [{ id: "space-org-b", slug: "org-b", gitRepoPath: "/tmp/repo-b" }];
  targetSpaceRows = [{ id: "space-cible", slug: "espace-cible", gitRepoPath: "/tmp/repo-a" }];
});

describe("POST /api/documents/[id]/copy — contrôle d'accès", () => {
  it("répond 403 sans lire ni copier quoi que ce soit si la lecture du document source est refusée", async () => {
    mockView.mockResolvedValue(false);
    mockWrite.mockResolvedValue(true);
    const { POST } = await import("@/app/api/documents/[id]/copy/route");
    const res = await POST(req(), ctx("doc-1"));
    expect(res.status).toBe(403);
    expect(mockRead).not.toHaveBeenCalled();
    expect(mockWriteDoc).not.toHaveBeenCalled();
    expect(insertMock).not.toHaveBeenCalled();
  });

  it("répond 403 sans rien écrire si l'espace de destination est hors de portée (autre org ou lecture seule)", async () => {
    mockView.mockResolvedValue(true);
    mockWrite.mockResolvedValue(false);
    const { POST } = await import("@/app/api/documents/[id]/copy/route");
    const res = await POST(req(), ctx("doc-1"));
    expect(res.status).toBe(403);
    expect(mockRead).not.toHaveBeenCalled();
    expect(mockWriteDoc).not.toHaveBeenCalled();
    expect(insertMock).not.toHaveBeenCalled();
  });

  it("copie le document quand la lecture source et l'écriture destination sont accordées", async () => {
    mockView.mockResolvedValue(true);
    mockWrite.mockResolvedValue(true);
    const { POST } = await import("@/app/api/documents/[id]/copy/route");
    const res = await POST(req(), ctx("doc-1"));
    expect(res.status).toBe(200);
    expect(mockView).toHaveBeenCalledWith(
      expect.objectContaining({ id: "admin-a" }),
      "space-org-b",
      "doc-1"
    );
    expect(mockWrite).toHaveBeenCalledWith(
      expect.objectContaining({ id: "admin-a" }),
      "space-cible"
    );
    expect(mockWriteDoc).toHaveBeenCalled();
    expect(insertMock).toHaveBeenCalled();
  });
});
