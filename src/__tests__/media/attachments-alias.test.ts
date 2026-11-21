import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";
import { media } from "@/lib/db/schema";

const ORG_A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const ORG_B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const SPACE_A = "11111111-1111-4111-8111-111111111111";
const MEDIA_ID = "99999999-9999-4999-8999-999999999999";

const h = vi.hoisted(() => ({
  rows: [] as unknown[],
  serve: vi.fn(),
  send: vi.fn(),
  signed: vi.fn(),
  spaceRead: vi.fn(),
  spaceWrite: vi.fn(),
}));

vi.mock("@/lib/db", () => ({
  db: {
    select: vi.fn(() => {
      let rows: unknown[] = [];
      const b = {
        from: vi.fn((t: unknown) => {
          rows = t === media ? h.rows : [];
          return b;
        }),
        where: vi.fn(() => b),
        limit: vi.fn(() => Promise.resolve(rows)),
      };
      return b;
    }),
  },
}));
vi.mock("@/lib/org/get-request-org", () => ({ getRequestOrgId: () => Promise.resolve(ORG_A) }));
vi.mock("@/lib/auth/get-user", () => ({
  getSessionUser: () => Promise.resolve({ id: "user-a", globalRole: "user" }),
}));
vi.mock("@/lib/auth/check-access", () => ({
  checkSpaceReadAccess: h.spaceRead,
  checkSpaceWriteAccess: h.spaceWrite,
}));
vi.mock("@/lib/media/serve", () => ({ serveMediaObject: h.serve }));
vi.mock("@/lib/storage/s3", () => ({
  s3Client: { send: h.send },
  BUCKET: "b",
  getFileUrl: h.signed,
}));
vi.mock("@aws-sdk/client-s3", () => ({
  GetObjectCommand: class {
    constructor(public input: unknown) {}
  },
}));

const row = (over: Record<string, unknown> = {}) => ({
  id: MEDIA_ID,
  organizationId: ORG_A,
  spaceId: SPACE_A,
  uploadedBy: "someone",
  deletedAt: null,
  origin: "upload",
  mimeType: "application/pdf",
  storageKey: `${SPACE_A}/doc.pdf`,
  filename: "doc.pdf",
  updatedAt: new Date(1000),
  ...over,
});

async function get(key: string) {
  const { GET } = await import("@/app/api/attachments/[...key]/route");
  return GET(new NextRequest(`http://localhost/api/attachments/${key}`), {
    params: Promise.resolve({ key: key.split("/") }),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  h.rows = [];
  h.spaceRead.mockResolvedValue(true);
  h.spaceWrite.mockResolvedValue(false);
  h.serve.mockResolvedValue(new Response("ok", { status: 200 }));
  h.signed.mockResolvedValue("https://signed");
  h.send.mockResolvedValue({
    Body: { transformToByteArray: async () => new Uint8Array([1]) },
    ContentType: "image/png",
  });
});

describe("alias /api/attachments/[...key]", () => {
  it("403 pour une clé inconnue", async () => {
    expect((await get("inconnu/x.png")).status).toBe(403);
    expect(h.serve).not.toHaveBeenCalled();
  });
  it("403 pour une clé contenant ..", async () => {
    h.rows = [row()];
    expect((await get(`${SPACE_A}/../x.pdf`)).status).toBe(403);
    expect(h.serve).not.toHaveBeenCalled();
  });
  it("403 sous studio/ et designs/ même avec une ligne media", async () => {
    h.rows = [row()];
    expect((await get("studio/o/x.png")).status).toBe(403);
    expect((await get("designs/generated/a.png")).status).toBe(403);
    expect(h.serve).not.toHaveBeenCalled();
  });
  it("200 en flux pour une clé media avec accès", async () => {
    h.rows = [row()];
    const res = await get(`${SPACE_A}/doc.pdf`);
    expect(res.status).toBe(200);
    expect(h.serve).toHaveBeenCalledWith(
      expect.objectContaining({ key: `${SPACE_A}/doc.pdf`, inline: true })
    );
    expect(h.send).not.toHaveBeenCalled();
  });
  it("403 pour un utilisateur d'une autre organisation", async () => {
    h.rows = [row({ organizationId: ORG_B })];
    expect((await get(`${SPACE_A}/doc.pdf`)).status).toBe(403);
    expect(h.serve).not.toHaveBeenCalled();
  });
  it("403 pour un média en corbeille et un simple lecteur", async () => {
    h.rows = [row({ deletedAt: new Date() })];
    expect((await get(`${SPACE_A}/doc.pdf`)).status).toBe(403);
    expect(h.serve).not.toHaveBeenCalled();
  });
  it("200 inchangé pour avatars/ sans ligne media (chemin historique)", async () => {
    const res = await get("avatars/u.png");
    expect(res.status).toBe(200);
    expect(h.serve).not.toHaveBeenCalled();
    expect(h.send).toHaveBeenCalled();
  });
});

describe("GET /api/attachments/signed", () => {
  async function signed(key: string) {
    const { GET } = await import("@/app/api/attachments/signed/route");
    return GET(
      new NextRequest(`http://localhost/api/attachments/signed?key=${encodeURIComponent(key)}`)
    );
  }
  it("signe avec disposition attachment pour un SVG", async () => {
    h.rows = [row({ mimeType: "image/svg+xml", filename: "a.svg", storageKey: `${SPACE_A}/a.svg` })];
    expect((await signed(`${SPACE_A}/a.svg`)).status).toBe(200);
    const opts = h.signed.mock.calls[0][2];
    expect(opts.contentType).toBe("application/octet-stream");
    expect(opts.contentDisposition).toMatch(/^attachment/);
  });
  it("signe en inline pour un PDF", async () => {
    h.rows = [row()];
    await signed(`${SPACE_A}/doc.pdf`);
    expect(h.signed.mock.calls[0][2].contentDisposition).toMatch(/^inline/);
  });
  it("sans ligne media : comportement inchangé", async () => {
    await signed("avatars/u.png");
    expect(h.signed).toHaveBeenCalledWith(
      "avatars/u.png",
      120,
      expect.objectContaining({ contentType: "image/png" })
    );
  });
});
