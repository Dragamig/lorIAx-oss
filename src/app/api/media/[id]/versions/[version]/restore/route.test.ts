import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({ user: vi.fn(), org: vi.fn(), restore: vi.fn() }));
vi.mock("@/lib/auth/get-user", () => ({ getSessionUser: h.user }));
vi.mock("@/lib/org/get-request-org", () => ({ getRequestOrgId: h.org }));
vi.mock("@/lib/media/versions", () => ({ restoreVersion: h.restore }));

import { POST } from "./route";

const ID = "11111111-1111-4111-8111-111111111111";
const call = (body: unknown = { expectedVersion: 3 }, version = "1") =>
  POST(
    new Request("http://x", { method: "POST", body: JSON.stringify(body), headers: { "content-type": "application/json" } }),
    { params: Promise.resolve({ id: ID, version }) },
  );

beforeEach(() => {
  vi.clearAllMocks();
  h.user.mockResolvedValue({ id: "u1", globalRole: "member" });
  h.org.mockResolvedValue("org1");
  h.restore.mockResolvedValue({
    ok: true,
    media: { id: ID, storageKey: "secret/k", thumbnailKey: null, currentVersion: 4 },
    version: { id: "v", version: 4, storageKey: "secret/k2", thumbnailKey: null },
    quota: {},
    usages: 0,
  });
});

describe("POST /api/media/[id]/versions/[version]/restore", () => {
  it("401 sans session", async () => {
    h.user.mockResolvedValue(null);
    expect((await call()).status).toBe(401);
  });
  it("400 sans expectedVersion", async () => {
    expect((await call({})).status).toBe(400);
    expect(h.restore).not.toHaveBeenCalled();
  });
  it("200 : organisation du serveur, aucune clé exposée", async () => {
    const res = await call();
    expect(res.status).toBe(200);
    expect(h.restore).toHaveBeenCalledWith(
      expect.objectContaining({ orgId: "org1", mediaId: ID, version: 1, expectedVersion: 3 }),
    );
    expect(JSON.stringify(await res.json())).not.toContain("secret/");
  });
  it.each([403, 404, 409, 507])("relaie %i", async (status) => {
    h.restore.mockResolvedValue({ ok: false, status, error: "x" });
    expect((await call()).status).toBe(status);
  });
});
