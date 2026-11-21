/**
 * Contrôle d'accès — POST /api/automations/[automationId]/trigger
 *
 * Le `documentId` du corps de requête est une entrée d'exécution : il alimente
 * `{{doc.id}}` (interpolate.ts) et sert de document par défaut aux actions
 * (create_task). Il était transmis à executeAutomation sans le moindre
 * contrôle : un éditeur de l'espace du workflow pouvait forger l'identifiant
 * d'un document hors de sa portée. La route exige désormais
 * checkDocumentViewAccess avant de propager le paramètre.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

let automationRows: unknown[] = [];
let docRows: unknown[] = [];
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
    limit: vi.fn(() => Promise.resolve(selectCall === 1 ? automationRows : docRows)),
  };
  return self;
};

vi.mock("@/lib/auth/require-org-scoped", () => ({
  requireOrgScoped: vi.fn().mockResolvedValue({
    user: { id: "user-a", name: "User A", email: "a@org-a.com", globalRole: "user" },
    orgId: "org-a",
    orgSlug: "org-a",
    spaceId: "space-1",
    permission: "editor",
  }),
  OrgScopeError: class OrgScopeError extends Error {},
}));

vi.mock("@/lib/settings/system-settings", () => ({
  getSetting: vi.fn().mockResolvedValue({ enabled: true }),
}));

vi.mock("@/lib/automations/executor", () => ({
  executeAutomation: vi.fn().mockResolvedValue({
    status: "success",
    durationMs: 5,
    steps: [],
  }),
}));

vi.mock("@/lib/auth/check-access", () => ({
  checkDocumentViewAccess: vi.fn(),
}));

vi.mock("@/lib/db", () => ({ db: makeChainableMock() }));

import { checkDocumentViewAccess } from "@/lib/auth/check-access";
import { executeAutomation } from "@/lib/automations/executor";

const mockView = vi.mocked(checkDocumentViewAccess);
const mockExecute = vi.mocked(executeAutomation);

const DOC_ID = "11111111-1111-4111-8111-111111111111";

const req = (body: unknown) =>
  new Request("http://localhost/api/automations/auto-1/trigger", {
    method: "POST",
    body: JSON.stringify(body),
    headers: { "content-type": "application/json" },
  });

const ctx = { params: Promise.resolve({ automationId: "auto-1" }) };

beforeEach(() => {
  vi.clearAllMocks();
  selectCall = 0;
  automationRows = [
    { id: "auto-1", databaseId: null, spaceId: "space-1", enabled: true },
  ];
  docRows = [{ spaceId: "space-autre" }];
});

describe("POST /api/automations/[automationId]/trigger — documentId d'entrée", () => {
  it("répond 403 et n'exécute rien si l'accès au document est refusé", async () => {
    mockView.mockResolvedValue(false);
    const { POST } = await import("@/app/api/automations/[automationId]/trigger/route");
    const res = await POST(req({ documentId: DOC_ID }), ctx);
    expect(res.status).toBe(403);
    expect(mockExecute).not.toHaveBeenCalled();
  });

  it("répond 404 si le document fourni n'existe pas", async () => {
    docRows = [];
    mockView.mockResolvedValue(true);
    const { POST } = await import("@/app/api/automations/[automationId]/trigger/route");
    const res = await POST(req({ documentId: DOC_ID }), ctx);
    expect(res.status).toBe(404);
    expect(mockExecute).not.toHaveBeenCalled();
  });

  it("exécute le workflow avec le documentId quand l'accès est accordé", async () => {
    mockView.mockResolvedValue(true);
    const { POST } = await import("@/app/api/automations/[automationId]/trigger/route");
    const res = await POST(req({ documentId: DOC_ID }), ctx);
    expect(res.status).toBe(200);
    expect(mockView).toHaveBeenCalledWith(
      expect.objectContaining({ id: "user-a" }),
      "space-autre",
      DOC_ID
    );
    expect(mockExecute).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ documentId: DOC_ID })
    );
  });

  it("exécute le workflow sans contrôle documentaire quand documentId est absent", async () => {
    const { POST } = await import("@/app/api/automations/[automationId]/trigger/route");
    const res = await POST(req({}), ctx);
    expect(res.status).toBe(200);
    expect(mockView).not.toHaveBeenCalled();
    expect(mockExecute).toHaveBeenCalled();
  });
});
