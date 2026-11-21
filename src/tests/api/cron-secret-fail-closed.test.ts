/**
 * Toutes les routes /api/cron/** refusent sans CRON_SECRET (absent ou vide),
 * quel que soit l'en-tête, et n'acceptent que le bearer exact.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { readdirSync, existsSync } from "node:fs";
import path from "node:path";

vi.mock("@/lib/logger", () => ({
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));
const work = vi.hoisted(() => vi.fn());
vi.mock("@/lib/kb/kb-scheduler", () => ({
  executeKbIndex: work.mockResolvedValue({
    summary: {},
    verdict: { ok: true, reason: "ok" },
  }),
}));
vi.mock("@/lib/db", () => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const self: any = new Proxy(() => self, {
    get: (_t, p) => (p === "then" ? undefined : self),
    apply: () => self,
  });
  return { db: self };
});

const CRON_DIR = path.join(process.cwd(), "src/app/api/cron");
const routes = readdirSync(CRON_DIR).filter((d) =>
  existsSync(path.join(CRON_DIR, d, "route.ts"))
);

const post = (auth?: string) =>
  new Request("http://localhost/api/cron/x", {
    method: "POST",
    headers: auth === undefined ? {} : { authorization: auth },
  });

const load = async (name: string) => {
  const mod = await import(`@/app/api/cron/${name}/route.ts`);
  const handler = mod.POST ?? mod.GET;
  expect(handler, `${name} expose POST ou GET`).toBeTypeOf("function");
  return handler as (r: Request) => Promise<Response>;
};

let saved: string | undefined;
beforeEach(() => {
  saved = process.env.CRON_SECRET;
});
afterEach(() => {
  if (saved === undefined) delete process.env.CRON_SECRET;
  else process.env.CRON_SECRET = saved;
});

describe("routes cron : fail-closed sur CRON_SECRET", () => {
  it("couvre au moins une route", () => {
    expect(routes.length).toBeGreaterThan(0);
  });

  for (const name of routes) {
    describe(name, () => {
      it("cron_route_rejects_when_secret_unset", async () => {
        const handler = await load(name);
        delete process.env.CRON_SECRET;
        expect((await handler(post("Bearer "))).status).toBe(401);
        expect((await handler(post("Bearer undefined"))).status).toBe(401);
        expect((await handler(post())).status).toBe(401);
        process.env.CRON_SECRET = "";
        expect((await handler(post("Bearer "))).status).toBe(401);
        expect((await handler(post("Bearer"))).status).toBe(401);
      });

      it("rejette un mauvais bearer quand le secret est défini", async () => {
        const handler = await load(name);
        process.env.CRON_SECRET = "s3cret-value";
        expect((await handler(post("Bearer autre"))).status).toBe(401);
        expect((await handler(post())).status).toBe(401);
      });

      it("cron_route_accepts_matching_bearer", async () => {
        const handler = await load(name);
        process.env.CRON_SECRET = "s3cret-value";
        const res = await handler(post("Bearer s3cret-value"));
        expect(res.status).not.toBe(401);
      });
    });
  }
});
