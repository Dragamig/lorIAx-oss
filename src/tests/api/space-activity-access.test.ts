/**
 * Contrôle d'accès sur `GET /api/spaces/[slug]/activity` (audit du
 * 2026-08-19, constat AZ-15).
 *
 * L'espace était correctement confiné à l'organisation courante par
 * `getSpaceBySlugForRequest`, mais AUCUNE permission n'était ensuite exigée :
 * tout membre de l'organisation lisait le fil d'activité d'un espace dont il
 * n'est pas membre, donc les titres des documents et les noms des acteurs, y
 * compris pour un espace classé secret. La route voisine
 * `GET /api/spaces/[slug]/documents` faisait déjà ce contrôle, c'est le modèle
 * repris ici.
 *
 * Motif du dépôt : « répond 403 ou 404 ET ne lit rien », l'absence de lecture
 * étant prouvée par le non-appel de `db.select`.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

const h = vi.hoisted(() => ({
  getSessionUser: vi.fn(),
  getSpaceBySlugForRequest: vi.fn(),
  getSpacePermission: vi.fn(),
  selectCalls: { count: 0 },
  rows: [] as unknown[],
}));

function chain(rows: unknown[]) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const self: any = {
    from: vi.fn().mockReturnThis(),
    leftJoin: vi.fn().mockReturnThis(),
    where: vi.fn().mockReturnThis(),
    orderBy: vi.fn().mockReturnThis(),
    limit: vi.fn().mockReturnThis(),
    offset: vi.fn().mockResolvedValue(rows),
  };
  return self;
}

vi.mock("@/lib/auth/get-user", () => ({ getSessionUser: h.getSessionUser }));
vi.mock("@/lib/org/scoped-space", () => ({
  getSpaceBySlugForRequest: h.getSpaceBySlugForRequest,
}));
vi.mock("@/lib/auth/check-access", () => ({
  getSpacePermission: h.getSpacePermission,
}));
vi.mock("@/lib/db/schema", () => ({ activityLog: {}, users: {} }));
vi.mock("@/lib/db", () => ({
  db: {
    select: vi.fn(() => {
      h.selectCalls.count += 1;
      return chain(h.rows);
    }),
  },
}));

import { GET } from "@/app/api/spaces/[slug]/activity/route";

const USER = { id: "user-a", email: "a@acme.tld", globalRole: "editor" };
const ctx = { params: Promise.resolve({ slug: "espace-secret" }) };
const req = () =>
  new NextRequest("http://localhost/api/spaces/espace-secret/activity");

beforeEach(() => {
  vi.clearAllMocks();
  h.selectCalls.count = 0;
  h.rows = [
    {
      id: "act-1",
      action: "document.update",
      entityType: "document",
      entityId: "doc-1",
      metadata: { spaceId: "space-1", title: "Plan social confidentiel" },
      createdAt: new Date().toISOString(),
      userId: "user-b",
      userName: "Utilisateur B",
      userEmail: "b@acme.tld",
    },
  ];
  h.getSessionUser.mockResolvedValue(USER);
  h.getSpaceBySlugForRequest.mockResolvedValue({ id: "space-1", slug: "espace-secret" });
});

describe("GET /api/spaces/[slug]/activity — contrôle d'accès", () => {
  it("répond 401 sans session, et ne lit rien", async () => {
    h.getSessionUser.mockResolvedValue(null);
    const res = await GET(req(), ctx);
    expect(res.status).toBe(401);
    expect(h.selectCalls.count).toBe(0);
  });

  it("répond 404 quand l'espace n'est pas dans l'organisation courante", async () => {
    h.getSpaceBySlugForRequest.mockResolvedValue(null);
    const res = await GET(req(), ctx);
    expect(res.status).toBe(404);
    expect(h.getSpacePermission).not.toHaveBeenCalled();
    expect(h.selectCalls.count).toBe(0);
  });

  it("répond 403 à un membre de l'organisation sans permission sur l'espace, et ne lit AUCUNE activité", async () => {
    h.getSpacePermission.mockResolvedValue(null);
    const res = await GET(req(), ctx);

    expect(res.status).toBe(403);
    await expect(res.json()).resolves.toEqual({ error: "Accès refusé" });
    // Ni titre de document ni nom d'acteur n'a été chargé.
    expect(h.selectCalls.count).toBe(0);
  });

  it("répond 200 pour un simple lecteur de l'espace", async () => {
    h.getSpacePermission.mockResolvedValue("viewer");
    const res = await GET(req(), ctx);

    expect(res.status).toBe(200);
    expect(h.getSpacePermission).toHaveBeenCalledWith("user-a", "space-1");
    const body = await res.json();
    expect(body).toHaveLength(1);
  });

  it("répond 200 pour le propriétaire de l'espace (permission implicite admin)", async () => {
    h.getSpacePermission.mockResolvedValue("admin");
    const res = await GET(req(), ctx);
    expect(res.status).toBe(200);
  });
});
