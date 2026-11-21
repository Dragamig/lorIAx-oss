import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("@/lib/logger", () => ({ default: { error: vi.fn(), info: vi.fn(), warn: vi.fn() } }));
const purge = vi.fn(async () => ({ purged: 2, skipped: 0, failed: [] }));
const notify = vi.fn(async () => ({ notified: 1 }));
vi.mock("@/lib/media/purge", () => ({ purgeExpiredTrash: () => purge() }));
vi.mock("@/lib/media/notify", () => ({ notifyTrashNearPurge: () => notify() }));
vi.mock("@/lib/media/stale-thumbnails", () => ({ trashStaleDesignThumbnails: async () => ({ trashed: 0 }) }))

import { POST } from "@/app/api/cron/media-purge/route";
import { isMediaPurgeDisabled } from "@/lib/media/purge-job";

function req(auth?: string) {
  return new Request("http://localhost/x", {
    method: "POST",
    headers: auth ? { authorization: auth } : {},
  });
}

describe("POST /api/cron/media-purge", () => {
  const saved = process.env.CRON_SECRET;
  beforeEach(() => {
    purge.mockClear();
    notify.mockClear();
  });
  afterEach(() => {
    if (saved === undefined) delete process.env.CRON_SECRET;
    else process.env.CRON_SECRET = saved;
  });

  it("401 sans secret configuré ou sans bearer valide", async () => {
    delete process.env.CRON_SECRET;
    expect((await POST(req("Bearer undefined"))).status).toBe(401);
    process.env.CRON_SECRET = "s3cret";
    expect((await POST(req())).status).toBe(401);
    expect((await POST(req("Bearer autre"))).status).toBe(401);
    expect(purge).not.toHaveBeenCalled();
    expect(notify).not.toHaveBeenCalled();
  });

  it("passe par la garde running et le coupe-circuit : MEDIA_PURGE_DISABLED=1 ne purge pas", async () => {
    process.env.CRON_SECRET = "s3cret";
    process.env.MEDIA_PURGE_DISABLED = "1";
    try {
      const res = await POST(req("Bearer s3cret"));
      expect(res.status).toBe(200);
      expect(await res.json()).toMatchObject({ skipped: "disabled" });
      expect(purge).not.toHaveBeenCalled();
    } finally {
      delete process.env.MEDIA_PURGE_DISABLED;
    }
  });

  it("deux appels simultanés : un seul purge, l'autre est ignoré (running)", async () => {
    process.env.CRON_SECRET = "s3cret";
    let release!: () => void;
    purge.mockImplementationOnce(
      () => new Promise((r) => { release = () => r({ purged: 1, skipped: 0, failed: [] }); }) as never
    );
    const first = POST(req("Bearer s3cret"));
    await new Promise((r) => setTimeout(r, 0));
    const second = await POST(req("Bearer s3cret"));
    expect(await second.json()).toMatchObject({ skipped: "running" });
    release();
    expect((await first).status).toBe(200);
    expect(purge).toHaveBeenCalledTimes(1);
  });

  it("500 si la purge échoue", async () => {
    process.env.CRON_SECRET = "s3cret";
    purge.mockRejectedValueOnce(new Error("boom"));
    const res = await POST(req("Bearer s3cret"));
    expect(res.status).toBe(500);
  });

  it("purge puis notifie avec le bon secret", async () => {
    process.env.CRON_SECRET = "s3cret";
    const res = await POST(req("Bearer s3cret"));
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ purged: 2, notified: 1 });
    expect(purge).toHaveBeenCalledTimes(1);
    expect(notify).toHaveBeenCalledTimes(1);
  });
});

describe("isMediaPurgeDisabled", () => {
  const saved = { p: process.env.MEDIA_PURGE_DISABLED, s: process.env.MEDIA_USAGE_SWEEP };
  afterEach(() => {
    for (const [k, v] of [["MEDIA_PURGE_DISABLED", saved.p], ["MEDIA_USAGE_SWEEP", saved.s]] as const) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  });
  it("actif par défaut", () => {
    delete process.env.MEDIA_PURGE_DISABLED;
    delete process.env.MEDIA_USAGE_SWEEP;
    expect(isMediaPurgeDisabled()).toBe(false);
  });
  it("désactivé par MEDIA_PURGE_DISABLED=1", () => {
    process.env.MEDIA_PURGE_DISABLED = "1";
    expect(isMediaPurgeDisabled()).toBe(true);
  });
  it("désactivé aussi par MEDIA_USAGE_SWEEP=off", () => {
    delete process.env.MEDIA_PURGE_DISABLED;
    process.env.MEDIA_USAGE_SWEEP = "off";
    expect(isMediaPurgeDisabled()).toBe(true);
  });
});
