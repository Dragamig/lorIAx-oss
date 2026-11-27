import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  user: vi.fn(),
  org: vi.fn(),
  getMediaFull: vi.fn(),
  access: vi.fn(),
  list: vi.fn(),
  replace: vi.fn(),
  authors: vi.fn(),
}));
vi.mock("@/lib/auth/get-user", () => ({ getSessionUser: h.user }));
vi.mock("@/lib/org/get-request-org", () => ({ getRequestOrgId: h.org }));
vi.mock("@/lib/media/access", () => ({ getMediaFull: h.getMediaFull, resolveMediaAccess: h.access }));
vi.mock("@/lib/media/versions", () => ({ listVersions: h.list, replaceMediaFile: h.replace, listVersionAuthors: h.authors }));

import { GET, POST } from "./route";

const ID = "11111111-1111-4111-8111-111111111111";
const row = { id: ID, organizationId: "org1", currentVersion: 2 };
const ver = { id: "v-2", mediaId: ID, version: 2, storageKey: "secret/k", thumbnailKey: "secret/k.thumb.webp", filename: "a.png" };
const ctx = { params: Promise.resolve({ id: ID }) };

function post(fields: Record<string, string> = { expectedVersion: "2" }, file: File | null = new File([new Uint8Array([1])], "a.png", { type: "image/png" })) {
  const fd = new FormData();
  if (file) fd.set("file", file);
  for (const [k, v] of Object.entries(fields)) fd.set(k, v);
  return new Request(`http://x/api/media/${ID}/versions`, { method: "POST", body: fd });
}

beforeEach(() => {
  vi.clearAllMocks();
  h.user.mockResolvedValue({ id: "u1", globalRole: "member" });
  h.org.mockResolvedValue("org1");
  h.getMediaFull.mockResolvedValue(row);
  h.access.mockResolvedValue({ allowed: true });
  h.list.mockResolvedValue([ver]);
  h.authors.mockResolvedValue(new Map([["u9", "Camille"]]));
  h.replace.mockResolvedValue({
    ok: true,
    media: { ...row, storageKey: "secret/k", thumbnailKey: null },
    version: ver,
    quota: { warn: false },
    usages: 3,
  });
});

describe("GET /api/media/[id]/versions", () => {
  it("401 sans session", async () => {
    h.user.mockResolvedValue(null);
    expect((await GET(new Request("http://x") as never, ctx)).status).toBe(401);
  });
  it("404 muet pour un média d'une autre organisation", async () => {
    h.access.mockResolvedValue({ allowed: false, reason: "org" });
    expect((await GET(new Request("http://x") as never, ctx)).status).toBe(404);
    expect(h.list).not.toHaveBeenCalled();
  });
  it("liste sans clé de stockage, filtrée par l'organisation du média", async () => {
    const res = await GET(new Request("http://x") as never, ctx);
    expect(res.status).toBe(200);
    expect(h.list).toHaveBeenCalledWith(ID, "org1");
    const text = JSON.stringify(await res.json());
    expect(text).toContain('"currentVersion":2');
    expect(text).not.toContain("secret/k");
  });
  it("joint le nom de l'auteur, filtré par l'organisation du média", async () => {
    h.list.mockResolvedValue([{ ...ver, createdBy: "u9" }, { ...ver, id: "v-1", version: 1, createdBy: "autre" }]);
    const body = (await (await GET(new Request("http://x") as never, ctx)).json()) as { versions: { createdByName: string | null }[] };
    expect(h.authors).toHaveBeenCalledWith("org1", expect.any(Array));
    expect(body.versions.map((v) => v.createdByName)).toEqual(["Camille", null]);
  });
});

describe("POST /api/media/[id]/versions", () => {
  it("401 sans session", async () => {
    h.user.mockResolvedValue(null);
    expect((await POST(post() as never, ctx)).status).toBe(401);
  });
  it("400 sans fichier ou sans expectedVersion valide", async () => {
    expect((await POST(post({ expectedVersion: "2" }, null) as never, ctx)).status).toBe(400);
    expect((await POST(post({ expectedVersion: "abc" }) as never, ctx)).status).toBe(400);
    expect(h.replace).not.toHaveBeenCalled();
  });
  it("413 au-delà de 50 Mo pour un fichier non vidéo", async () => {
    const big = new File([new Uint8Array(51 * 1024 * 1024)], "a.png", { type: "image/png" });
    expect((await POST(post({ expectedVersion: "2" }, big) as never, ctx)).status).toBe(413);
    expect(h.replace).not.toHaveBeenCalled();
  });
  it("200 avec { media, version, quota, usages } sans clé de stockage", async () => {
    const res = await POST(post({ expectedVersion: "2", comment: "logo v2" }) as never, ctx);
    expect(res.status).toBe(200);
    const call = h.replace.mock.calls[0][0];
    expect(call).toMatchObject({ orgId: "org1", mediaId: ID, expectedVersion: 2, comment: "logo v2" });
    const body = await res.json();
    expect(Object.keys(body).sort()).toEqual(["media", "quota", "usages", "version"]);
    expect(JSON.stringify(body)).not.toContain("secret/k");
  });
  it.each([403, 404, 409, 415, 507])("relaie le code %i du service", async (status) => {
    h.replace.mockResolvedValue({ ok: false, status, error: "x" });
    expect((await POST(post() as never, ctx)).status).toBe(status);
  });
  it("isolation : l'organisation vient du serveur, jamais du corps", async () => {
    await POST(post({ expectedVersion: "2", organizationId: "org-autre", orgId: "org-autre" }) as never, ctx);
    expect(h.replace.mock.calls[0][0].orgId).toBe("org1");
  });
});
