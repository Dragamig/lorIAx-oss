import { describe, it, expect, vi, beforeEach } from "vitest";
import { apiError } from "@/lib/api/response";

const authenticate = vi.fn();
const getMediaFull = vi.fn();
const resolveMediaAccess = vi.fn();
const send = vi.fn();

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
vi.mock("@/lib/db", () => ({ db: {} }));
vi.mock("@/lib/storage/s3", () => ({ s3Client: { send: (...a: unknown[]) => send(...a) }, BUCKET: "b" }));

import { GET } from "./route";

const ID = "11111111-1111-4111-8111-111111111111";
const row = {
  id: ID,
  storageKey: "k",
  filename: "a.png",
  mimeType: "image/png",
  deletedAt: null,
  updatedAt: new Date("2026-01-02T00:00:00.000Z"),
};
const stream = () => ({ transformToWebStream: () => new Response("0123456789").body });
const call = (headers: Record<string, string> = {}, id = ID) =>
  GET(new Request("http://x", { headers }), { params: Promise.resolve({ id }) });

function s3(size = 10) {
  send.mockImplementation(async (cmd: { constructor: { name: string } }) =>
    cmd.constructor.name === "HeadObjectCommand" ? { ContentLength: size } : { Body: stream() }
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  authenticate.mockResolvedValue({ user: { id: "u1", orgId: "org1", scopes: ["media:read"] } });
  getMediaFull.mockResolvedValue(row);
  resolveMediaAccess.mockResolvedValue({ allowed: true });
  s3();
});

describe("GET /api/v1/media/<id>/content", () => {
  it("401 sans clé, 403 sans portée", async () => {
    authenticate.mockResolvedValue({ error: apiError("Non autorisé", 401) });
    expect((await call()).status).toBe(401);
    authenticate.mockResolvedValue({ user: { id: "u1", orgId: "org1", scopes: [] } });
    expect((await call()).status).toBe(403);
  });

  it("404 silencieux : autre organisation, illisible, corbeille, id invalide", async () => {
    resolveMediaAccess.mockResolvedValue({ allowed: false, reason: "org" });
    expect((await call()).status).toBe(404);
    resolveMediaAccess.mockResolvedValue({ allowed: false, reason: "space" });
    expect((await call()).status).toBe(404);
    resolveMediaAccess.mockResolvedValue({ allowed: true });
    getMediaFull.mockResolvedValue({ ...row, deletedAt: new Date() });
    expect((await call()).status).toBe(404);
    expect((await call({}, "nope")).status).toBe(404);
    expect(send).not.toHaveBeenCalled();
  });

  it("200 inline avec nosniff pour une image", async () => {
    const res = await call();
    expect(res.status).toBe(200);
    expect(res.headers.get("x-content-type-options")).toBe("nosniff");
    expect(res.headers.get("content-type")).toBe("image/png");
    expect(res.headers.get("cache-control")).toBe("private, no-cache");
    expect(res.headers.get("content-disposition")).toMatch(/^inline/);
  });

  it("une ligne .png au type stocke menteur est servie image/png avec nosniff", async () => {
    for (const mimeType of ["image/svg+xml", "text/html"]) {
      getMediaFull.mockResolvedValue({ ...row, mimeType });
      const res = await call();
      expect(res.headers.get("content-type")).toBe("image/png");
      expect(res.headers.get("x-content-type-options")).toBe("nosniff");
    }
  });

  it("SVG et HTML : pièce jointe", async () => {
    for (const [mime, filename] of [["image/svg+xml", "a.svg"], ["text/html", "a.html"]]) {
      getMediaFull.mockResolvedValue({ ...row, mimeType: mime, filename });
      const res = await call();
      expect(res.headers.get("content-disposition")).toMatch(/^attachment/);
    }
  });

  it("Range valide : 206, invalide : 416", async () => {
    const ok = await call({ range: "bytes=0-4" });
    expect(ok.status).toBe(206);
    expect(ok.headers.get("content-range")).toBe("bytes 0-4/10");
    expect((await call({ range: "bytes=50-60" })).status).toBe(416);
    expect((await call({ range: "bogus" })).status).toBe(416);
  });
});
