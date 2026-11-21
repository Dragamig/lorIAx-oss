/**
 * Test du builder (simulé / réel), détail d'un run et rejeu, pour les deux
 * familles d'automatismes : accès, absence d'écriture en simulation,
 * persistance en réel, remplacement au rejeu.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const h = vi.hoisted(() => ({
  user: { id: "u1", email: "a@b.c", name: "A", globalRole: "admin", capabilities: [] as string[] },
  canManage: true,
  scopeDenied: false,
  limitQueue: [] as unknown[][],
  deleted: [] as unknown[],
  order: [] as string[],
  executeResult: { status: "success", durationMs: 5, runId: "new1", trace: [{ nodeId: "n" }], traceTruncated: false } as Record<string, unknown>,
  executeThrows: false,
  executeArgs: null as unknown[] | null,
  testCalls: 0,
  rateOk: true,
}));

vi.mock("@/lib/auth/require-org-scoped", () => ({
  OrgScopeError: class extends Error {
    response = new Response(null, { status: 404 });
  },
  requireOrgScoped: vi.fn(async () => {
    if (h.scopeDenied) {
      const { OrgScopeError } = await import("@/lib/auth/require-org-scoped");
      throw new OrgScopeError(new Response(null, { status: 404 }) as never, "no-org");
    }
    return { user: h.user };
  }),
}));
vi.mock("@/lib/auth/rbac", () => ({ canManageAutomations: () => h.canManage }));
vi.mock("@/lib/settings/system-settings", () => ({ getSetting: vi.fn().mockResolvedValue(null) }));
vi.mock("@/lib/rate-limit", () => ({
  checkRateLimitAsync: vi.fn(async () => ({ success: h.rateOk, remaining: 0, resetAt: 0 })),
}));
vi.mock("@/lib/automations/executor", () => ({
  getOrgIdForAutomation: vi.fn(async () => "org1"),
  buildTestPayload: (_a: unknown, sample: unknown) => ({ ...(sample as object), built: true }),
  runAutomationTest: vi.fn(async () => {
    h.testCalls += 1;
    return { status: "success", durationMs: 1, steps: [], traceTruncated: false };
  }),
  executeAutomation: vi.fn(async (...args: unknown[]) => {
    h.executeArgs = args;
    h.order.push("execute");
    if (h.executeThrows) throw new Error("crash");
    return h.executeResult;
  }),
}));
vi.mock("@/lib/db", () => {
  const chain = () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const self: any = {
      from: () => self,
      where: () => self,
      limit: () => Promise.resolve(h.limitQueue.shift() ?? []),
    };
    return self;
  };
  return {
    db: {
      select: () => chain(),
      delete: () => ({
        where: (w: unknown) => {
          h.deleted.push(w);
          h.order.push("delete");
          return Promise.resolve();
        },
      }),
      insert: () => {
        throw new Error("aucune écriture attendue");
      },
      update: () => {
        throw new Error("aucune écriture attendue");
      },
    },
  };
});

import { POST as BASE_TEST } from "@/app/api/databases/[databaseId]/automations/[automationId]/test/route";
import { POST as AUTO_TEST } from "@/app/api/automations/[automationId]/test/route";
import { GET as BASE_RUN } from "@/app/api/databases/[databaseId]/automations/[automationId]/runs/[runId]/route";
import { GET as AUTO_RUN } from "@/app/api/automations/[automationId]/runs/[runId]/route";
import { POST as BASE_REPLAY } from "@/app/api/databases/[databaseId]/automations/[automationId]/runs/[runId]/replay/route";
import { POST as AUTO_REPLAY } from "@/app/api/automations/[automationId]/runs/[runId]/replay/route";

const baseP = { params: Promise.resolve({ databaseId: "d1", automationId: "a1" }) };
const baseRunP = { params: Promise.resolve({ databaseId: "d1", automationId: "a1", runId: "r1" }) };
const autoP = { params: Promise.resolve({ automationId: "a1" }) };
const autoRunP = { params: Promise.resolve({ automationId: "a1", runId: "r1" }) };
const post = (body: unknown) =>
  new Request("http://x", { method: "POST", body: JSON.stringify(body) });
const baseAutomation = { id: "a1", databaseId: "d1", spaceId: null, triggerConfig: {}, enabled: false };
const autoAutomation = { id: "a1", databaseId: null, spaceId: "s1", triggerConfig: {}, enabled: true };

beforeEach(() => {
  h.canManage = true;
  h.scopeDenied = false;
  h.limitQueue = [];
  h.deleted = [];
  h.order = [];
  h.executeThrows = false;
  h.executeArgs = null;
  h.testCalls = 0;
  h.rateOk = true;
  h.executeResult = { status: "success", durationMs: 5, runId: "new1", trace: [{ nodeId: "n" }], traceTruncated: false };
});

describe("accès", () => {
  it.each([
    ["test base", () => BASE_TEST(post({ mode: "simulate", sample: { kind: "values" } }), baseP)],
    ["test auto", () => AUTO_TEST(post({ mode: "simulate", sample: { kind: "values" } }), autoP)],
    ["replay base", () => BASE_REPLAY(post({}), baseRunP)],
    ["replay auto", () => AUTO_REPLAY(post({}), autoRunP)],
  ])("%s : autre organisation = 404 muet", async (_n, call) => {
    h.scopeDenied = true;
    h.limitQueue = [[baseAutomation]];
    expect((await call()).status).toBe(404);
  });

  it.each([
    ["test base", () => BASE_TEST(post({ mode: "simulate", sample: { kind: "values" } }), baseP)],
    ["test auto", () => AUTO_TEST(post({ mode: "simulate", sample: { kind: "values" } }), autoP)],
    ["replay base", () => BASE_REPLAY(post({}), baseRunP)],
    ["replay auto", () => AUTO_REPLAY(post({}), autoRunP)],
  ])("%s : sans droit de gestion = 403", async (_n, call) => {
    h.canManage = false;
    h.limitQueue = [[baseAutomation]];
    // Pour la famille autonome, l'automatisme doit porter un espace.
    h.limitQueue = [[{ ...baseAutomation, spaceId: "s1" }]];
    expect((await call()).status).toBe(403);
    expect(h.testCalls).toBe(0);
    expect(h.executeArgs).toBeNull();
  });

  it("détail d'un run : autre organisation = 404", async () => {
    h.scopeDenied = true;
    h.limitQueue = [[{ id: "a1", spaceId: "s1" }]];
    expect((await AUTO_RUN(new Request("http://x"), autoRunP)).status).toBe(404);
    h.limitQueue = [[{ id: "a1" }]];
    expect((await BASE_RUN(new Request("http://x"), baseRunP)).status).toBe(404);
  });
});

describe("test", () => {
  it("simulé : renvoie la trace et n'écrit rien", async () => {
    h.limitQueue = [[baseAutomation]];
    const res = await BASE_TEST(post({ mode: "simulate", sample: { kind: "values", cells: { a: 1 } } }), baseP);
    expect(res.status).toBe(200);
    expect((await res.json()).mode).toBe("simulate");
    expect(h.testCalls).toBe(1);
    expect(h.executeArgs).toBeNull();
  });

  it("simulé : limiteur atteint = 429", async () => {
    h.rateOk = false;
    h.limitQueue = [[baseAutomation]];
    const res = await BASE_TEST(post({ mode: "simulate", sample: { kind: "values" } }), baseP);
    expect(res.status).toBe(429);
    expect(h.testCalls).toBe(0);
  });

  it("réel : persiste un run source test, même automatisme désactivé", async () => {
    h.limitQueue = [[baseAutomation]];
    const res = await BASE_TEST(post({ mode: "real", untilNodeId: "n1", sample: { kind: "values" } }), baseP);
    const json = await res.json();
    expect(json.runId).toBe("new1");
    expect(json.steps).toHaveLength(1);
    expect(h.executeArgs?.[2]).toMatchObject({ source: "test", untilNodeId: "n1" });
  });

  it("autonome : réel accepté", async () => {
    h.limitQueue = [[autoAutomation]];
    const res = await AUTO_TEST(post({ mode: "real", sample: { kind: "values" } }), autoP);
    expect(res.status).toBe(200);
    expect(h.executeArgs?.[2]).toMatchObject({ source: "test" });
  });

  it("sample row d'une autre base refusé", async () => {
    h.limitQueue = [[baseAutomation], []]; // automatisme trouvé, ligne introuvable dans la base
    const res = await BASE_TEST(
      post({ mode: "simulate", sample: { kind: "row", rowId: "00000000-0000-4000-8000-000000000001" } }),
      baseP
    );
    expect(res.status).toBe(404);
    expect(h.testCalls).toBe(0);
  });

  it("sample row d'un workflow autonome refusé", async () => {
    h.limitQueue = [[autoAutomation]];
    const res = await AUTO_TEST(
      post({ mode: "simulate", sample: { kind: "row", rowId: "00000000-0000-4000-8000-000000000001" } }),
      autoP
    );
    expect(res.status).toBe(400);
  });

  it("lastReceived absent = 409", async () => {
    h.limitQueue = [[baseAutomation]];
    const res = await BASE_TEST(post({ mode: "simulate", sample: { kind: "lastReceived" } }), baseP);
    expect(res.status).toBe(409);
  });

  it("lastReceived présent : rejoue le corps", async () => {
    h.limitQueue = [[{ ...baseAutomation, triggerConfig: { lastReceived: { body: { x: 1 } } } }]];
    const res = await BASE_TEST(post({ mode: "simulate", sample: { kind: "lastReceived" } }), baseP);
    expect(res.status).toBe(200);
  });
});

describe("détail et rejeu", () => {
  it("détail : renvoie le run avec sa trace", async () => {
    h.limitQueue = [[{ id: "a1" }], [{ id: "r1", steps: [{ nodeId: "n" }] }]];
    const res = await BASE_RUN(new Request("http://x"), baseRunP);
    expect((await res.json()).steps).toHaveLength(1);
  });

  it("rejeu : exécute avec le contexte puis supprime l'original", async () => {
    h.limitQueue = [
      [baseAutomation],
      [{ id: "r1", payload: { replay: { event: "row_created", cells: { a: 1 } } } }],
      [{ id: "new1", source: "replay" }],
    ];
    const res = await BASE_REPLAY(post({}), baseRunP);
    expect(res.status).toBe(200);
    expect((await res.json()).id).toBe("new1");
    expect(h.executeArgs?.[1]).toMatchObject({ cells: { a: 1 } });
    expect(h.executeArgs?.[2]).toMatchObject({ source: "replay" });
    expect(h.order).toEqual(["execute", "delete"]);
  });

  it("rejeu : plantage avant insertion, l'ancien est conservé", async () => {
    h.limitQueue = [
      [autoAutomation],
      [{ id: "r1", payload: { replay: { event: "manual" } } }],
    ];
    h.executeThrows = true;
    await expect(AUTO_REPLAY(post({}), autoRunP)).rejects.toThrow("crash");
    expect(h.deleted).toHaveLength(0);
  });

  it("rejeu : exécution refusée par quota, l'ancien est conservé", async () => {
    h.limitQueue = [
      [baseAutomation],
      [{ id: "r1", payload: { replay: { event: "row_created" } } }],
    ];
    h.executeResult = { status: "skipped", durationMs: 0, runId: "sk1" };
    const res = await BASE_REPLAY(post({}), baseRunP);
    expect(res.status).toBe(429);
    expect(h.deleted).toHaveLength(1); // seule la trace du refus est retirée
  });

  it("rejeu : run sans contexte rejouable = 409", async () => {
    h.limitQueue = [[baseAutomation], [{ id: "r1", payload: {} }]];
    expect((await BASE_REPLAY(post({}), baseRunP)).status).toBe(409);
    expect(h.executeArgs).toBeNull();
  });
});
