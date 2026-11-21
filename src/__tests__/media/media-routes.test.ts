import { describe, it, expect, vi, beforeEach } from "vitest";

const ID = "3f2a9c1e-5b7d-4e8a-9c3b-1a2b3c4d5e6f";
const h = vi.hoisted(() => ({
  user: { id: "u1" } as unknown,
  row: null as unknown,
  verdict: { allowed: true } as { allowed: boolean; reason?: string },
  serve: vi.fn(),
  signed: vi.fn(),
}));

vi.mock("@/lib/auth/get-user", () => ({ getSessionUser: () => Promise.resolve(h.user) }));
vi.mock("@/lib/media/access", () => ({
  getMediaFull: () => Promise.resolve(h.row),
  resolveMediaAccess: () => Promise.resolve(h.verdict),
}));
vi.mock("@/lib/media/serve", () => ({ serveMediaObject: h.serve }));
vi.mock("@/lib/storage/s3", () => ({ getFileUrl: h.signed }));

const row = {
  id: ID,
  storageKey: "s/a.png",
  thumbnailKey: "s/a.png.thumb.webp",
  filename: "a.png",
  mimeType: "image/png",
  updatedAt: new Date(1000),
};
const params = { params: Promise.resolve({ id: ID }) };
const req = () => new Request("http://x/api/media/" + ID);

beforeEach(() => {
  vi.clearAllMocks();
  h.user = { id: "u1" };
  h.row = row;
  h.verdict = { allowed: true };
  h.serve.mockResolvedValue(new Response("ok", { status: 200 }));
  h.signed.mockResolvedValue("https://signed");
});

describe("GET /api/media/[id]", () => {
  it("401 sans session", async () => {
    h.user = null;
    const { GET } = await import("@/app/api/media/[id]/route");
    expect((await GET(req(), params)).status).toBe(401);
  });
  it("404 pour une autre organisation, jamais 403", async () => {
    h.verdict = { allowed: false, reason: "org" };
    const { GET } = await import("@/app/api/media/[id]/route");
    expect((await GET(req(), params)).status).toBe(404);
  });
  it("404 si ligne absente", async () => {
    h.row = null;
    const { GET } = await import("@/app/api/media/[id]/route");
    expect((await GET(req(), params)).status).toBe(404);
  });
  it("403 pour un espace sans droit", async () => {
    h.verdict = { allowed: false, reason: "space" };
    const { GET } = await import("@/app/api/media/[id]/route");
    expect((await GET(req(), params)).status).toBe(403);
    expect(h.serve).not.toHaveBeenCalled();
  });
  it("200 pour un lecteur de l'espace", async () => {
    const { GET } = await import("@/app/api/media/[id]/route");
    expect((await GET(req(), params)).status).toBe(200);
    expect(h.serve).toHaveBeenCalledWith(
      expect.objectContaining({ key: "s/a.png", inline: true, maxAgeSeconds: 300 })
    );
  });
});

describe("GET /api/media/[id]/thumbnail", () => {
  it("404 sans thumbnail_key", async () => {
    h.row = { ...row, thumbnailKey: null };
    const { GET } = await import("@/app/api/media/[id]/thumbnail/route");
    expect((await GET(req(), params)).status).toBe(404);
    expect(h.serve).not.toHaveBeenCalled();
  });
  it("sert la miniature en webp, 24 h", async () => {
    const { GET } = await import("@/app/api/media/[id]/thumbnail/route");
    await GET(req(), params);
    expect(h.serve).toHaveBeenCalledWith(
      expect.objectContaining({ key: row.thumbnailKey, mime: "image/webp", maxAgeSeconds: 86400 })
    );
  });
});

describe("GET /api/media/[id]/signed", () => {
  it("n'appelle getFileUrl qu'après un accès accordé", async () => {
    const { GET } = await import("@/app/api/media/[id]/signed/route");
    h.verdict = { allowed: false, reason: "space" };
    expect((await GET(req(), params)).status).toBe(403);
    expect(h.signed).not.toHaveBeenCalled();
    h.verdict = { allowed: true };
    const res = await GET(req(), params);
    expect(await res.json()).toEqual({ url: "https://signed" });
    expect(h.signed).toHaveBeenCalledWith(
      "s/a.png",
      120,
      expect.objectContaining({ contentType: "image/png" })
    );
  });
  it("présigne en attachment pour un SVG, inline pour un PDF", async () => {
    const { GET } = await import("@/app/api/media/[id]/signed/route");
    h.row = { ...row, mimeType: "image/svg+xml", filename: "a.svg" };
    await GET(req(), params);
    expect(h.signed.mock.calls[0][2].contentDisposition).toMatch(/^attachment/);
    h.signed.mockClear();
    h.row = { ...row, mimeType: "application/pdf", filename: "a.pdf" };
    await GET(req(), params);
    expect(h.signed.mock.calls[0][2].contentDisposition).toMatch(/^inline/);
    expect(h.signed.mock.calls[0][2].contentType).toBe("application/pdf");
  });
});
