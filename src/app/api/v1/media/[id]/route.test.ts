import { describe, it, expect, vi, beforeEach } from "vitest";
import { apiError } from "@/lib/api/response";

const authenticate = vi.fn();
const getMediaFull = vi.fn();
const resolveMediaAccess = vi.fn();

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
vi.mock("@/lib/db", () => ({
  db: {
    select: () => ({
      from: () => ({
        innerJoin: () => ({ where: () => ({ orderBy: async () => [{ label: "logo" }] }) }),
        where: async () => [{ n: 3 }],
      }),
    }),
  },
}));

import { GET } from "./route";

const ID = "11111111-1111-4111-8111-111111111111";
const row = {
  id: ID,
  organizationId: "org1",
  storageKey: "secret/key",
  checksumSha256: "abc",
  uploadedBy: "u2",
  filename: "a.png",
  title: null,
  altText: "alt",
  kind: "image",
  mimeType: "image/png",
  sizeBytes: 12,
  width: 2,
  height: 3,
  spaceId: "s1",
  folderId: null,
  deletedAt: null,
  createdAt: new Date("2026-01-01T00:00:00.000Z"),
  updatedAt: new Date("2026-01-02T00:00:00.000Z"),
  currentVersion: 3,
};
const call = (id = ID) => GET(new Request("http://x"), { params: Promise.resolve({ id }) });

beforeEach(() => {
  vi.clearAllMocks();
  authenticate.mockResolvedValue({ user: { id: "u1", orgId: "org1", scopes: ["media:read"] } });
  getMediaFull.mockResolvedValue(row);
  resolveMediaAccess.mockResolvedValue({ allowed: true });
});

describe("GET /api/v1/media/<id>", () => {
  it("401 sans clé", async () => {
    authenticate.mockResolvedValue({ error: apiError("Non autorisé", 401) });
    expect((await call()).status).toBe(401);
  });

  it("403 sans media:read", async () => {
    authenticate.mockResolvedValue({ user: { id: "u1", orgId: "org1", scopes: [] } });
    expect((await call()).status).toBe(403);
  });

  it("200 avec métadonnées, sans champ interne, organisation de la clé passée au résolveur", async () => {
    const res = await call();
    expect(res.status).toBe(200);
    expect(resolveMediaAccess.mock.calls[0][3]).toEqual({ orgId: "org1" });
    const body = await res.json();
    expect(body.data).toMatchObject({ id: ID, tags: ["logo"], altText: "alt", contentUrl: `/api/v1/media/${ID}/content`, currentVersion: 3, versionCount: 3 });
    const text = JSON.stringify(body);
    for (const k of ["storage", "secret/key", "organization", "checksum", "uploaded"]) expect(text).not.toContain(k);
  });

  it("404 : identifiant invalide, inconnu, autre organisation, illisible, corbeille", async () => {
    expect((await call("pas-un-uuid")).status).toBe(404);
    getMediaFull.mockResolvedValue(null);
    expect((await call()).status).toBe(404);
    getMediaFull.mockResolvedValue(row);
    resolveMediaAccess.mockResolvedValue({ allowed: false, reason: "org" });
    expect((await call()).status).toBe(404);
    resolveMediaAccess.mockResolvedValue({ allowed: false, reason: "space" });
    expect((await call()).status).toBe(404);
    resolveMediaAccess.mockResolvedValue({ allowed: true });
    getMediaFull.mockResolvedValue({ ...row, deletedAt: new Date() });
    expect((await call()).status).toBe(404);
  });
});
