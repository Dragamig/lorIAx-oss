/** Champs de la dernière réponse Tally reçue : cloisonnement par organisation et contenu. */
import { describe, it, expect, vi, beforeEach } from "vitest";

const h = vi.hoisted(() => ({
  scopeDenied: false,
  canManage: true,
  rows: [] as unknown[],
  scopeArgs: null as unknown,
}));

vi.mock("@/lib/auth/require-org-scoped", () => ({
  OrgScopeError: class extends Error {
    response = new Response(null, { status: 404 });
  },
  requireOrgScoped: vi.fn(async (args: unknown) => {
    h.scopeArgs = args;
    if (h.scopeDenied) {
      const { OrgScopeError } = await import("@/lib/auth/require-org-scoped");
      throw new OrgScopeError(new Response(null, { status: 404 }) as never, "no-org");
    }
    return { user: { id: "u1", globalRole: "admin", capabilities: [] } };
  }),
}));
vi.mock("@/lib/auth/rbac", () => ({ canManageAutomations: () => h.canManage }));
vi.mock("@/lib/db", () => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const self: any = {
    from: () => self,
    where: () => self,
    limit: () => Promise.resolve(h.rows),
  };
  return { db: { select: () => self } };
});

import { GET } from "@/app/api/databases/[databaseId]/automations/[automationId]/tally-fields/route";

const p = { params: Promise.resolve({ databaseId: "d1", automationId: "a1" }) };
const call = () => GET(new Request("http://x"), p);
const tallyBody = {
  eventType: "FORM_RESPONSE",
  data: {
    formId: "f1",
    fields: [
      { key: "q1", label: "Nom", type: "INPUT_TEXT", value: "Ada" },
      { key: "q2", label: "Mail", type: "INPUT_EMAIL", value: "a@x.fr" },
    ],
  },
};

beforeEach(() => {
  h.scopeDenied = false;
  h.canManage = true;
  h.rows = [];
  h.scopeArgs = null;
});

describe("GET tally-fields", () => {
  it("404 muet hors organisation", async () => {
    h.scopeDenied = true;
    h.rows = [{ triggerConfig: { lastReceived: { body: tallyBody } } }];
    const res = await call();
    expect(res.status).toBe(404);
    expect(await res.text()).toBe("");
  });

  it("cloisonne sur la base, droit éditeur requis", async () => {
    h.rows = [{ triggerConfig: {} }];
    await call();
    expect(h.scopeArgs).toMatchObject({ resource: { type: "database", id: "d1" }, minPermission: "editor" });
  });

  it("403 sans le rôle de gestion des automatismes", async () => {
    h.canManage = false;
    expect((await call()).status).toBe(403);
  });

  it("404 si l'automatisme n'appartient pas à la base", async () => {
    h.rows = [];
    expect((await call()).status).toBe(404);
  });

  it("renvoie key, label et type des champs de la dernière réponse", async () => {
    h.rows = [{ triggerConfig: { token: "t", lastReceived: { at: "x", size: 1, body: tallyBody } } }];
    const res = await call();
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      fields: [
        { key: "q1", label: "Nom", type: "INPUT_TEXT" },
        { key: "q2", label: "Mail", type: "INPUT_EMAIL" },
      ],
    });
  });

  it("liste vide sans réponse reçue, corps tronqué ou non Tally", async () => {
    for (const cfg of [{}, null, { lastReceived: { body: null, truncated: true } }, { lastReceived: { body: { a: 1 } } }]) {
      h.rows = [{ triggerConfig: cfg }];
      const res = await call();
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({ fields: [] });
    }
  });
});
