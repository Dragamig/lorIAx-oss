import { describe, it, expect, vi, beforeEach } from "vitest";

const { rows, chain, canManage, rate, execute } = vi.hoisted(() => {
  const rows: { value: unknown[] } = { value: [] };
  const chain: Record<string, unknown> = {};
  for (const k of ["select", "from", "where", "orderBy", "limit", "innerJoin", "leftJoin", "delete"]) {
    chain[k] = vi.fn(() => chain);
  }
  (chain as { then: unknown }).then = (res: (v: unknown) => unknown) => res(rows.value);
  return {
    rows,
    chain,
    canManage: vi.fn(() => false),
    rate: vi.fn(async () => ({ success: true })),
    execute: vi.fn(async () => ({ status: "success", runId: "new-run", durationMs: 1 })),
  };
});

vi.mock("@/lib/db", () => ({ db: chain }));
vi.mock("@/lib/db/schema", () => {
  const t = new Proxy({}, { get: (_t, p) => String(p) });
  return { userDatabaseAutomations: t, userDatabaseAutomationRuns: t, userDatabaseRows: t };
});
vi.mock("drizzle-orm", () => ({
  eq: vi.fn(), and: vi.fn(), isNull: vi.fn(), asc: vi.fn(), or: vi.fn(),
}));

const user = { id: "u1", globalRole: "member", capabilities: [] as string[] };
vi.mock("@/lib/auth/require-org-scoped", () => ({
  requireOrgScoped: vi.fn(async () => ({ user })),
  OrgScopeError: class extends Error {},
}));
vi.mock("@/lib/auth/rbac", () => ({ canManageAutomations: (...a: unknown[]) => canManage(...(a as [])) }));
vi.mock("@/lib/settings/system-settings", () => ({ getSetting: vi.fn(async () => null) }));
vi.mock("@/lib/automations/actions/registry", () => ({ validateActionConfig: vi.fn() }));

vi.mock("@/lib/rate-limit", () => ({ checkRateLimitAsync: (...a: unknown[]) => rate(...(a as [])) }));
vi.mock("@/lib/automations/executor", () => ({
  buildTestPayload: vi.fn(),
  executeAutomation: (...a: unknown[]) => execute(...(a as [])),
  runAutomationTest: vi.fn(),
  getOrgIdForAutomation: vi.fn(async () => "org1"),
}));
vi.mock("@/lib/automations/replay-context", () => ({
  replayContextFromPayload: vi.fn(() => ({ variables: {} })),
}));

import { GET as standaloneGet } from "@/app/api/automations/route";
import { GET as databaseGet } from "@/app/api/databases/[databaseId]/automations/route";
import { handleRunDetail, handleRunReplay } from "@/lib/automations/run-handlers";

const webhookRow = {
  id: "a1",
  triggerType: "webhook_inbound",
  triggerConfig: {
    token: "TOKEN-SECRET",
    secret: "SECRET-VALUE",
    lastReceived: { body: { pii: "x" } },
    note: "ok",
  },
};

beforeEach(() => {
  canManage.mockReturnValue(false);
  rate.mockResolvedValue({ success: true });
  execute.mockClear();
});

describe("lecture viewer des automatismes", () => {
  it("autonome : ni jeton, ni secret, ni lastReceived", async () => {
    rows.value = [webhookRow];
    const res = await standaloneGet(new Request("http://x/api/automations?spaceId=s1"));
    const text = JSON.stringify(await res.json());
    expect(text).not.toMatch(/TOKEN-SECRET|SECRET-VALUE|pii/);
    expect(text).toContain("ok");
  });

  it("base-liée : ni jeton, ni secret, ni lastReceived", async () => {
    rows.value = [webhookRow];
    const res = await databaseGet(new Request("http://x"), {
      params: Promise.resolve({ databaseId: "d1" }),
    });
    expect(JSON.stringify(await res.json())).not.toMatch(/TOKEN-SECRET|SECRET-VALUE|pii/);
  });

  it("un gestionnaire garde la configuration complète", async () => {
    canManage.mockReturnValue(true);
    rows.value = [webhookRow];
    const res = await standaloneGet(new Request("http://x/api/automations?spaceId=s1"));
    expect(JSON.stringify(await res.json())).toContain("TOKEN-SECRET");
  });
});

describe("détail d'un run", () => {
  it("ne contient jamais le payload", async () => {
    rows.value = [
      {
        id: "r1", automationId: "a1", triggeredAt: new Date(), status: "success",
        durationMs: 3, errorMessage: null, steps: [], traceTruncated: false, source: "trigger",
        payload: { user: { email: "secret@x.fr" }, variables: { body: "corps" } },
      },
    ];
    const res = await handleRunDetail("a1", "r1");
    const body = await res.json();
    expect(body).not.toHaveProperty("payload");
    expect(JSON.stringify(body)).not.toMatch(/secret@x\.fr|corps/);
    expect(body.steps).toEqual([]);
  });
});

describe("rejeu", () => {
  const automation = { id: "a1", databaseId: null, spaceId: "s1" } as never;

  it("au-delà de la limite : 429 sans exécution", async () => {
    rows.value = [{ id: "r1", payload: {} }];
    rate.mockResolvedValueOnce({ success: false });
    const res = await handleRunReplay(automation, "r1", "u1");
    expect(res.status).toBe(429);
    expect(execute).not.toHaveBeenCalled();
  });

  it("sous la limite : exécute et ne renvoie pas le payload", async () => {
    rows.value = [{ id: "r1", payload: {}, automationId: "a1", status: "success", source: "replay" }];
    const res = await handleRunReplay(automation, "r1", "u1");
    expect(res.status).toBe(200);
    expect(execute).toHaveBeenCalledOnce();
    expect(await res.json()).not.toHaveProperty("payload");
  });
});
