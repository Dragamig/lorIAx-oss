import { describe, it, expect, vi, beforeEach } from "vitest";
import type { MailAttachmentRef } from "@/lib/db/schema-mailing";

const h = vi.hoisted(() => ({
  read: vi.fn(),
  media: null as Record<string, unknown> | null,
  access: { allowed: true } as { allowed: boolean; reason?: string },
  accessCalls: [] as unknown[],
}));

vi.mock("@/lib/storage/s3", () => ({ readFileBytes: (k: string) => h.read(k) }));
vi.mock("@/lib/media/access", () => ({
  getMediaFull: async () => h.media,
  resolveMediaAccess: async (...a: unknown[]) => {
    h.accessCalls.push(a);
    return h.access;
  },
}));
vi.mock("@/lib/db", () => ({
  db: {
    select: () => ({
      from: () => ({
        where: () => ({
          limit: async () => [{ id: "u1", email: "e@x.fr", name: "N", globalRole: "editor", capabilities: [] }],
        }),
      }),
    }),
  },
}));

import { resolveAttachments, AttachmentError, MAX_MAIL_ATTACHMENTS_BYTES } from "../attachments";

const upload = (over: Partial<MailAttachmentRef> = {}): MailAttachmentRef => ({
  source: "upload",
  storageKey: "mail/org1/u1/abc-a.pdf",
  fileName: "a.pdf",
  mimeType: "application/pdf",
  size: 3,
  ...over,
});
const buf = (n: number) => Buffer.alloc(n, 1);

beforeEach(() => {
  vi.clearAllMocks();
  h.accessCalls.length = 0;
  h.read.mockResolvedValue(buf(3));
  h.access = { allowed: true };
  h.media = {
    id: "m1", organizationId: "org1", storageKey: "media/org1/x.png", filename: "x.png",
    mimeType: "image/png", sizeBytes: 3, deletedAt: null,
  };
});

describe("resolveAttachments", () => {
  it("reads an upload under the user prefix", async () => {
    const r = await resolveAttachments("org1", "u1", [upload()]);
    expect(r).toHaveLength(1);
    expect(r[0].content.length).toBe(3);
    expect(r[0].fileName).toBe("a.pdf");
  });

  it("refuses an upload key of another user or organization", async () => {
    for (const key of ["mail/org1/u2/abc-a.pdf", "mail/org2/u1/abc-a.pdf", "mail/org1/u1/../u2/a.pdf", "other/org1/u1/a"]) {
      await expect(resolveAttachments("org1", "u1", [upload({ storageKey: key })])).rejects.toMatchObject({
        code: "forbidden",
      });
    }
    expect(h.read).not.toHaveBeenCalled();
  });

  it("refuses a media of another organization (forbidden, muet)", async () => {
    h.media = { ...h.media!, organizationId: "org2" };
    const ref = upload({ source: "media", mediaId: "m1", storageKey: "media/org1/x.png" });
    await expect(resolveAttachments("org1", "u1", [ref])).rejects.toMatchObject({ code: "forbidden" });
    expect(h.read).not.toHaveBeenCalled();
  });

  it("refuses a media the user cannot read, or an unknown media", async () => {
    const ref = upload({ source: "media", mediaId: "m1" });
    h.access = { allowed: false, reason: "space" };
    await expect(resolveAttachments("org1", "u1", [ref])).rejects.toMatchObject({ code: "forbidden" });
    h.media = null;
    await expect(resolveAttachments("org1", "u1", [ref])).rejects.toMatchObject({ code: "forbidden" });
  });

  it("reads the media from the database key, not the client key", async () => {
    const ref = upload({ source: "media", mediaId: "m1", storageKey: "mail/org1/u1/forged" });
    await resolveAttachments("org1", "u1", [ref]);
    expect(h.read).toHaveBeenCalledWith("media/org1/x.png");
    expect(h.accessCalls[0]).toMatchObject({ 2: "read", 3: { orgId: "org1" } });
  });

  it("relit la clé courante du média si le fichier a été remplacé pendant la lecture", async () => {
    const ref = upload({ source: "media", mediaId: "m1" });
    h.read.mockImplementation(async (k: string) => {
      if (k === "media/org1/x.png") {
        h.media = { ...h.media!, storageKey: "media/org1/x-v2.png" };
        return null;
      }
      return buf(3);
    });
    const r = await resolveAttachments("org1", "u1", [ref]);
    expect(h.read).toHaveBeenLastCalledWith("media/org1/x-v2.png");
    expect(r[0].content.length).toBe(3);
  });

  it("requires a mediaId for a media source", async () => {
    await expect(resolveAttachments("org1", "u1", [upload({ source: "media" })])).rejects.toMatchObject({
      code: "forbidden",
    });
  });

  it("reports missing when S3 returns null or throws", async () => {
    h.read.mockResolvedValueOnce(null);
    await expect(resolveAttachments("org1", "u1", [upload()])).rejects.toMatchObject({ code: "missing" });
    h.read.mockRejectedValueOnce(new Error("NoSuchKey"));
    await expect(resolveAttachments("org1", "u1", [upload()])).rejects.toBeInstanceOf(AttachmentError);
  });

  it("refuses a total above 20 Mo", async () => {
    h.read.mockResolvedValue(buf(MAX_MAIL_ATTACHMENTS_BYTES / 2 + 1));
    await expect(
      resolveAttachments("org1", "u1", [upload({ size: 1 }), upload({ storageKey: "mail/org1/u1/b" })]),
    ).rejects.toMatchObject({ code: "too_large" });
  });

  it("refuses before reading when declared sizes already exceed the cap", async () => {
    await expect(
      resolveAttachments("org1", "u1", [upload({ size: MAX_MAIL_ATTACHMENTS_BYTES + 1 })]),
    ).rejects.toMatchObject({ code: "too_large" });
    expect(h.read).not.toHaveBeenCalled();
  });

  it("accepts exactly 20 Mo", async () => {
    h.read.mockResolvedValue(buf(MAX_MAIL_ATTACHMENTS_BYTES / 2));
    const r = await resolveAttachments("org1", "u1", [
      upload({ size: MAX_MAIL_ATTACHMENTS_BYTES / 2 }),
      upload({ storageKey: "mail/org1/u1/b", size: MAX_MAIL_ATTACHMENTS_BYTES / 2 }),
    ]);
    expect(r.reduce((s, a) => s + a.content.length, 0)).toBe(MAX_MAIL_ATTACHMENTS_BYTES);
  });
});
