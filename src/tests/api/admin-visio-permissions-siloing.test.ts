/**
 * Cloisonnement de la matrice de permissions visio d'administration.
 *
 * `GET` et `PATCH /api/admin/visio-permissions` prenaient un `spaceId` du
 * client et appelaient `getVisioPermissionMatrix` / `setVisioPermission` sans
 * aucun contrôle d'organisation : un admin lisait et réécrivait la matrice
 * visio d'un espace d'un autre tenant, donc y ouvrait ou y fermait la création
 * et la participation aux réunions.
 *
 * La garde de rôle `admin` en tête de handler est légitime et reste : elle dit
 * « cet utilisateur administre quelque chose », pas « il administre cet
 * espace ». Ce qui manquait, c'est la confrontation de l'espace visé à
 * l'organisation de la requête, bornée aux organisations dont l'admin est
 * membre depuis le correctif AZ-06.
 *
 * Motif des assertions : « refuse ET n'écrit rien ». 404 sur dépareillement,
 * jamais 403 : on ne révèle pas l'existence d'un espace d'un autre tenant.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

const DRIZZLE_NAME = Symbol.for("drizzle:Name");

const h = vi.hoisted(() => ({
  spaceRows: [] as Record<string, unknown>[],
}));

vi.mock("@/lib/db", () => {
  const select = () => {
    let name = "";
    const chain = {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      from(table: any) {
        name = table?.[DRIZZLE_NAME] ?? "";
        return chain;
      },
      where: () => chain,
      limit: () => Promise.resolve(name === "spaces" ? h.spaceRows : []),
    };
    return chain;
  };
  return { db: { select } };
});

vi.mock("@/lib/auth/get-user", () => ({
  getSessionUser: vi.fn(),
}));

vi.mock("@/lib/org/get-request-org", () => ({
  getRequestOrgId: vi.fn(),
}));

vi.mock("@/lib/meet/permissions", () => ({
  getVisioPermissionMatrix: vi.fn(async () => ({ matrice: true })),
  setVisioPermission: vi.fn(async () => undefined),
}));

import { getSessionUser } from "@/lib/auth/get-user";
import { getRequestOrgId } from "@/lib/org/get-request-org";
import {
  getVisioPermissionMatrix,
  setVisioPermission,
} from "@/lib/meet/permissions";

const mockUser = vi.mocked(getSessionUser);
const mockOrg = vi.mocked(getRequestOrgId);
const mockMatrix = vi.mocked(getVisioPermissionMatrix);
const mockSet = vi.mocked(setVisioPermission);

const SPACE_B = "11111111-1111-4111-8111-111111111111";
const SPACE_A = "22222222-2222-4222-8222-222222222222";

const getReq = (spaceId?: string) =>
  new NextRequest(
    spaceId
      ? `http://localhost/api/admin/visio-permissions?spaceId=${spaceId}`
      : "http://localhost/api/admin/visio-permissions"
  );

const patchReq = (spaceId: string | null) =>
  new NextRequest("http://localhost/api/admin/visio-permissions", {
    method: "PATCH",
    body: JSON.stringify({
      spaceId,
      action: "create_immediate",
      role: "viewer",
      allowed: true,
    }),
    headers: { "content-type": "application/json" },
  });

beforeEach(() => {
  vi.clearAllMocks();
  h.spaceRows = [];
  mockUser.mockResolvedValue({
    id: "admin-a",
    name: "Admin A",
    email: "admin@org-a.test",
    globalRole: "admin",
  } as never);
  mockOrg.mockResolvedValue("org-a");
  mockMatrix.mockResolvedValue({ matrice: true } as never);
  mockSet.mockResolvedValue(undefined);
});

describe("GET /api/admin/visio-permissions : cloisonnement", () => {
  it("404 muet et aucune lecture de matrice pour un espace d'un autre tenant", async () => {
    h.spaceRows = [{ organizationId: "org-b" }];

    const { GET } = await import("@/app/api/admin/visio-permissions/route");
    const res = await GET(getReq(SPACE_B) as never);

    expect(res.status).toBe(404);
    expect((await res.json()).error).toBe("Espace introuvable");
    expect(mockMatrix).not.toHaveBeenCalled();
  });

  it("404 quand aucune organisation n'est résolue (fail-closed)", async () => {
    h.spaceRows = [{ organizationId: "org-a" }];
    mockOrg.mockResolvedValue(null);

    const { GET } = await import("@/app/api/admin/visio-permissions/route");
    const res = await GET(getReq(SPACE_A) as never);

    expect(res.status).toBe(404);
    expect(mockMatrix).not.toHaveBeenCalled();
  });

  it("200 pour un espace de l'organisation de la requête", async () => {
    h.spaceRows = [{ organizationId: "org-a" }];

    const { GET } = await import("@/app/api/admin/visio-permissions/route");
    const res = await GET(getReq(SPACE_A) as never);

    expect(res.status).toBe(200);
    expect(mockMatrix).toHaveBeenCalledWith(SPACE_A);
  });

  it("200 sans spaceId : la matrice par défaut n'appartient à aucun espace", async () => {
    const { GET } = await import("@/app/api/admin/visio-permissions/route");
    const res = await GET(getReq() as never);

    expect(res.status).toBe(200);
    expect(mockMatrix).toHaveBeenCalledWith(null);
  });
});

describe("PATCH /api/admin/visio-permissions : cloisonnement", () => {
  it("404 muet et aucune écriture pour un espace d'un autre tenant", async () => {
    h.spaceRows = [{ organizationId: "org-b" }];

    const { PATCH } = await import("@/app/api/admin/visio-permissions/route");
    const res = await PATCH(patchReq(SPACE_B) as never);

    expect(res.status).toBe(404);
    expect(mockSet).not.toHaveBeenCalled();
  });

  it("404 et aucune écriture pour un espace inexistant", async () => {
    h.spaceRows = [];

    const { PATCH } = await import("@/app/api/admin/visio-permissions/route");
    const res = await PATCH(patchReq(SPACE_B) as never);

    expect(res.status).toBe(404);
    expect(mockSet).not.toHaveBeenCalled();
  });

  it("chemin passant : écriture dans un espace de l'organisation de la requête", async () => {
    h.spaceRows = [{ organizationId: "org-a" }];

    const { PATCH } = await import("@/app/api/admin/visio-permissions/route");
    const res = await PATCH(patchReq(SPACE_A) as never);

    expect(res.status).toBe(200);
    expect(mockSet).toHaveBeenCalledWith(
      SPACE_A,
      "create_immediate",
      "viewer",
      true
    );
  });

  // La matrice par défaut n'a aucun espace à confronter : son rayon de souffle
  // est l'instance entière, puisque `checkVisioPermission` la consulte en repli
  // pour toutes les organisations. Sa portée se règle donc par le rôle.
  it("403 explicite et aucune écriture quand un admin d'organisation vise la matrice par défaut", async () => {
    const { PATCH } = await import("@/app/api/admin/visio-permissions/route");
    const res = await PATCH(patchReq(null) as never);

    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({
      error: "Action réservée à l'administration d'instance",
    });
    expect(mockSet).not.toHaveBeenCalled();
  });

  it("chemin passant : super_admin écrit la matrice par défaut", async () => {
    mockUser.mockResolvedValue({
      id: "super-1",
      name: "Instance",
      email: "super@instance.test",
      globalRole: "super_admin",
    } as never);

    const { PATCH } = await import("@/app/api/admin/visio-permissions/route");
    const res = await PATCH(patchReq(null) as never);

    expect(res.status).toBe(200);
    expect(mockSet).toHaveBeenCalledWith(
      null,
      "create_immediate",
      "viewer",
      true
    );
  });
});
