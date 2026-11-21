import { describe, it, expect, vi, beforeEach } from "vitest";

const mocks = vi.hoisted(() => ({
  getSessionUser: vi.fn(),
  getRequestOrgId: vi.fn(),
  assertSpaceQuota: vi.fn(),
  insertSpace: vi.fn(),
  afterSpaceCreated: vi.fn(),
}));

vi.mock("@/lib/db", () => ({ db: {} }));
vi.mock("@/lib/auth/get-user", () => ({ getSessionUser: mocks.getSessionUser }));
vi.mock("@/lib/org/get-request-org", () => ({ getRequestOrgId: mocks.getRequestOrgId }));
vi.mock("@/lib/spaces/create-space", () => ({
  assertSpaceQuota: mocks.assertSpaceQuota,
  insertSpace: mocks.insertSpace,
  afterSpaceCreated: mocks.afterSpaceCreated,
}));
vi.mock("@/lib/logger", () => {
  const l = { warn: vi.fn(), error: vi.fn(), info: vi.fn(), child: () => l };
  return { default: l };
});

import { POST } from "@/app/api/spaces/route";

const post = (body: unknown) =>
  POST(new Request("http://x/api/spaces", { method: "POST", body: JSON.stringify(body) }));

describe("POST /api/spaces", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getSessionUser.mockResolvedValue({ id: "u1", globalRole: "admin" });
    mocks.getRequestOrgId.mockResolvedValue("org1");
    mocks.assertSpaceQuota.mockResolvedValue({ exceeded: false, current: 1, max: 5 });
    mocks.insertSpace.mockResolvedValue({ id: "s1", name: "Espace", organizationId: "org1" });
    mocks.afterSpaceCreated.mockResolvedValue({ gitOk: true });
  });

  it("garde 403 quota, 403 type organization non admin, 201 nominal, 404 sans organisation", async () => {
    mocks.assertSpaceQuota.mockResolvedValueOnce({ exceeded: true, current: 5, max: 5 });
    let res = await post({ name: "Espace", type: "team" });
    expect(res.status).toBe(403);
    expect((await res.json()).error).toBe("Quota d'espaces atteint (5/5). Mettez à niveau votre licence.");
    expect(mocks.insertSpace).not.toHaveBeenCalled();

    mocks.getSessionUser.mockResolvedValueOnce({ id: "u2", globalRole: "member" });
    res = await post({ name: "Espace", type: "organization" });
    expect(res.status).toBe(403);
    expect((await res.json()).error).toBe("Seuls les administrateurs peuvent créer des espaces d'organisation");

    res = await post({ name: "Espace", type: "team" });
    expect(res.status).toBe(201);
    expect(await res.json()).toEqual({ id: "s1", name: "Espace", organizationId: "org1" });
    expect(mocks.insertSpace).toHaveBeenCalledWith(
      {},
      { orgId: "org1", userId: "u1", name: "Espace", type: "team", description: undefined, icon: undefined, ownerTeamId: undefined },
    );
    expect(mocks.afterSpaceCreated).toHaveBeenCalledWith(expect.objectContaining({ id: "s1" }), "u1");

    mocks.getRequestOrgId.mockResolvedValueOnce(null);
    res = await post({ name: "Espace", type: "team" });
    expect(res.status).toBe(404);
    expect((await res.json()).error).toBe("Organisation introuvable");
  });

  it("un espace personnel ne consulte pas le quota", async () => {
    const res = await post({ name: "Perso", type: "personal" });
    expect(res.status).toBe(201);
    expect(mocks.assertSpaceQuota).not.toHaveBeenCalled();
  });

  it("500 si l'insertion échoue, 500 si le dépôt git échoue", async () => {
    mocks.insertSpace.mockRejectedValueOnce(new Error("db"));
    let res = await post({ name: "Espace", type: "team" });
    expect(res.status).toBe(500);
    expect((await res.json()).error).toBe("Erreur lors de la création de l'espace dans la base de données");

    mocks.afterSpaceCreated.mockResolvedValueOnce({ gitOk: false });
    res = await post({ name: "Espace", type: "team" });
    expect(res.status).toBe(500);
    expect((await res.json()).error).toBe("Erreur lors de l'initialisation du repository git");
  });
});
