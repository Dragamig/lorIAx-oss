/**
 * Cloisonnement multi-tenant — GET /api/notifications
 *
 * Les notifications sont scopées par userId, mais en multi-org un même compte
 * appartient à plusieurs organisations. Sur le sous-domaine de l'org A, le
 * panneau ne doit pas exposer le titre/slug d'un document de l'org B.
 * Règle : une notification liée à un document n'apparaît que si ce document
 * appartient à l'org courante ; les notifications sans document (non
 * rattachables à une org) restent visibles.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

let selectRows: unknown[] = [];

const makeChainableMock = () => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const self: any = {
    then: (resolve: (v: unknown[]) => void, reject?: (e: unknown) => void) =>
      Promise.resolve(selectRows).then(resolve, reject),
    select: vi.fn().mockReturnThis(),
    from: vi.fn().mockReturnThis(),
    where: vi.fn().mockReturnThis(),
    orderBy: vi.fn().mockReturnThis(),
    leftJoin: vi.fn().mockReturnThis(),
    innerJoin: vi.fn().mockReturnThis(),
    limit: vi.fn(() => Promise.resolve(selectRows)),
  };
  return self;
};

vi.mock("@/lib/auth/get-user", () => ({
  getSessionUser: vi.fn().mockResolvedValue({
    id: "user-a", name: "Alice", email: "alice@org-a.com", globalRole: "editor",
  }),
}));

vi.mock("@/lib/org/get-request-org", () => ({
  getRequestOrgId: vi.fn().mockResolvedValue("org-a"),
}));

vi.mock("@/lib/db", () => ({ db: makeChainableMock() }));

import { getRequestOrgId } from "@/lib/org/get-request-org";
import { getSessionUser } from "@/lib/auth/get-user";

const mockOrg = vi.mocked(getRequestOrgId);
const mockUser = vi.mocked(getSessionUser);

beforeEach(() => {
  vi.clearAllMocks();
  selectRows = [];
  mockUser.mockResolvedValue({
    id: "user-a", name: "Alice", email: "alice@org-a.com", globalRole: "editor",
  } as never);
  mockOrg.mockResolvedValue("org-a");
});

describe("GET /api/notifications — cloisonnement multi-tenant", () => {
  it("exclut les notifications dont le document est dans une autre org", async () => {
    selectRows = [
      { id: "n-a", documentId: "doc-a", organizationId: "org-a", documentTitle: "Doc A", spaceSlug: "esp-a", read: false },
      { id: "n-b", documentId: "doc-b", organizationId: "org-b", documentTitle: "Doc B (secret)", spaceSlug: "esp-b", read: false },
      { id: "n-sys", documentId: null, organizationId: null, documentTitle: null, spaceSlug: null, read: false },
    ];
    const { GET } = await import("@/app/api/notifications/route");
    const res = await GET(new NextRequest("http://localhost/api/notifications") as never);
    expect(res.status).toBe(200);
    const body = await res.json();
    const ids = body.notifications.map((n: { id: string }) => n.id);
    expect(ids).toContain("n-a");
    expect(ids).toContain("n-sys"); // sans document → toujours visible
    expect(ids).not.toContain("n-b"); // document d'une autre org → masqué
    expect(mockOrg).toHaveBeenCalledWith(expect.objectContaining({ id: "user-a" }));
  });

  it("401 si non authentifié", async () => {
    mockUser.mockResolvedValueOnce(null);
    const { GET } = await import("@/app/api/notifications/route");
    const res = await GET(new NextRequest("http://localhost/api/notifications") as never);
    expect(res.status).toBe(401);
  });
});
