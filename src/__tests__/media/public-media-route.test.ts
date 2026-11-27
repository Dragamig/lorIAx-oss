import { describe, it, expect, vi, beforeEach } from "vitest";

const ID = "3f2a9c1e-5b7d-4e8a-9c3b-1a2b3c4d5e6f";
const h = vi.hoisted(() => ({
  verdict: { allowed: false } as { allowed: boolean; row?: unknown },
  serve: vi.fn(),
  getUser: vi.fn(),
}));

vi.mock("@/lib/media/access", () => ({
  resolvePublicMediaAccess: () => Promise.resolve(h.verdict),
}));
vi.mock("@/lib/storage/s3", () => ({
  BUCKET: "b",
  s3Client: {
    send: vi.fn(async (cmd: { constructor: { name: string } }) =>
      cmd.constructor.name === "HeadObjectCommand"
        ? { ContentLength: 3 }
        : { Body: { transformToWebStream: () => new Response("abc").body } }
    ),
  },
}));
vi.mock("@aws-sdk/client-s3", () => ({
  HeadObjectCommand: class HeadObjectCommand {
    constructor(public input: unknown) {}
  },
  GetObjectCommand: class GetObjectCommand {
    constructor(public input: unknown) {}
  },
}));
vi.mock("@/lib/auth/get-user", () => ({ getSessionUser: h.getUser }));

const row = (mime: string, filename: string) => ({
  id: ID,
  storageKey: "s/" + filename,
  filename,
  mimeType: mime,
  updatedAt: new Date(1000),
});
const params = (id = ID, token = "tok") => ({ params: Promise.resolve({ token, id }) });
const req = () => new Request(`http://x/api/public/tok/media/${ID}`);

beforeEach(() => {
  vi.clearAllMocks();
  h.verdict = { allowed: false };
});

describe("GET /api/public/[token]/media/[id]", () => {
  it("404 uniforme pour un refus (révoqué, sans usage, autre org)", async () => {
    const { GET } = await import("@/app/api/public/[token]/media/[id]/route");
    const res = await GET(req(), params());
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: "Média introuvable" });
  });
  it("404 pour un id qui n'est pas un UUID", async () => {
    const { GET } = await import("@/app/api/public/[token]/media/[id]/route");
    expect((await GET(req(), params("pas-un-uuid"))).status).toBe(404);
  });
  it("200 sans session, Cache-Control public no-cache, nosniff", async () => {
    h.verdict = { allowed: true, row: row("image/png", "a.png") };
    const { GET } = await import("@/app/api/public/[token]/media/[id]/route");
    const res = await GET(req(), params());
    expect(res.status).toBe(200);
    expect(h.getUser).not.toHaveBeenCalled();
    expect(res.headers.get("Cache-Control")).toBe("public, no-cache");
    expect(res.headers.get("X-Content-Type-Options")).toBe("nosniff");
    expect(res.headers.get("Content-Disposition")).toMatch(/^inline/);
  });
  it("SVG intégré : 200 mais en pièce jointe", async () => {
    h.verdict = { allowed: true, row: row("image/svg+xml", "a.svg") };
    const { GET } = await import("@/app/api/public/[token]/media/[id]/route");
    const res = await GET(req(), params());
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Disposition")).toMatch(/^attachment/);
  });
});
