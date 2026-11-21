import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  validateGraph,
  IS_ME_REJECTED_MESSAGE,
  type AutomationGraph,
} from "@/lib/automations/automation-graph";
import { validateValueChangedConfig } from "@/lib/automations/value-changed";

const h = vi.hoisted(() => ({ existing: null as Record<string, unknown> | null }));

vi.mock("@/lib/auth/require-org-scoped", () => {
  class OrgScopeError extends Error {
    constructor(public response: Response) {
      super("scope");
    }
  }
  return {
    OrgScopeError,
    requireOrgScoped: vi.fn(async () => ({
      user: { id: "u1", globalRole: "admin", capabilities: [] },
    })),
  };
});
vi.mock("@/lib/auth/rbac", () => ({ canManageAutomations: () => true }));
vi.mock("@/lib/settings/system-settings", () => ({ getSetting: vi.fn(async () => null) }));
vi.mock("@/lib/automations/actions/registry", () => ({ validateActionConfig: () => null }));
vi.mock("@/lib/db", () => {
  const chain = (result: () => unknown) => {
    const c: Record<string, unknown> = {};
    for (const k of ["from", "where", "limit", "set", "values"]) c[k] = () => c;
    c.then = (res: (v: unknown) => unknown) => Promise.resolve(result()).then(res);
    c.returning = async () => [{ id: "a1" }];
    return c;
  };
  return {
    db: {
      select: () => chain(() => (h.existing ? [h.existing] : [])),
      insert: () => chain(() => []),
      update: () => chain(() => []),
    },
  };
});

import { POST } from "@/app/api/databases/[databaseId]/automations/route";
import { PATCH } from "@/app/api/databases/[databaseId]/automations/[automationId]/route";
import { PATCH as PATCH_AUTONOMOUS } from "@/app/api/automations/[automationId]/route";

const graphWith = (cond: Record<string, unknown>): AutomationGraph => ({
  nodes: [
    { id: "c", kind: "condition", condition: cond },
    { id: "a", kind: "action", actionType: "webhook" },
  ],
  edges: [{ from: "c", to: "a", branch: "true" }],
} as unknown as AutomationGraph);

const req = (body: unknown) =>
  new Request("http://localhost/x", { method: "POST", body: JSON.stringify(body) });

describe("is_me refusé dans les automatismes", () => {
  beforeEach(() => {
    h.existing = {
      id: "a1",
      databaseId: "d1",
      spaceId: "s1",
      actionType: "webhook",
      triggerType: "value_changed",
      triggerConfig: {},
    };
  });

  it("validateGraph : condition is_me (colonne) refusée", () => {
    const r = validateGraph(graphWith({ source: "column", columnId: "c1", operator: "is_me" }));
    expect(r).toEqual({ ok: false, error: IS_ME_REJECTED_MESSAGE });
    expect(IS_ME_REJECTED_MESSAGE).toBe(
      "L'opérateur « est moi » n'est pas disponible dans un automatisme",
    );
  });

  it("validateGraph : condition is_me (variable) refusée avec le même message", () => {
    const r = validateGraph(graphWith({ source: "variable", path: "x", operator: "is_me" }));
    expect(r).toEqual({ ok: false, error: IS_ME_REJECTED_MESSAGE });
  });

  it("validateGraph : condition is_empty acceptée comme avant", () => {
    expect(validateGraph(graphWith({ columnId: "c1", operator: "is_empty" }))).toEqual({ ok: true });
  });

  it("value_changed avec operator is_me refusé", () => {
    expect(validateValueChangedConfig({ columnId: "c", operator: "is_me" })).toBe(IS_ME_REJECTED_MESSAGE);
    expect(validateValueChangedConfig({ columnId: "c", operator: "is" })).toBeNull();
    expect(validateValueChangedConfig(undefined)).toBeNull();
  });

  it("POST /databases/[id]/automations value_changed is_me : 400", async () => {
    const res = await POST(
      req({
        name: "n",
        triggerType: "value_changed",
        triggerConfig: { columnId: "c", operator: "is_me" },
        actionType: "webhook",
      }),
      { params: Promise.resolve({ databaseId: "d1" }) },
    );
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe(IS_ME_REJECTED_MESSAGE);
  });

  it("POST value_changed sans is_me : 201", async () => {
    const res = await POST(
      req({
        name: "n",
        triggerType: "value_changed",
        triggerConfig: { columnId: "c", operator: "is" },
        actionType: "webhook",
      }),
      { params: Promise.resolve({ databaseId: "d1" }) },
    );
    expect(res.status).toBe(201);
  });

  it("PATCH value_changed is_me : 400", async () => {
    const res = await PATCH(req({ triggerConfig: { columnId: "c", operator: "is_me" } }), {
      params: Promise.resolve({ databaseId: "d1", automationId: "a1" }),
    });
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe(IS_ME_REJECTED_MESSAGE);
  });

  it("PATCH graphe avec condition is_me : 400 contenant le message", async () => {
    const graph = graphWith({ source: "column", columnId: "c1", operator: "is_me" });
    const res = await PATCH(req({ graph }), {
      params: Promise.resolve({ databaseId: "d1", automationId: "a1" }),
    });
    expect(res.status).toBe(400);
    expect((await res.json()).error).toContain(IS_ME_REJECTED_MESSAGE);
  });

  it("PATCH /automations/[id] (autonome) graphe is_me : 400", async () => {
    const graph = graphWith({ source: "column", columnId: "c1", operator: "is_me" });
    const res = await PATCH_AUTONOMOUS(req({ graph }), {
      params: Promise.resolve({ automationId: "a1" }),
    });
    expect(res!.status).toBe(400);
    expect((await res!.json()).error).toContain(IS_ME_REJECTED_MESSAGE);
  });

  it("PATCH triggerType -> value_changed sans triggerConfig : la config stockée avec is_me est refusée", async () => {
    h.existing = {
      id: "a1",
      databaseId: "d1",
      spaceId: "s1",
      actionType: "webhook",
      triggerType: "row_created",
      triggerConfig: { columnId: "c", operator: "is_me" },
    };
    const res = await PATCH(req({ triggerType: "value_changed" }), {
      params: Promise.resolve({ databaseId: "d1", automationId: "a1" }),
    });
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe(IS_ME_REJECTED_MESSAGE);
  });

  it("PATCH {enabled:false} sur une value_changed stockée avec is_me : accepté", async () => {
    h.existing = {
      id: "a1",
      databaseId: "d1",
      spaceId: "s1",
      actionType: "webhook",
      triggerType: "value_changed",
      triggerConfig: { columnId: "c", operator: "is_me" },
    };
    const res = await PATCH(req({ enabled: false }), {
      params: Promise.resolve({ databaseId: "d1", automationId: "a1" }),
    });
    expect(res.status).toBe(200);
  });
});
