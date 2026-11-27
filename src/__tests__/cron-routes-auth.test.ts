import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const indexKbFromDisk = vi.fn(async () => ({ indexed: 1 }));
vi.mock("@/lib/kb/kb", () => ({
  ensureKbSchema: vi.fn(async () => undefined),
  indexKbFromDisk: (...a: unknown[]) => indexKbFromDisk(...(a as [])),
  kbIndexVerdict: vi.fn(() => ({ ok: true, reason: "ok" })),
}));
vi.mock("@/lib/logger", () => ({ default: { error: vi.fn(), info: vi.fn(), warn: vi.fn() } }));
const runSweep = vi.fn(async () => ({ documents: 0, rows: 0, videos: 0, brandKits: 0, hasMore: false }));
vi.mock("@/lib/media/usage-sweep", () => ({ runMediaUsageSweep: () => runSweep() }));
const purgeExpired = vi.fn(async () => ({ purged: 0, skipped: 0, failed: [] }));
vi.mock("@/lib/media/purge", () => ({ purgeExpiredTrash: () => purgeExpired() }));
vi.mock("@/lib/media/notify", () => ({ notifyTrashNearPurge: vi.fn(async () => ({ notified: 0 })) }));
vi.mock("@/lib/media/multipart", () => ({ abortStaleMultipartUploads: async () => ({ aborted: 0, orphans: 0 }) }));
vi.mock("@/lib/media/stale-thumbnails", () => ({ trashStaleDesignThumbnails: async () => ({ trashed: 0 }) }));
const purgeHistory = vi.fn(async () => ({ purged: 0 }));
vi.mock("@/lib/databases/row-history-purge", () => ({ purgeDeletedRowHistory: () => purgeHistory() }));
const processReminders = vi.fn(async () => 3);
vi.mock("@/lib/calendar/notifications", () => ({
  processReminders: () => processReminders(),
}));

import { POST as kbIndex } from "@/app/api/cron/kb-index/route";
import { POST as mediaUsages } from "@/app/api/cron/media-usages/route";
import { POST as mediaPurge } from "@/app/api/cron/media-purge/route";
import { POST as rowHistoryPurge } from "@/app/api/cron/row-history-purge/route";
import { POST as reminders } from "@/app/api/calendar-reminders/route";

const routes = [
  ["kb-index", kbIndex, indexKbFromDisk],
  ["media-usages", mediaUsages, runSweep],
  ["media-purge", mediaPurge, purgeExpired],
  ["row-history-purge", rowHistoryPurge, purgeHistory],
  ["calendar-reminders", reminders, processReminders],
] as const;

function req(auth?: string) {
  return new Request("http://localhost/x", {
    method: "POST",
    headers: auth ? { authorization: auth } : {},
  });
}

describe.each(routes)("garde CRON_SECRET de %s", (_name, handler, spy) => {
  const saved = process.env.CRON_SECRET;
  beforeEach(() => spy.mockClear());
  afterEach(() => {
    if (saved === undefined) delete process.env.CRON_SECRET;
    else process.env.CRON_SECRET = saved;
  });

  it("401 si CRON_SECRET est absent, même avec un en-tête", async () => {
    delete process.env.CRON_SECRET;
    expect((await handler(req())).status).toBe(401);
    expect((await handler(req("Bearer undefined"))).status).toBe(401);
    expect((await handler(req("Bearer "))).status).toBe(401);
    expect(spy).not.toHaveBeenCalled();
  });

  it("401 si le secret est mauvais ou l'en-tête absent", async () => {
    process.env.CRON_SECRET = "s3cret";
    expect((await handler(req())).status).toBe(401);
    expect((await handler(req("Bearer autre"))).status).toBe(401);
    expect(spy).not.toHaveBeenCalled();
  });

  it("passe avec le bon secret", async () => {
    process.env.CRON_SECRET = "s3cret";
    const res = await handler(req("Bearer s3cret"));
    expect(res.status).toBe(200);
    expect(spy).toHaveBeenCalledTimes(1);
  });
});

describe("route row-history-purge : échec réel", () => {
  it("500 { error } quand la purge lève", async () => {
    const saved = process.env.CRON_SECRET;
    process.env.CRON_SECRET = "s3cret";
    purgeHistory.mockRejectedValueOnce(new Error("boom"));
    const res = await rowHistoryPurge(req("Bearer s3cret"));
    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ error: "Purge échouée" });
    if (saved === undefined) delete process.env.CRON_SECRET;
    else process.env.CRON_SECRET = saved;
  });
});
