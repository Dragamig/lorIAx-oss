import { describe, it, expect, vi, beforeEach } from "vitest";

const h = vi.hoisted(() => ({
  user: { id: "u1", email: "a@b.c", name: "A", globalRole: "admin", capabilities: [] as string[] },
  canManage: true,
  scopeDenied: false,
  automationOrg: "org1" as string | null,
  saved: [] as unknown[],
  startArgs: null as Record<string, unknown> | null,
  verifyError: null as Error | null,
  connected: true,
  limited: false,
  active: false,
  limitKeys: [] as string[],
}));

vi.mock("@/lib/auth/require-org-scoped", () => {
  class OrgScopeError extends Error {
    response = new Response(JSON.stringify({ error: "Introuvable" }), { status: 404 });
  }
  return {
    OrgScopeError,
    requireOrgScoped: vi.fn(async (opts?: { resource?: unknown }) => {
      if (h.scopeDenied && opts?.resource) throw new OrgScopeError();
      return { user: h.user, orgId: "org1", orgSlug: "o" };
    }),
  };
});
vi.mock("@/lib/auth/rbac", () => ({ canManageAutomations: () => h.canManage }));
vi.mock("@/lib/rate-limit", () => ({
  checkRateLimitAsync: vi.fn(async (key: string) => (h.limitKeys.push(key), { success: !h.limited })),
}));
vi.mock("@/lib/settings/system-settings", () => ({ getSetting: vi.fn().mockResolvedValue(null) }));
vi.mock("@/lib/automations/executor", () => ({ getOrgIdForAutomation: vi.fn(async () => h.automationOrg) }));
vi.mock("@/lib/db", () => ({
  db: {
    select: () => {
      const self: Record<string, unknown> = {
        from: () => self,
        where: () => self,
        limit: async () => [{ id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", databaseId: "d1", spaceId: null, triggerType: "webhook_inbound", enabled: true, triggerConfig: { token: "t", secret: "s" } }],
      };
      return self;
    },
  },
}));
vi.mock("@/lib/integrations/tally/key-store", async () => {
  const actual = await vi.importActual<typeof import("@/lib/integrations/tally/key-store")>("@/lib/integrations/tally/key-store").catch(() => null);
  return {
    normalizeTallyKey: (k: unknown) => (typeof k === "string" && /^tly-[A-Za-z0-9_-]{8,}$/.test(k.trim()) ? k.trim() : null),
    getTallyConnectionStatus: vi.fn(async () => (h.connected ? { connected: true, maskedKey: "••••abcd" } : { connected: false, maskedKey: null })),
    saveTallyKey: vi.fn(async (...a: unknown[]) => void h.saved.push(a)),
    deleteTallyKey: vi.fn(async () => {}),
    getTallyClientForOrg: vi.fn(async () => (h.connected ? { getForm: async () => ({ id: "f", name: "F" }), listForms: async () => [{ id: "f", name: "F" }] } : null)),
    _actual: actual,
  };
});
vi.mock("@/lib/integrations/tally/client", async () => {
  const actual = await vi.importActual<typeof import("@/lib/integrations/tally/client")>("@/lib/integrations/tally/client");
  return {
    ...actual,
    createTallyClient: () => ({
      verify: async () => {
        if (h.verifyError) throw h.verifyError;
      },
    }),
  };
});
vi.mock("@/lib/integrations/tally/import-runner", () => {
  class ActiveImportError extends Error {}
  return {
    ActiveImportError,
    findActiveImport: vi.fn(async () => null),
    startImport: vi.fn(async (a: Record<string, unknown>) => {
      if (h.active) throw new ActiveImportError();
      h.startArgs = a;
      return "imp1";
    }),
    countSubmissions: vi.fn(async () => ({ total: 5, imported: 2, toImport: 3 })),
  };
});

import { GET as CONN_GET, PUT as CONN_PUT } from "@/app/api/integrations/tally/connection/route";
import { POST as IMPORT_POST } from "@/app/api/integrations/tally/imports/route";
import { GET as FORMS_GET } from "@/app/api/integrations/tally/forms/route";
import { GET as COUNT_GET } from "@/app/api/integrations/tally/submissions/count/route";
import { TallyError } from "@/lib/integrations/tally/client";

const AUTO = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const req = (body: unknown) => new Request("http://x/", { method: "POST", body: JSON.stringify(body) });

beforeEach(() => {
  Object.assign(h, { canManage: true, scopeDenied: false, automationOrg: "org1", saved: [], startArgs: null, verifyError: null, connected: true, limited: false, active: false, limitKeys: [] });
});

describe("routes Tally", () => {
  it("non gestionnaire : 403", async () => {
    h.canManage = false;
    expect((await CONN_GET()).status).toBe(403);
    expect((await CONN_PUT(req({ apiKey: "tly-abcdefgh1234" }))).status).toBe(403);
  });

  it("la clé n'est jamais renvoyée, seulement le suffixe masqué", async () => {
    const res = await CONN_PUT(req({ apiKey: "tly-supersecret9999" }));
    const text = await res.text();
    expect(res.status).toBe(200);
    expect(text).not.toContain("supersecret");
    expect(JSON.parse(text)).toEqual({ connected: true, maskedKey: "••••abcd" });
    expect(h.saved).toHaveLength(1);
    expect(await (await CONN_GET()).text()).not.toContain("tly-");
  });

  it("clé refusée par Tally : rien n'est enregistré", async () => {
    h.verifyError = new TallyError("invalid_key", "x", 401);
    const res = await CONN_PUT(req({ apiKey: "tly-abcdefgh1234" }));
    expect(res.status).toBe(422);
    expect(h.saved).toHaveLength(0);
  });

  it("format de clé invalide : 400", async () => {
    expect((await CONN_PUT(req({ apiKey: "pas-une-cle" }))).status).toBe(400);
  });

  it("import d'un automatisme d'une autre organisation : 404 muet", async () => {
    h.automationOrg = "autre-org";
    const res = await IMPORT_POST(req({ automationId: AUTO, formId: "frm", mode: "simulate" }));
    expect(res.status).toBe(404);
    expect(h.startArgs).toBeNull();
  });

  it("import : espace non éditable -> réponse d'OrgScopeError", async () => {
    h.scopeDenied = true;
    expect((await IMPORT_POST(req({ automationId: AUTO, formId: "frm", mode: "real" }))).status).toBe(404);
  });

  it("import simulé accepté en 202 et lancé avec le mode simulate", async () => {
    const res = await IMPORT_POST(req({ automationId: AUTO, formId: "frm", mode: "simulate" }));
    expect(res.status).toBe(202);
    expect(h.startArgs).toMatchObject({ mode: "simulate", formId: "frm", organizationId: "org1" });
  });

  it("sans connexion Tally : 409", async () => {
    h.connected = false;
    expect((await IMPORT_POST(req({ automationId: AUTO, formId: "frm", mode: "simulate" }))).status).toBe(409);
  });

  it("conflit d'unicité à la création : 409 lisible", async () => {
    h.active = true;
    const res = await IMPORT_POST(req({ automationId: AUTO, formId: "frm", mode: "simulate" }));
    expect(res.status).toBe(409);
    expect((await res.json()).error).toMatch(/déjà en cours/);
  });

  it("forms, comptage et import : 429 au-delà du plafond, clé par organisation", async () => {
    h.limited = true;
    expect((await FORMS_GET()).status).toBe(429);
    const count = new Request(`http://x/?formId=frm&automationId=${AUTO}`);
    expect((await COUNT_GET(count)).status).toBe(429);
    expect((await IMPORT_POST(req({ automationId: AUTO, formId: "frm", mode: "simulate" }))).status).toBe(429);
    expect(h.startArgs).toBeNull();
    expect(h.limitKeys).toEqual(["tally:forms:org1", "tally:count:org1", "tally:imports:org1"]);
  });

  it("comptage : total de Tally et déjà importées, sans parcours", async () => {
    const res = await COUNT_GET(new Request(`http://x/?formId=frm&automationId=${AUTO}`));
    expect(await res.json()).toEqual({ total: 5, imported: 2, toImport: 3 });
  });
});
