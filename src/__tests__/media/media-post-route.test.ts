import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

const h = vi.hoisted(() => ({ ingest: vi.fn() }));

vi.mock("@/lib/auth/get-user", () => ({ getSessionUser: () => Promise.resolve({ id: "u1" }) }));
vi.mock("@/lib/org/get-request-org", () => ({ getRequestOrgId: () => Promise.resolve("o1") }));
vi.mock("@/lib/media/list", () => ({ listMedia: vi.fn() }));
// Ingestion réelle côté validation, sans stockage ni base.
vi.mock("@/lib/media/ingest", async () => {
  const { validateUpload } = await import("@/lib/media/validate-upload");
  return {
    ingestMedia: async (input: {
      file: { name: string; size: number; type: string };
      buffer: Buffer;
      validation?: "default" | "video";
    }) => {
      h.ingest(input.validation);
      const v = await validateUpload(input.file, input.buffer, input.validation ?? "default");
      if (!v.ok) return { ok: false, status: v.status, error: v.error };
      return {
        ok: true,
        media: { id: "m1", thumbnailKey: null, folderId: null },
        quota: { warn: false, percentAfter: 1 },
        hasLocationExif: false,
      };
    },
  };
});

const MB = 1024 * 1024;
function post(name: string, type: string, size: number) {
  const bytes = new Uint8Array(size);
  bytes.set([0, 0, 0, 0x18, 0x66, 0x74, 0x79, 0x70, 0x69, 0x73, 0x6f, 0x6d]); // ftypisom
  const form = new FormData();
  form.append("file", new File([bytes], name, { type }));
  return new NextRequest("http://x/api/media", { method: "POST", body: form });
}

beforeEach(() => h.ingest.mockClear());

describe("POST /api/media", () => {
  it("accepte une vidéo de 60 Mo avec le profil video", async () => {
    const { POST } = await import("@/app/api/media/route");
    const res = await POST(post("clip.mp4", "video/mp4", 60 * MB));
    expect(res.status).toBe(201);
    expect(h.ingest).toHaveBeenCalledWith("video");
  });
  it("refuse en 413 un fichier non vidéo de 60 Mo", async () => {
    const { POST } = await import("@/app/api/media/route");
    const res = await POST(post("big.png", "image/png", 60 * MB));
    expect(res.status).toBe(413);
    expect(h.ingest).toHaveBeenCalledWith("default");
  });
});
