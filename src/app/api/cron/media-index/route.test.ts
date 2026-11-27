import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const h = vi.hoisted(() => ({ job: vi.fn() }));
vi.mock("@/lib/media/ai/index-job", () => ({ runMediaIndexJob: () => h.job() }));

import { POST } from "./route";

const call = (auth?: string) =>
  POST(new Request("http://localhost/api/cron/media-index", { method: "POST", headers: auth ? { authorization: auth } : {} }));

beforeEach(() => {
  process.env.CRON_SECRET = "s3cret-s3cret-s3cret";
  h.job.mockReset().mockResolvedValue({ status: "ok", done: 2, skipped: 0, retried: 0, failed: 0 });
});
afterEach(() => {
  delete process.env.CRON_SECRET;
});

describe("POST /api/cron/media-index", () => {
  it("401 sans Bearer, la tâche ne tourne pas", async () => {
    expect((await call()).status).toBe(401);
    expect(h.job).not.toHaveBeenCalled();
  });
  it("401 avec un mauvais secret", async () => {
    expect((await call("Bearer nope")).status).toBe(401);
  });
  it("200 avec le bon secret : rapport sans le champ status", async () => {
    const res = await call("Bearer s3cret-s3cret-s3cret");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ done: 2, skipped: 0, retried: 0, failed: 0 });
  });
  it("tâche ignorée : renvoie le motif", async () => {
    h.job.mockResolvedValue({ status: "skipped", skipped: "running" });
    expect(await (await call("Bearer s3cret-s3cret-s3cret")).json()).toEqual({ skipped: "running" });
  });
});
