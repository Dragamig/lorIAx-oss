import { describe, it, expect, vi, beforeEach } from "vitest";

const log: string[] = [];

vi.mock("@/lib/databases/row-change-context", () => ({
  setRowChangeContext: vi.fn(async (_tx: unknown, ctx: { source: string; actorUserId?: unknown }) => {
    log.push(`ctx:${ctx.source}:${ctx.actorUserId === undefined ? "noactor" : "actor"}`);
  }),
}));

vi.mock("@/lib/automations/executor", () => ({
  dispatchTrigger: vi.fn((name: string) => {
    log.push(`dispatch:${name}`);
  }),
}));
vi.mock("@/lib/bases/public-form-rate-limit", () => ({ tryAllowSubmission: async () => true }));
vi.mock("@/lib/bases/public-form-captcha", () => ({ isCaptchaEnabled: () => false, verifyHCaptcha: vi.fn() }));
vi.mock("@/lib/rate-limit", () => ({ getClientIpOrNull: () => "203.0.113.4" }));

vi.mock("@/lib/db", () => {
  const selects: unknown[][] = [];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const chain: any = {
    from: () => chain,
    where: () => chain,
    limit: () => Promise.resolve(selects.shift() ?? []),
    returning: () => {
      log.push("insert");
      return Promise.resolve([{ id: "row1" }]);
    },
    values: () => chain,
    then: (res: (v: unknown) => void) => res(selects.shift() ?? []),
  };
  const db = {
    select: () => chain,
    insert: () => chain,
    transaction: async (fn: (tx: unknown) => Promise<unknown>) => {
      log.push("tx:begin");
      const r = await fn(db);
      log.push("tx:end");
      return r;
    },
    __selects: selects,
  };
  return { db };
});

import { NextRequest } from "next/server";
import { POST } from "@/app/api/public/views/[token]/submit/route";
import { db } from "@/lib/db";

const token = "t".repeat(40);

async function submit() {
  const sel = (db as unknown as { __selects: unknown[][] }).__selects;
  sel.length = 0;
  sel.push([{ databaseId: "d1", type: "form" }], [], [{ max: 4 }]);
  const req = new NextRequest("http://localhost/api/public/views/x/submit", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ cells: {} }),
  });
  return POST(req, { params: Promise.resolve({ token }) });
}

describe("formulaire public : contexte d'historique", () => {
  beforeEach(() => {
    log.length = 0;
  });

  it("le formulaire public pose public_form dans la transaction avant l'insert", async () => {
    const res = await submit();
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
    expect(log.slice(0, 4)).toEqual(["tx:begin", "ctx:public_form:noactor", "insert", "tx:end"]);
  });

  it("dispatchTrigger row_created est appelé après la transaction", async () => {
    await submit();
    expect(log.indexOf("dispatch:row_created")).toBeGreaterThan(log.indexOf("tx:end"));
  });
});
