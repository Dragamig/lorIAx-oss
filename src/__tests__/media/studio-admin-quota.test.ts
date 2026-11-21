import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

const h = vi.hoisted(() => ({
  uploadFile: vi.fn(),
  deleteFile: vi.fn(),
  txInsert: vi.fn(),
}));

vi.mock("@/lib/auth/get-user", () => ({
  getSessionUser: vi.fn().mockResolvedValue({ id: "u1", globalRole: "admin" }),
}));
vi.mock("@/lib/auth/require-org-scoped", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/auth/require-org-scoped")>()),
  requireOrgScoped: vi.fn().mockResolvedValue({
    user: { id: "u1", globalRole: "admin" },
    orgId: "org-1",
    orgSlug: "x",
  }),
}));
vi.mock("@/lib/auth/check-access", () => ({
  checkSpaceWriteAccess: vi.fn().mockResolvedValue(true),
  getSpacePermission: vi.fn().mockResolvedValue("editor"),
}));
vi.mock("@/lib/images/validate-upload", () => ({
  validateImageUpload: vi.fn(async (f: File) => ({
    ok: true,
    buffer: Buffer.from(await f.arrayBuffer()),
    contentType: "image/png",
    ext: "png",
  })),
}));
vi.mock("file-type", () => ({
  fileTypeFromBuffer: vi.fn().mockResolvedValue({ ext: "png", mime: "image/png" }),
}));
vi.mock("@/lib/media/image-processing", () => ({
  processImage: vi.fn().mockRejectedValue(new Error("pas de sharp")),
  sha256Hex: () => "0".repeat(64),
}));
vi.mock("@/lib/media/quota", () => ({
  checkUploadQuota: vi.fn().mockResolvedValue({ allowed: false, usedBytes: 99, limitBytes: 100 }),
}));
vi.mock("@/lib/activity", () => ({ logActivity: vi.fn() }));
vi.mock("@/lib/db", () => ({
  db: {
    transaction: async (cb: (tx: unknown) => Promise<unknown>) =>
      cb({ execute: vi.fn(), insert: h.txInsert }),
    select: vi.fn(),
    delete: vi.fn(),
    update: vi.fn(),
  },
}));
vi.mock("@/lib/storage/s3", () => ({ uploadFile: h.uploadFile, deleteFile: h.deleteFile }));

function form() {
  const fd = new FormData();
  fd.append("file", new File([new Uint8Array([1, 2, 3])], "logo.png", { type: "image/png" }));
  return fd;
}

beforeEach(() => vi.clearAllMocks());

describe("quota bloquant sur les routes d'images studio et admin", () => {
  it("POST /api/studio/images : 507 sans envoi S3 ni insertion", async () => {
    const { POST } = await import("@/app/api/studio/images/route");
    const res = await POST(
      new NextRequest("http://localhost/api/studio/images", { method: "POST", body: form() })
    );
    expect(res.status).toBe(507);
    expect(h.uploadFile).not.toHaveBeenCalled();
    expect(h.txInsert).not.toHaveBeenCalled();
    expect(h.deleteFile).not.toHaveBeenCalled();
  });

  it("POST /api/admin/images : 507 sans envoi S3 ni insertion", async () => {
    const { POST } = await import("@/app/api/admin/images/route");
    const res = await POST(
      new NextRequest("http://localhost/api/admin/images", { method: "POST", body: form() })
    );
    expect(res.status).toBe(507);
    expect(h.uploadFile).not.toHaveBeenCalled();
    expect(h.txInsert).not.toHaveBeenCalled();
    expect(h.deleteFile).not.toHaveBeenCalled();
  });
});
