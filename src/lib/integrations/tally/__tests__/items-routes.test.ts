import { describe, it, expect, vi, beforeEach } from "vitest";

const h = vi.hoisted(() => ({
  canManage: true,
  scopeDenied: false,
  automationOrg: "org1" as string | null,
  importOrg: "org1",
  importFound: true,
  listArgs: null as unknown[] | null,
  traceFound: true,
}));

vi.mock("@/lib/auth/require-org-scoped", () => {
  class OrgScopeError extends Error {
    response = new Response(JSON.stringify({ error: "Introuvable" }), { status: 404 });
  }
  return {
    OrgScopeError,
    requireOrgScoped: vi.fn(async (opts?: { resource?: unknown }) => {
      if (h.scopeDenied && opts?.resource) throw new OrgScopeError();
      return { user: { id: "u1", globalRole: "admin", capabilities: [] }, orgId: "org1", orgSlug: "o" };
    }),
  };
});
vi.mock("@/lib/rate-limit", () => ({ checkRateLimitAsync: vi.fn(async () => ({ success: true })) }));
vi.mock("@/lib/auth/rbac", () => ({ canManageAutomations: () => h.canManage }));
vi.mock("@/lib/automations/executor", () => ({ getOrgIdForAutomation: vi.fn(async () => h.automationOrg) }));
vi.mock("@/lib/db", () => ({
  db: {
    update: () => ({ set: () => ({ where: async () => {} }) }),
    select: () => {
      const self: Record<string, unknown> = {
        from: () => self,
        where: () => self,
        limit: async () =>
          h.importFound
            ? [{ id: "x", automationId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", organizationId: h.importOrg, databaseId: "d1", spaceId: null, triggerType: "webhook_inbound" }]
            : [],
      };
      return self;
    },
  },
}));
vi.mock("@/lib/integrations/tally/import-items", () => ({
  listImportItems: vi.fn(async (...a: unknown[]) => ((h.listArgs = a), { items: [], counts: {}, total: 0, offset: 0, limit: 200, hasMore: false })),
  getItemTrace: vi.fn(async () => (h.traceFound ? { trace: [{ nodeId: "a" }], truncated: false } : null)),
}));

import { GET as IMPORT_GET } from "@/app/api/integrations/tally/imports/[importId]/route";
import { POST as CANCEL } from "@/app/api/integrations/tally/imports/[importId]/cancel/route";
import { GET as ITEMS } from "@/app/api/integrations/tally/imports/[importId]/items/route";
import { GET as TRACE } from "@/app/api/integrations/tally/imports/[importId]/items/[submissionId]/trace/route";

const IMP = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const ctx = (extra: Record<string, string> = {}) => ({ params: Promise.resolve({ importId: IMP, submissionId: "", ...extra }) });

beforeEach(() => {
  Object.assign(h, { canManage: true, scopeDenied: false, automationOrg: "org1", importOrg: "org1", importFound: true, listArgs: null, traceFound: true });
});

describe("détail par réponse d'un import", () => {
  it("non gestionnaire : 403", async () => {
    h.canManage = false;
    expect((await ITEMS(new Request("http://x/"), ctx())).status).toBe(403);
    expect((await TRACE(new Request("http://x/"), ctx({ submissionId: "s1" }))).status).toBe(403);
  });
  it("import d'une autre organisation : 404 muet", async () => {
    h.importOrg = "autre";
    expect((await ITEMS(new Request("http://x/"), ctx())).status).toBe(404);
    expect((await TRACE(new Request("http://x/"), ctx({ submissionId: "s1" }))).status).toBe(404);
    expect(h.listArgs).toBeNull();
  });
  it("espace non éditable : 404", async () => {
    h.scopeDenied = true;
    expect((await ITEMS(new Request("http://x/"), ctx())).status).toBe(404);
  });
  it("transmet filtre et pagination", async () => {
    const res = await ITEMS(new Request("http://x/?outcome=error&offset=200&limit=50"), ctx());
    expect(res.status).toBe(200);
    expect(h.listArgs).toEqual([IMP, { outcome: "error", offset: 200, limit: 50 }]);
  });
  it("trace : identifiant de réponse invalide ou absent = 404, sinon étapes", async () => {
    expect((await TRACE(new Request("http://x/"), ctx({ submissionId: "../x" }))).status).toBe(404);
    h.traceFound = false;
    expect((await TRACE(new Request("http://x/"), ctx({ submissionId: "s1" }))).status).toBe(404);
    h.traceFound = true;
    const res = await TRACE(new Request("http://x/"), ctx({ submissionId: "s1" }));
    expect(await res.json()).toMatchObject({ steps: [{ nodeId: "a" }], available: true });
  });

  it("progression et annulation : mêmes contrôles que le détail (403, 404 muet)", async () => {
    h.canManage = false;
    expect((await IMPORT_GET(new Request("http://x/"), ctx())).status).toBe(403);
    expect((await CANCEL(new Request("http://x/", { method: "POST" }), ctx())).status).toBe(403);
    h.canManage = true;
    h.scopeDenied = true;
    expect((await IMPORT_GET(new Request("http://x/"), ctx())).status).toBe(404);
    expect((await CANCEL(new Request("http://x/", { method: "POST" }), ctx())).status).toBe(404);
    h.scopeDenied = false;
    h.importOrg = "autre";
    expect((await IMPORT_GET(new Request("http://x/"), ctx())).status).toBe(404);
    expect((await CANCEL(new Request("http://x/", { method: "POST" }), ctx())).status).toBe(404);
    h.importOrg = "org1";
    expect((await IMPORT_GET(new Request("http://x/"), ctx())).status).toBe(200);
  });
});
