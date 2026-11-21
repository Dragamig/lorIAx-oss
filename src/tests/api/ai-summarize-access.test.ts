/**
 * Contrôle d'accès — POST /api/ai/summarize
 *
 * La route chargeait le document par UUID sans aucune vérification : n'importe
 * quel utilisateur authentifié pouvait obtenir le résumé d'un document d'une
 * autre organisation en devinant/récupérant son identifiant. Le contrôle passe
 * désormais par checkDocumentViewAccess (qui inclut le cloisonnement d'org).
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

let docRows: unknown[] = [];
let spaceRows: unknown[] = [];
let selectCall = 0;

const makeChainableMock = () => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const self: any = {
    select: vi.fn(() => {
      selectCall += 1;
      return self;
    }),
    from: vi.fn().mockReturnThis(),
    where: vi.fn().mockReturnThis(),
    limit: vi.fn(() => Promise.resolve(selectCall === 1 ? docRows : spaceRows)),
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
}));

vi.mock("@/lib/ai/provider-resolver", () => ({
  isAnyAIProviderConfigured: vi.fn().mockResolvedValue(true),
  getLanguageModelForUsageInOrg: vi.fn().mockResolvedValue({ languageModel: {} }),
}));

// La route résout désormais la portée d'organisation de la requête avant
// d'appeler le modèle (cloisonnement AZ-06, lot 6). Le cloisonnement lui-même
// est exercé par `src/__tests__/lib/ai-org-scope-callers.test.ts` ; ici, seul
// le contrôle d'accès au document est en jeu.
vi.mock("@/lib/org/get-request-org", () => ({
  getRequestOrgId: vi.fn().mockResolvedValue("org-a"),
}));

vi.mock("ai", () => ({
  generateText: vi.fn().mockResolvedValue({ text: "resume" }),
}));

vi.mock("@/lib/storage/filesystem", () => ({
  readDocument: vi.fn().mockResolvedValue("Contenu confidentiel"),
}));

vi.mock("@/lib/db", () => ({ db: makeChainableMock() }));

import { checkDocumentViewAccess } from "@/lib/auth/check-access";
import { generateText } from "ai";

const mockAccess = vi.mocked(checkDocumentViewAccess);
const mockGenerate = vi.mocked(generateText);

const req = () =>
  new NextRequest("http://localhost/api/ai/summarize", {
    method: "POST",
    body: JSON.stringify({ documentId: "doc-1" }),
    headers: { "content-type": "application/json" },
  });

beforeEach(() => {
  vi.clearAllMocks();
  selectCall = 0;
  docRows = [
    {
      id: "doc-1",
      title: "Doc secret",
      spaceId: "space-org-b",
      filePath: "doc.md",
      contentText: "Contenu confidentiel",
    },
  ];
  spaceRows = [{ id: "space-org-b", gitRepoPath: "/tmp/repo" }];
});

describe("POST /api/ai/summarize — contrôle d'accès", () => {
  it("répond 403 et n'appelle pas le modèle si l'accès en lecture est refusé", async () => {
    mockAccess.mockResolvedValue(false);
    const { POST } = await import("@/app/api/ai/summarize/route");
    const res = await POST(req());
    expect(res.status).toBe(403);
    expect(mockGenerate).not.toHaveBeenCalled();
  });

  it("résume le document quand l'accès en lecture est accordé", async () => {
    mockAccess.mockResolvedValue(true);
    const { POST } = await import("@/app/api/ai/summarize/route");
    const res = await POST(req());
    expect(res.status).toBe(200);
    expect(mockAccess).toHaveBeenCalledWith(
      expect.objectContaining({ id: "user-a" }),
      "space-org-b",
      "doc-1"
    );
    expect(mockGenerate).toHaveBeenCalled();
  });
});
