import { describe, it, expect, vi, beforeEach } from "vitest";
import { apiError } from "@/lib/api/response";

const authenticate = vi.fn();
const ingest = vi.fn();
const writeAccess = vi.fn();

vi.mock("@/lib/api/auth-api", () => ({ authenticateApiRequest: (...a: unknown[]) => authenticate(...a) }));
vi.mock("@/lib/api/media-user", () => ({
  apiUserToSessionUser: async (u: { id: string }) => ({ id: u.id }),
  requireMediaScope: (u: { scopes: string[] | null }, s: string) =>
    u.scopes === null || u.scopes.includes(s) ? null : apiError(`Scope manquant : ${s}`, 403),
}));
vi.mock("@/lib/media/ingest", () => ({ ingestMedia: (...a: unknown[]) => ingest(...a) }));
vi.mock("@/lib/auth/check-access", () => ({ checkSpaceWriteAccess: (...a: unknown[]) => writeAccess(...a) }));
vi.mock("@/lib/api/v1-media", async (orig) => ({
  ...(await orig<typeof import("@/lib/api/v1-media")>()),
  getMediaTagLabels: async () => ["logo"],
  listItemsToV1: async () => [],
}));
vi.mock("@/lib/media/list", () => ({ listMedia: vi.fn() }));
vi.mock("@/lib/db", () => ({ db: {} }));
const rate = vi.fn();
vi.mock("@/lib/rate-limit", async (orig) => ({
  ...(await orig<typeof import("@/lib/rate-limit")>()),
  checkRateLimitAsync: (...a: unknown[]) => rate(...a),
}));

import { POST } from "./route";

const SPACE = "22222222-2222-4222-8222-222222222222";
const ID = "11111111-1111-4111-8111-111111111111";

const row = {
  id: ID,
  filename: "a.png",
  title: null,
  altText: null,
  kind: "image",
  mimeType: "image/png",
  sizeBytes: 3,
  width: 1,
  height: 1,
  spaceId: SPACE,
  folderId: null,
  storageKey: "secret/key.png",
  thumbnailKey: "secret/key.png.thumb.webp",
  checksumSha256: "abc",
  organizationId: "org1",
  uploadedBy: "u1",
  createdAt: new Date("2026-01-01T00:00:00.000Z"),
  updatedAt: new Date("2026-01-01T00:00:00.000Z"),
};

function req(opts: { file?: File | null; spaceId?: string | null; length?: number | null; tags?: string[] } = {}) {
  const fd = new FormData();
  const file = opts.file === undefined ? new File([new Uint8Array([1, 2, 3])], "a.png", { type: "image/png" }) : opts.file;
  if (file) fd.set("file", file);
  const space = opts.spaceId === undefined ? SPACE : opts.spaceId;
  if (space) fd.set("spaceId", space);
  for (const t of opts.tags ?? ["logo"]) fd.append("tags", t);
  const headers: Record<string, string> = {};
  if (opts.length !== null) headers["content-length"] = String(opts.length ?? 1000);
  return new Request("http://x/api/v1/media", { method: "POST", body: fd, headers });
}

beforeEach(() => {
  vi.clearAllMocks();
  authenticate.mockResolvedValue({ user: { id: "u1", orgId: "org1", scopes: ["media:write"] } });
  writeAccess.mockResolvedValue(true);
  ingest.mockResolvedValue({ ok: true, media: row, quota: {}, hasLocationExif: false });
  rate.mockResolvedValue({ success: true, remaining: 9, resetAt: Date.now() + 60_000 });
});

describe("POST /api/v1/media", () => {
  it("403 sans la portée media:write", async () => {
    authenticate.mockResolvedValue({ user: { id: "u1", orgId: "org1", scopes: ["media:read"] } });
    expect((await POST(req())).status).toBe(403);
    expect(ingest).not.toHaveBeenCalled();
  });

  it("renvoie la réponse d'authentification en erreur", async () => {
    authenticate.mockResolvedValue({ error: apiError("Non authentifié", 401) });
    expect((await POST(req())).status).toBe(401);
  });

  it("400 sans fichier ou sans spaceId valide", async () => {
    expect((await POST(req({ file: null }))).status).toBe(400);
    expect((await POST(req({ spaceId: null }))).status).toBe(400);
    expect((await POST(req({ spaceId: "pas-un-uuid" }))).status).toBe(400);
  });

  it("404 silencieux pour un espace d'une autre organisation ou non modifiable", async () => {
    writeAccess.mockResolvedValue(false);
    const res = await POST(req());
    expect(res.status).toBe(404);
    expect(writeAccess).toHaveBeenCalledWith({ id: "u1" }, SPACE, { orgId: "org1" });
    expect(ingest).not.toHaveBeenCalled();
  });

  it("413 au-delà de 50 Mo sans lire le contenu", async () => {
    const big = new File([new Uint8Array(51 * 1024 * 1024)], "a.png", { type: "image/png" });
    const res = await POST(req({ file: big }));
    expect(res.status).toBe(413);
    expect(ingest).not.toHaveBeenCalled();
  });

  it.each([
    [400, "Extension .exe non autorisée"],
    [415, "Type de fichier non reconnu"],
    [507, "Quota de stockage atteint"],
    [413, "Fichier trop volumineux (max 50 Mo)"],
  ])("reprend l'erreur %i d'ingestMedia au format v1", async (status, error) => {
    ingest.mockResolvedValue({ ok: false, status, error });
    const res = await POST(req());
    expect(res.status).toBe(status);
    expect(await res.json()).toEqual({ success: false, error });
  });

  it("201, origine upload, titulaire de la clé, sans clé de stockage", async () => {
    const res = await POST(req());
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.success).toBe(true);
    expect(body.data).toMatchObject({ id: ID, spaceId: SPACE, tags: ["logo"], url: `/api/media/${ID}` });
    const text = JSON.stringify(body);
    expect(text).not.toContain("secret/key");
    expect(text).not.toContain("storageKey");
    expect(text).not.toContain("thumbnailKey");
    const call = ingest.mock.calls[0][0];
    expect(call).toMatchObject({ user: { id: "u1" }, orgId: "org1", spaceId: SPACE, origin: "upload", validation: "default", tags: ["logo"] });
  });

  it("profil video pour un fichier video/*", async () => {
    await POST(req({ file: new File([new Uint8Array([1])], "a.mp4", { type: "video/mp4" }) }));
    expect(ingest.mock.calls[0][0].validation).toBe("video");
  });

  it("413 avant de lire le corps quand Content-Length dépasse le maximum", async () => {
    const r = req({ length: 300 * 1024 * 1024 });
    const spy = vi.spyOn(r, "formData");
    const res = await POST(r);
    expect(res.status).toBe(413);
    expect(spy).not.toHaveBeenCalled();
    expect(ingest).not.toHaveBeenCalled();
  });

  it("413 quand Content-Length est absent", async () => {
    const r = req({ length: null });
    const spy = vi.spyOn(r, "formData");
    const res = await POST(r);
    expect(res.status).toBe(413);
    expect(spy).not.toHaveBeenCalled();
  });

  it("400 sur trop de tags, libellé trop long ou slug vide, sans ingérer", async () => {
    const many = Array.from({ length: 21 }, (_, i) => `t${i}`);
    for (const tags of [many, ["x".repeat(121)], ["!!!"]]) {
      const res = await POST(req({ tags }));
      expect(res.status).toBe(400);
    }
    expect(ingest).not.toHaveBeenCalled();
  });

  it("le type MIME d'un fichier texte vient de l'extension, pas du client", async () => {
    const f = new File([new Uint8Array([1])], "a.svg", { type: "video/mp4" });
    await POST(req({ file: f }));
    const call = ingest.mock.calls[0][0];
    expect(call.validation).toBe("default");
    expect(call.file.type).toBe("image/svg+xml");
  });

  it("limite de débit : 429 au format v1", async () => {
    rate.mockResolvedValue({ success: false, remaining: 0, resetAt: Date.now() + 30_000 });
    const res = await POST(req());
    expect(res.status).toBe(429);
    expect(await res.json()).toEqual({ success: false, error: "Limite de requêtes dépassée" });
    expect(ingest).not.toHaveBeenCalled();
    expect(rate.mock.calls[0][0]).toContain("u1");
  });
});
