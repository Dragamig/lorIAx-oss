import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({ user: vi.fn(), org: vi.fn(), del: vi.fn() }));
vi.mock("@/lib/auth/get-user", () => ({ getSessionUser: h.user }));
vi.mock("@/lib/org/get-request-org", () => ({ getRequestOrgId: h.org }));
vi.mock("@/lib/media/versions", () => ({ deleteVersion: h.del }));

import { DELETE } from "./route";

const ID = "11111111-1111-4111-8111-111111111111";
const VID = "22222222-2222-4222-8222-222222222222";
const call = (version = VID, qs = "") =>
  DELETE(new Request(`http://x${qs}`, { method: "DELETE" }), { params: Promise.resolve({ id: ID, version }) });

beforeEach(() => {
  vi.clearAllMocks();
  h.user.mockResolvedValue({ id: "u1", globalRole: "member" });
  h.org.mockResolvedValue("org1");
  h.del.mockResolvedValue({ ok: true, media: { id: ID, storageKey: "secret/k", thumbnailKey: null, currentVersion: 1 } });
});

describe("DELETE /api/media/[id]/versions/[version]", () => {
  it("401 sans session", async () => {
    h.user.mockResolvedValue(null);
    expect((await call()).status).toBe(401);
  });
  it("404 pour un id de version invalide", async () => {
    expect((await call("abc")).status).toBe(404);
    expect((await call("2")).status).toBe(404);
    expect(h.del).not.toHaveBeenCalled();
  });
  it("200 sans clé de stockage, organisation du serveur", async () => {
    const res = await call();
    expect(res.status).toBe(200);
    expect(h.del).toHaveBeenCalledWith(expect.objectContaining({ orgId: "org1", mediaId: ID, versionId: VID, requireCurrent: false }));
    expect(JSON.stringify(await res.json())).not.toContain("secret/k");
  });
  it("?requireCurrent=1 transmis au service", async () => {
    await call(VID, "?requireCurrent=1");
    expect(h.del).toHaveBeenCalledWith(expect.objectContaining({ versionId: VID, requireCurrent: true }));
  });
  it.each([403, 404, 409])("relaie %i (droit d'écriture, autre organisation, dernière version)", async (status) => {
    h.del.mockResolvedValue({ ok: false, status, error: "x" });
    expect((await call()).status).toBe(status);
  });
});
