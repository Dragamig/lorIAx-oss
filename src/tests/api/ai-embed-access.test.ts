/**
 * Contrôle d'accès — POST /api/ai/embed
 *
 * La route appelait indexDocument() sur un identifiant arbitraire sans le
 * moindre contrôle : réindexation forcée (consommation de quota) et oracle
 * d'existence sur tous les documents de toutes les organisations. Le document
 * est désormais chargé puis soumis à checkDocumentEditAccess, qui inclut le
 * cloisonnement multi-tenant.
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
    id: "admin-a",
    name: "Admin A",
    email: "admin@org-a.com",
    globalRole: "admin",
  }),
}));

vi.mock("@/lib/auth/check-access", () => ({
  checkDocumentEditAccess: vi.fn(),
}));

vi.mock("@/lib/ai/embeddings", () => ({
  indexDocument: vi.fn().mockResolvedValue(undefined),
  isEmbeddingConfiguredAsync: vi.fn().mockResolvedValue(true),
}));

vi.mock("@/lib/rate-limit", () => ({
  // AZ-26 : la route consomme désormais le compteur PARTAGÉ, donc la variante
  // asynchrone. La doublure suit.
  checkRateLimitAsync: vi.fn(async () => ({ success: true, resetAt: Date.now() + 1000 })),
  RATE_LIMITS: { embed: { limit: 100, windowMs: 60_000 } },
}));

vi.mock("@/lib/db", () => ({ db: makeChainableMock() }));

import { checkDocumentEditAccess } from "@/lib/auth/check-access";
import { indexDocument } from "@/lib/ai/embeddings";

const mockEdit = vi.mocked(checkDocumentEditAccess);
const mockIndex = vi.mocked(indexDocument);

const req = () =>
  new NextRequest("http://localhost/api/ai/embed", {
    method: "POST",
    body: JSON.stringify({ documentId: "doc-1" }),
    headers: { "content-type": "application/json" },
  });

beforeEach(() => {
  vi.clearAllMocks();
  docRows = [{ id: "doc-1", spaceId: "space-org-b" }];
});

describe("POST /api/ai/embed — contrôle d'accès", () => {
  it("répond 403 et n'indexe rien si l'accès au document est refusé", async () => {
    mockEdit.mockResolvedValue(false);
    const { POST } = await import("@/app/api/ai/embed/route");
    const res = await POST(req());
    expect(res.status).toBe(403);
    expect(mockIndex).not.toHaveBeenCalled();
  });

  it("répond 404 et n'indexe rien si le document n'existe pas", async () => {
    docRows = [];
    mockEdit.mockResolvedValue(true);
    const { POST } = await import("@/app/api/ai/embed/route");
    const res = await POST(req());
    expect(res.status).toBe(404);
    expect(mockIndex).not.toHaveBeenCalled();
    expect(mockEdit).not.toHaveBeenCalled();
  });

  it("indexe le document quand l'accès est accordé", async () => {
    mockEdit.mockResolvedValue(true);
    const { POST } = await import("@/app/api/ai/embed/route");
    const res = await POST(req());
    expect(res.status).toBe(200);
    expect(mockEdit).toHaveBeenCalledWith(
      expect.objectContaining({ id: "admin-a" }),
      "space-org-b",
      "doc-1"
    );
    expect(mockIndex).toHaveBeenCalledWith("doc-1");
  });
});
