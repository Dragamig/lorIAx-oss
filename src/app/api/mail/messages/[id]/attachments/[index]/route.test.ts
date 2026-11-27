import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

const h = vi.hoisted(() => ({ visible: vi.fn(), media: vi.fn(), url: vi.fn() }));
vi.mock("@/lib/crm/access", () => ({
  requireCrm: async () => ({ ok: true, user: { id: "u1" }, orgId: "org1", isAdmin: false, enabled: true }),
}));
vi.mock("@/lib/mailing/threads", () => ({ getVisibleMail: (...a: unknown[]) => h.visible(...a) }));
vi.mock("@/lib/media/access", () => ({ getMediaFull: (...a: unknown[]) => h.media(...a) }));
vi.mock("@/lib/storage/s3", () => ({ getFileUrl: (...a: unknown[]) => h.url(...a) }));

import { GET } from "./route";

const ID = "44444444-4444-4444-8444-444444444444";
const call = (index = "0") =>
  GET(new NextRequest(`http://x/api/mail/messages/${ID}/attachments/${index}`), { params: Promise.resolve({ id: ID, index }) });
const upload = (key: string) => ({ source: "upload", storageKey: key, fileName: "a.pdf", mimeType: "application/pdf", size: 1 });

beforeEach(() => {
  h.visible.mockReset();
  h.media.mockReset();
  h.url.mockReset().mockResolvedValue("https://s3.example/signed");
});

describe("GET /api/mail/messages/[id]/attachments/[index]", () => {
  it("returns 404 for a mail of another organization or user (not visible)", async () => {
    h.visible.mockResolvedValue(null);
    expect((await call()).status).toBe(404);
    expect(h.visible).toHaveBeenCalledWith("org1", "u1", ID);
    expect(h.url).not.toHaveBeenCalled();
  });
  it("redirects to a signed url for an upload under the owner prefix", async () => {
    h.visible.mockResolvedValue({ userId: "u1", attachments: [upload("mail/org1/u1/x-a.pdf")] });
    const res = await call();
    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toBe("https://s3.example/signed");
    expect(h.url.mock.calls[0][0]).toBe("mail/org1/u1/x-a.pdf");
  });
  it("refuses a client-forged storage key outside the owner prefix", async () => {
    h.visible.mockResolvedValue({ userId: "u1", attachments: [upload("mail/org2/u9/secret.pdf")] });
    expect((await call()).status).toBe(404);
    expect(h.url).not.toHaveBeenCalled();
  });
  it("404 for an out of range index", async () => {
    h.visible.mockResolvedValue({ userId: "u1", attachments: [] });
    expect((await call("3")).status).toBe(404);
  });
  it("takes the media storage key from the database and refuses another organization", async () => {
    const att = { source: "media", mediaId: "55555555-5555-4555-8555-555555555555", storageKey: "forged", fileName: "m.png", mimeType: "image/png", size: 1 };
    h.visible.mockResolvedValue({ userId: "u1", attachments: [att] });
    h.media.mockResolvedValue({ organizationId: "org2", storageKey: "real" });
    expect((await call()).status).toBe(404);
    h.media.mockResolvedValue({ organizationId: "org1", storageKey: "real" });
    expect((await call()).status).toBe(302);
    expect(h.url.mock.calls[0][0]).toBe("real");
  });
  it("forces the response content type to application/octet-stream", async () => {
    h.visible.mockResolvedValue({ userId: "u1", attachments: [upload("mail/org1/u1/x-a.pdf")] });
    await call();
    expect(h.url.mock.calls[0][2]).toMatchObject({ contentType: "application/octet-stream" });
  });
  it("returns 404 on a malformed message id without any lookup", async () => {
    const res = await GET(new NextRequest("http://x/api/mail/messages/zzz/attachments/0"), {
      params: Promise.resolve({ id: "zzz", index: "0" }),
    });
    expect(res.status).toBe(404);
    expect(h.visible).not.toHaveBeenCalled();
  });
});
