import { describe, it, expect, vi, beforeEach } from "vitest";
import { apiError } from "@/lib/api/response";

const authenticate = vi.fn();
const getMediaFull = vi.fn();
const resolveMediaAccess = vi.fn();
const list = vi.fn();
const replace = vi.fn();
const rate = vi.fn();

vi.mock("@/lib/api/auth-api", () => ({ authenticateApiRequest: (...a: unknown[]) => authenticate(...a) }));
vi.mock("@/lib/api/media-user", () => ({
  apiUserToSessionUser: async (u: { id: string }) => ({ id: u.id }),
  requireMediaScope: (u: { scopes: string[] | null }, s: string) =>
    u.scopes === null || u.scopes.includes(s) ? null : apiError(`Scope manquant : ${s}`, 403),
}));
vi.mock("@/lib/media/access", () => ({
  getMediaFull: (...a: unknown[]) => getMediaFull(...a),
  resolveMediaAccess: (...a: unknown[]) => resolveMediaAccess(...a),
}));
vi.mock("@/lib/media/versions", () => ({
  listVersions: (...a: unknown[]) => list(...a),
  replaceMediaFile: (...a: unknown[]) => replace(...a),
}));
vi.mock("@/lib/api/v1-media", async (orig) => ({
  ...(await orig<typeof import("@/lib/api/v1-media")>()),
  getMediaTagLabels: async () => ["logo"],
}));
vi.mock("@/lib/db", () => ({ db: {} }));
vi.mock("@/lib/rate-limit", async (orig) => ({
  ...(await orig<typeof import("@/lib/rate-limit")>()),
  checkRateLimitAsync: (...a: unknown[]) => rate(...a),
}));

import { GET, POST } from "./route";

const ID = "11111111-1111-4111-8111-111111111111";
const row = {
  id: ID, organizationId: "org1", storageKey: "secret/key", thumbnailKey: null, checksumSha256: "abc",
  uploadedBy: "u2", filename: "a.png", title: null, altText: null, kind: "image", mimeType: "image/png",
  sizeBytes: 12, width: 2, height: 3, spaceId: "s1", folderId: null, deletedAt: null, currentVersion: 2,
  createdAt: new Date("2026-01-01T00:00:00.000Z"), updatedAt: new Date("2026-01-02T00:00:00.000Z"),
};
const ver = { id: "v2", mediaId: ID, version: 2, storageKey: "secret/key", thumbnailKey: null, filename: "a.png", createdBy: "u2" };
const ctx = { params: Promise.resolve({ id: ID }) };

function post(fields: Record<string, string> = { expectedVersion: "2" }, length: number | null = 1000) {
  const fd = new FormData();
  fd.set("file", new File([new Uint8Array([1, 2, 3])], "a.png", { type: "image/png" }));
  for (const [k, v] of Object.entries(fields)) fd.set(k, v);
  const headers: Record<string, string> = {};
  if (length !== null) headers["content-length"] = String(length);
  return new Request("http://x", { method: "POST", body: fd, headers });
}

beforeEach(() => {
  vi.clearAllMocks();
  authenticate.mockResolvedValue({ user: { id: "u1", orgId: "org1", scopes: ["media:read", "media:write"] } });
  getMediaFull.mockResolvedValue(row);
  resolveMediaAccess.mockResolvedValue({ allowed: true });
  list.mockResolvedValue([ver]);
  rate.mockResolvedValue({ success: true });
  replace.mockResolvedValue({ ok: true, media: row, version: ver, quota: { warn: false, percentAfter: 4, usedBytes: 1 }, usages: 1 });
});

describe("GET /api/v1/media/<id>/versions", () => {
  it("401 sans clé, 403 sans media:read", async () => {
    authenticate.mockResolvedValue({ error: apiError("Non autorisé", 401) });
    expect((await GET(new Request("http://x"), ctx)).status).toBe(401);
    authenticate.mockResolvedValue({ user: { id: "u1", orgId: "org1", scopes: [] } });
    expect((await GET(new Request("http://x"), ctx)).status).toBe(403);
  });
  it("404 muet pour un média d'une autre organisation", async () => {
    resolveMediaAccess.mockResolvedValue({ allowed: false, reason: "org" });
    expect((await GET(new Request("http://x"), ctx)).status).toBe(404);
    expect(list).not.toHaveBeenCalled();
  });
  it("liste avec currentVersion, sans clé de stockage ni auteur", async () => {
    const res = await GET(new Request("http://x"), ctx);
    expect(res.status).toBe(200);
    expect(list).toHaveBeenCalledWith(ID, "org1");
    const body = await res.json();
    expect(body.data.currentVersion).toBe(2);
    const text = JSON.stringify(body);
    expect(text).not.toContain("secret/key");
    expect(text).not.toContain("createdBy");
  });
});

describe("POST /api/v1/media/<id>/versions", () => {
  it("403 sans media:write, service jamais appelé", async () => {
    authenticate.mockResolvedValue({ user: { id: "u1", orgId: "org1", scopes: ["media:read"] } });
    expect((await POST(post(), ctx)).status).toBe(403);
    expect(replace).not.toHaveBeenCalled();
  });
  it("429 quand la limite est dépassée", async () => {
    rate.mockResolvedValue({ success: false });
    expect((await POST(post(), ctx)).status).toBe(429);
  });
  it("413 sans content-length ou trop gros, 400 sans expectedVersion", async () => {
    expect((await POST(post({ expectedVersion: "2" }, null), ctx)).status).toBe(413);
    expect((await POST(post({ expectedVersion: "2" }, 999_999_999), ctx)).status).toBe(413);
    expect((await POST(post({}), ctx)).status).toBe(400);
  });
  it("201 nominal : organisation de la clé, currentVersion, aucun champ interne", async () => {
    const res = await POST(post({ expectedVersion: "2", comment: "c" }), ctx);
    expect(res.status).toBe(201);
    expect(replace.mock.calls[0][0]).toMatchObject({ orgId: "org1", mediaId: ID, expectedVersion: 2, comment: "c" });
    const body = await res.json();
    expect(body.data.media.currentVersion).toBe(2);
    const text = JSON.stringify(body);
    for (const k of ["secret/key", "organizationId", "checksum", "uploadedBy", "createdBy"]) expect(text).not.toContain(k);
  });
  it.each([403, 404, 409, 415, 507])("relaie %i au format v1 (404 : autre organisation)", async (status) => {
    replace.mockResolvedValue({ ok: false, status, error: "x" });
    const res = await POST(post(), ctx);
    expect(res.status).toBe(status);
    expect(await res.json()).toEqual({ success: false, error: "x" });
  });
});
