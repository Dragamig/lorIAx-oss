/**
 * Cloisonnement multi-tenant — /api/templates/[id] (GET/PATCH/DELETE)
 *
 * Un modèle attaché à l'espace d'une autre organisation ne doit jamais être
 * lisible ni modifiable/supprimable : 404 (fail-closed), jamais 200/403.
 * Les modèles globaux (isGlobal) restent visibles (design instance-wide),
 * l'écriture restant gardée par les rôles éditeur de modèles.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

let selectResult: unknown[] = [];
let returningResult: unknown[] = [];

const makeChainableMock = () => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const self: any = {
    then: (resolve: (v: unknown[]) => void, reject?: (e: unknown) => void) =>
      Promise.resolve(selectResult).then(resolve, reject),
    select: vi.fn().mockReturnThis(),
    from: vi.fn().mockReturnThis(),
    where: vi.fn().mockReturnThis(),
    orderBy: vi.fn().mockReturnThis(),
    limit: vi.fn().mockReturnThis(),
    update: vi.fn().mockReturnThis(),
    set: vi.fn().mockReturnThis(),
    delete: vi.fn().mockReturnThis(),
    returning: vi.fn(() => Promise.resolve(returningResult)),
  };
  return self;
};

vi.mock("@/lib/auth/get-user", () => ({
  getSessionUser: vi.fn().mockResolvedValue({
    id: "user-a",
    name: "Alice",
    email: "alice@org-a.com",
    globalRole: "admin",
    capabilities: [],
  }),
}));

vi.mock("@/lib/auth/check-access", () => ({
  getAccessibleSpaceIds: vi.fn().mockResolvedValue([]),
}));

vi.mock("@/lib/templates/builtin", () => ({
  getBuiltinTemplateById: vi.fn().mockReturnValue(null),
}));

vi.mock("@/lib/db", () => ({
  db: makeChainableMock(),
}));

import { getSessionUser } from "@/lib/auth/get-user";
import { getAccessibleSpaceIds } from "@/lib/auth/check-access";

const mockUser = vi.mocked(getSessionUser);
const mockAccessible = vi.mocked(getAccessibleSpaceIds);

const TEMPLATE_ORG_B = {
  id: "tmpl-1",
  name: "Modèle org B",
  category: "doc",
  isGlobal: false,
  spaceId: "space-org-b",
  createdBy: "user-b",
};
const TEMPLATE_GLOBAL = { ...TEMPLATE_ORG_B, id: "tmpl-g", isGlobal: true, spaceId: null };
const TEMPLATE_ORG_A = { ...TEMPLATE_ORG_B, id: "tmpl-a", spaceId: "space-org-a" };

beforeEach(() => {
  vi.clearAllMocks();
  selectResult = [];
  returningResult = [];
  mockUser.mockResolvedValue({
    id: "user-a", name: "Alice", email: "alice@org-a.com",
    globalRole: "admin", capabilities: [],
  } as never);
  mockAccessible.mockResolvedValue([]);
});

const req = (m: string) =>
  new NextRequest("http://localhost/api/templates/tmpl-1", { method: m });
const ctx = (id: string) => ({ params: Promise.resolve({ id }) });

describe("GET /api/templates/[id] — cloisonnement", () => {
  it("404 si le modèle appartient à l'espace d'une autre org", async () => {
    selectResult = [TEMPLATE_ORG_B];
    mockAccessible.mockResolvedValue([]); // aucun espace accessible
    const { GET } = await import("@/app/api/templates/[id]/route");
    const res = await GET(req("GET") as never, ctx("tmpl-1"));
    expect(res.status).toBe(404);
  });

  it("200 pour un modèle global", async () => {
    selectResult = [TEMPLATE_GLOBAL];
    const { GET } = await import("@/app/api/templates/[id]/route");
    const res = await GET(req("GET") as never, ctx("tmpl-g"));
    expect(res.status).toBe(200);
  });

  it("200 pour un modèle d'un espace accessible dans l'org courante", async () => {
    selectResult = [TEMPLATE_ORG_A];
    mockAccessible.mockResolvedValue(["space-org-a"]);
    const { GET } = await import("@/app/api/templates/[id]/route");
    const res = await GET(req("GET") as never, ctx("tmpl-a"));
    expect(res.status).toBe(200);
  });
});

describe("PATCH /api/templates/[id] — cloisonnement", () => {
  it("404 si le modèle appartient à une autre org (pas d'écriture)", async () => {
    selectResult = [TEMPLATE_ORG_B];
    returningResult = [TEMPLATE_ORG_B]; // sans garde org, l'update réussirait (200)
    mockAccessible.mockResolvedValue([]);
    const { PATCH } = await import("@/app/api/templates/[id]/route");
    const r = new NextRequest("http://localhost/api/templates/tmpl-1", {
      method: "PATCH",
      body: JSON.stringify({ name: "hack" }),
    });
    const res = await PATCH(r as never, ctx("tmpl-1"));
    expect(res.status).toBe(404);
  });
});

describe("DELETE /api/templates/[id] — cloisonnement", () => {
  it("404 si le modèle appartient à une autre org (pas de suppression)", async () => {
    selectResult = [TEMPLATE_ORG_B];
    returningResult = [TEMPLATE_ORG_B]; // sans garde org, la suppression réussirait (200)
    mockAccessible.mockResolvedValue([]);
    const { DELETE } = await import("@/app/api/templates/[id]/route");
    const res = await DELETE(req("DELETE") as never, ctx("tmpl-1"));
    expect(res.status).toBe(404);
  });
});
