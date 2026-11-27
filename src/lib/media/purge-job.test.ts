import { describe, it, expect, vi, beforeEach } from "vitest";

const h = vi.hoisted(() => ({
  order: [] as string[],
  multipart: { aborted: 2, orphans: 1 },
  multipartFails: false,
}));

vi.mock("@/lib/media/purge", () => ({
  purgeExpiredTrash: vi.fn(async () => {
    h.order.push("purge");
    return { purged: 3, failed: [] };
  }),
}));
vi.mock("@/lib/media/notify", () => ({
  notifyTrashNearPurge: vi.fn(async () => ({ notified: 4 })),
}));
vi.mock("@/lib/media/stale-thumbnails", () => ({
  trashStaleDesignThumbnails: vi.fn(async () => ({ trashed: 5 })),
}));
vi.mock("@/lib/media/multipart", () => ({
  abortStaleMultipartUploads: vi.fn(async () => {
    h.order.push("multipart");
    if (h.multipartFails) throw new Error("db down");
    return h.multipart;
  }),
}));
vi.mock("@/lib/logger", () => ({ default: { info: vi.fn(), error: vi.fn(), warn: vi.fn() } }));

import { runMediaPurge, runMediaPurgeJob } from "./purge-job";

beforeEach(() => {
  h.order = [];
  h.multipartFails = false;
  delete process.env.MEDIA_PURGE_DISABLED;
  delete process.env.MEDIA_USAGE_SWEEP;
});

describe("runMediaPurge", () => {
  it("nettoie les envois multipart abandonnés et expose multipartAborted (expirés + orphelins)", async () => {
    const now = new Date("2026-11-26T03:00:00Z");
    const r = await runMediaPurge(now);
    expect(h.order).toEqual(["purge", "multipart"]);
    expect(r).toMatchObject({ purged: 3, notified: 4, thumbnailsTrashed: 5, multipartAborted: 3 });
  });

  it("l'enveloppe du job rend un statut failed sans exception si le nettoyage échoue", async () => {
    h.multipartFails = true;
    expect(await runMediaPurgeJob()).toEqual({ status: "failed" });
  });
});
