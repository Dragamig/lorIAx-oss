import { describe, it, expect, vi, beforeEach } from "vitest";
import { apiError } from "@/lib/api/response";

const authenticate = vi.fn();
const listMedia = vi.fn();
const dbRows = vi.fn();

vi.mock("@/lib/api/auth-api", () => ({ authenticateApiRequest: (...a: unknown[]) => authenticate(...a) }));
vi.mock("@/lib/api/media-user", () => ({
  apiUserToSessionUser: async (u: { id: string }) => ({ id: u.id }),
  requireMediaScope: (u: { scopes: string[] | null }, s: string) =>
    u.scopes === null || u.scopes.includes(s) ? null : apiError(`Scope manquant : ${s}`, 403),
}));
vi.mock("@/lib/media/list", () => ({ listMedia: (...a: unknown[]) => listMedia(...a) }));
vi.mock("@/lib/db", () => ({
  db: { select: () => ({ from: () => ({ where: () => dbRows() }) }) },
}));

import { GET } from "./route";
import { encodeCursor } from "@/lib/media/filters";

const user = (scopes: string[] | null = ["media:read"]) => ({
  user: { id: "u1", orgId: "org1", scopes },
});
const req = (qs = "") => new Request(`http://x/api/v1/media${qs}`);
const ID = "11111111-1111-4111-8111-111111111111";

const item = {
  id: ID,
  filename: "a.png",
  title: null,
  altText: null,
  kind: "image",
  mimeType: "image/png",
  sizeBytes: 10,
  width: 1,
  height: 1,
  spaceId: null,
  spaceName: "interne",
  folderId: null,
  uploadedBy: "u2",
  uploaderName: "Bob",
  createdAt: "2026-01-01T00:00:00.000Z",
  deletedAt: null,
  purgeAt: null,
  url: `/api/media/${ID}`,
  thumbnailUrl: null,
  usageCount: 0,
  tags: [{ id: "t", label: "logo" }],
  canWrite: true,
  publicShared: false,
};

beforeEach(() => {
  vi.clearAllMocks();
  authenticate.mockResolvedValue(user());
  listMedia.mockResolvedValue({ items: [item], nextCursor: null });
  dbRows.mockResolvedValue([{ id: ID, updatedAt: new Date("2026-02-02T00:00:00.000Z") }]);
});

describe("GET /api/v1/media", () => {
  it("401 sans clé", async () => {
    authenticate.mockResolvedValue({ error: apiError("Non autorisé", 401) });
    expect((await GET(req())).status).toBe(401);
  });

  it("403 sans media:read", async () => {
    authenticate.mockResolvedValue(user(["documents:read"]));
    expect((await GET(req())).status).toBe(403);
    expect(listMedia).not.toHaveBeenCalled();
  });

  it("liste avec l'organisation de la clé, sans champ interne", async () => {
    const res = await GET(req());
    expect(res.status).toBe(200);
    expect(listMedia.mock.calls[0][1]).toBe("org1");
    const body = await res.json();
    expect(body.nextCursor).toBeNull();
    expect(body.data[0]).toMatchObject({
      id: ID,
      tags: ["logo"],
      url: `/api/media/${ID}`,
      contentUrl: `/api/v1/media/${ID}/content`,
      updatedAt: "2026-02-02T00:00:00.000Z",
    });
    const text = JSON.stringify(body);
    for (const k of ["storage_key", "storageKey", "organization_id", "organizationId", "checksum", "uploaded_by", "uploadedBy", "spaceName"]) {
      expect(text).not.toContain(k);
    }
  });

  it("ignore view=trash et uploadedBy", async () => {
    await GET(req("?view=trash&uploadedBy=" + ID));
    const f = listMedia.mock.calls[0][2];
    expect(f.view).toBe("all");
    expect(f.uploadedBy).toBeUndefined();
  });

  it("limit=100000 est ramené au plafond de 100", async () => {
    await GET(req("?limit=100000"));
    expect(listMedia.mock.calls[0][2].limit).toBe(100);
  });

  it("limit invalide : 400", async () => {
    expect((await GET(req("?limit=abc"))).status).toBe(400);
    expect((await GET(req("?limit=0"))).status).toBe(400);
  });

  it("type inconnu : 400", async () => {
    expect((await GET(req("?kind=exe"))).status).toBe(400);
  });

  it("curseur forgé : 400", async () => {
    expect((await GET(req("?cursor=zzz"))).status).toBe(400);
  });

  it("curseur d'un autre tri : 400", async () => {
    const c = encodeCursor("filename", "a", ID);
    expect((await GET(req(`?cursor=${c}`))).status).toBe(400);
  });

  it("FilterError levée par listMedia : 400", async () => {
    const { FilterError } = await import("@/lib/media/filters");
    listMedia.mockRejectedValue(new FilterError("Curseur invalide"));
    expect((await GET(req())).status).toBe(400);
  });

  it("tag est transmis comme filtre de tag", async () => {
    await GET(req("?tag=" + ID));
    expect(listMedia.mock.calls[0][2].tagIds).toEqual([ID]);
  });

  it("renvoie nextCursor", async () => {
    listMedia.mockResolvedValue({ items: [item], nextCursor: "abc" });
    const body = await (await GET(req())).json();
    expect(body.nextCursor).toBe("abc");
    expect(body.meta.hasMore).toBe(true);
  });
});
