import { describe, it, expect, vi, beforeEach } from "vitest";

const h = vi.hoisted(() => ({
  user: { id: "u1", email: "", name: "", globalRole: "editor", capabilities: [] } as unknown,
  orgId: "org-1" as string | null,
  ingest: vi.fn(),
}));

vi.mock("@/lib/auth/get-user", () => ({ getSessionUser: () => Promise.resolve(h.user) }));
vi.mock("@/lib/org/get-request-org", () => ({ getRequestOrgId: () => Promise.resolve(h.orgId) }));
vi.mock("@/lib/media/ingest", () => ({ ingestMedia: h.ingest }));

const MEDIA_ID = "3f2a9c1e-5b7d-4e8a-9c3b-1a2b3c4d5e6f";
const row = {
  id: MEDIA_ID,
  spaceId: "space-1",
  filename: "photo.png",
  mimeType: "image/png",
  sizeBytes: 8,
  storageKey: "space-1/abc.png",
  thumbnailKey: "space-1/abc.png.thumb.webp",
  uploadedBy: "u1",
};

function form(withSpace = true): FormData {
  const fd = new FormData();
  fd.append("file", new File([new Uint8Array(8)], "photo.png", { type: "image/png" }));
  if (withSpace) fd.append("spaceId", "space-1");
  return fd;
}
const req = (url: string, fd: FormData) =>
  new Request(url, { method: "POST", body: fd }) as never;

beforeEach(() => {
  vi.clearAllMocks();
  h.user = { id: "u1", email: "", name: "", globalRole: "editor", capabilities: [] };
  h.orgId = "org-1";
  h.ingest.mockResolvedValue({
    ok: true,
    media: row,
    quota: { allowed: true, warn: true, percentAfter: 85, usedBytes: 1, limitBytes: 2 },
    hasLocationExif: true,
  });
});

describe("POST /api/media", () => {
  it("401 sans session", async () => {
    h.user = null;
    const { POST } = await import("@/app/api/media/route");
    const res = await POST(req("http://localhost/api/media", form()));
    expect(res.status).toBe(401);
  });

  it("201 avec url /api/media/<uuid>, quota et indicateur GPS", async () => {
    const { POST } = await import("@/app/api/media/route");
    const res = await POST(req("http://localhost/api/media", form()));
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.url).toBe(`/api/media/${MEDIA_ID}`);
    expect(body.thumbnailUrl).toBe(`/api/media/${MEDIA_ID}/thumbnail`);
    expect(body.quota).toEqual({ warn: true, percentAfter: 85 });
    expect(body.hasLocationExif).toBe(true);
  });

  it("propage le refus de l'ingestion (507)", async () => {
    h.ingest.mockResolvedValue({ ok: false, status: 507, error: "Quota de stockage atteint" });
    const { POST } = await import("@/app/api/media/route");
    const res = await POST(req("http://localhost/api/media", form()));
    expect(res.status).toBe(507);
    expect((await res.json()).error).toBe("Quota de stockage atteint");
  });

  it("403 sans organisation résolue", async () => {
    h.orgId = null;
    const { POST } = await import("@/app/api/media/route");
    const res = await POST(req("http://localhost/api/media", form()));
    expect(res.status).toBe(403);
    expect(h.ingest).not.toHaveBeenCalled();
  });
});

describe("POST /api/attachments", () => {
  it("garde url /api/attachments/<clé> et ajoute mediaUrl", async () => {
    const { POST } = await import("@/app/api/attachments/route");
    const res = await POST(req("http://localhost/api/attachments", form()));
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.url).toBe("/api/attachments/space-1/abc.png");
    expect(body.mediaUrl).toBe(`/api/media/${MEDIA_ID}`);
  });

  it("spaceId reste obligatoire", async () => {
    const { POST } = await import("@/app/api/attachments/route");
    const res = await POST(req("http://localhost/api/attachments", form(false)));
    expect(res.status).toBe(400);
    expect(h.ingest).not.toHaveBeenCalled();
  });
});
