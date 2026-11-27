/**
 * Webhook entrant sur automatisme base-lié : création, PATCH (clés serveur
 * intouchables, régénération), lecture (rédaction sans droit de gestion) et
 * enregistrement du dernier corps reçu par le point d'entrée public.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const h = vi.hoisted(() => ({
  user: { id: "u1", globalRole: "admin", capabilities: [] as string[] },
  canManage: true,
  inserted: null as Record<string, unknown> | null,
  updated: null as Record<string, unknown> | null,
  selectRows: [] as unknown[],
  updateThrows: false,
  executeCalls: 0,
  reserve: vi.fn(async () => true),
}));

vi.mock("@/lib/auth/require-org-scoped", () => ({
  OrgScopeError: class extends Error {
    response = new Response(null, { status: 404 });
  },
  requireOrgScoped: vi.fn(async () => ({ user: h.user })),
}));
vi.mock("@/lib/auth/rbac", () => ({ canManageAutomations: () => h.canManage }));
vi.mock("@/lib/settings/system-settings", () => ({ getSetting: vi.fn().mockResolvedValue(null) }));
vi.mock("@/lib/integrations/tally/submission-claims", () => ({
  tallyResponseIdFromBody: (b: { eventType?: string; data?: { responseId?: string } }) =>
    b?.eventType === "FORM_RESPONSE" ? (b.data?.responseId ?? null) : null,
  reserveSubmission: h.reserve,
  markSubmissionDone: vi.fn(async () => undefined),
  releaseSubmission: vi.fn(async () => undefined),
}));
vi.mock("@/lib/automations/executor", () => ({
  executeAutomation: vi.fn(async () => {
    h.executeCalls += 1;
    return { status: "success" };
  }),
}));
vi.mock("@/lib/db", () => {
  const chain = (rows: () => unknown[]) => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const self: any = {
      then: (res: (v: unknown[]) => void, rej?: (e: unknown) => void) =>
        Promise.resolve(rows()).then(res, rej),
      from: () => self,
      where: () => self,
      orderBy: () => Promise.resolve(rows()),
      limit: () => Promise.resolve(rows()),
      values: (v: Record<string, unknown>) => {
        h.inserted = v;
        return self;
      },
      set: (v: Record<string, unknown>) => {
        if (h.updateThrows) throw new Error("boom");
        h.updated = v;
        return self;
      },
      returning: () => Promise.resolve([{ ...(h.inserted ?? h.updated ?? {}), id: "a1" }]),
    };
    return self;
  };
  return {
    db: {
      select: () => chain(() => h.selectRows),
      insert: () => chain(() => []),
      update: () => chain(() => []),
    },
  };
});

import { POST, GET } from "@/app/api/databases/[databaseId]/automations/route";
import { PATCH } from "@/app/api/databases/[databaseId]/automations/[automationId]/route";
import { POST as HOOK } from "@/app/api/automations/hook/[token]/route";

// La config écrite par le hook est une expression SQL (jsonb_set) : on en
// extrait le paramètre JSON lastReceived.
function writtenLastReceived(): Record<string, unknown> | null {
  const expr = h.updated?.triggerConfig as { queryChunks?: unknown[] } | undefined;
  const raw = expr?.queryChunks?.find((c) => typeof c === "string" && c.startsWith('{"at"'));
  return raw ? JSON.parse(raw as string) : null;
}

const dbParams = { params: Promise.resolve({ databaseId: "d1" }) };
const patchParams = { params: Promise.resolve({ databaseId: "d1", automationId: "a1" }) };
const json = (body: unknown, headers: Record<string, string> = {}) =>
  new Request("http://x", { method: "POST", body: JSON.stringify(body), headers });

const stored = {
  id: "a1",
  databaseId: "d1",
  triggerType: "webhook_inbound",
  actionType: "create_task",
  triggerConfig: {
    token: "a".repeat(48),
    secret: "b".repeat(48),
    lastReceived: { at: "2026-01-01T00:00:00.000Z", size: 2, body: {} },
  },
  enabled: true,
};

beforeEach(() => {
  h.canManage = true;
  h.inserted = null;
  h.updated = null;
  h.selectRows = [];
  h.updateThrows = false;
  h.executeCalls = 0;
});

describe("création base-liée webhook_inbound", () => {
  it("accepte le déclencheur et génère jeton + secret côté serveur", async () => {
    const res = await POST(
      json({
        name: "Entrant",
        triggerType: "webhook_inbound",
        triggerConfig: { token: "0".repeat(48), lastReceived: "pirate" },
        actionType: "create_task",
        actionConfig: { title: "t" },
      }) as never,
      dbParams
    );
    expect(res.status).toBe(201);
    const cfg = h.inserted!.triggerConfig as Record<string, unknown>;
    expect(cfg.token).toMatch(/^[0-9a-f]{48}$/);
    expect(cfg.token).not.toBe("0".repeat(48));
    expect(cfg.secret).toMatch(/^[0-9a-f]{48}$/);
    expect(cfg.lastReceived).toBeUndefined();
  });
});

describe("PATCH base-lié", () => {
  it("refuse d'activer un Tally sans formulaire, puis l'accepte une fois choisi", async () => {
    h.selectRows = [{ ...stored, enabled: false, triggerConfig: { ...stored.triggerConfig, tallyFormId: null } }];
    const refused = await PATCH(json({ enabled: true }) as never, patchParams);
    expect(refused.status).toBe(422);
    expect((await refused.json()).code).toBe("tally_form_required");
    expect(h.updated).toBeNull();
    const ok = await PATCH(json({ enabled: true, triggerConfig: { tallyFormId: "wMeKx2" } }) as never, patchParams);
    expect(ok.status).toBe(200);
    expect((h.updated!.triggerConfig as Record<string, unknown>).tallyFormId).toBe("wMeKx2");
  });

  it("ne laisse pas le client écraser ni effacer les clés serveur", async () => {
    h.selectRows = [stored];
    const res = await PATCH(
      json({ triggerConfig: { token: "0".repeat(48), secret: "x", lastReceived: null } }) as never,
      patchParams
    );
    expect(res.status).toBe(200);
    const cfg = h.updated!.triggerConfig as Record<string, unknown>;
    expect(cfg.token).toBe(stored.triggerConfig.token);
    expect(cfg.secret).toBe(stored.triggerConfig.secret);
    expect(cfg.lastReceived).toEqual(stored.triggerConfig.lastReceived);
  });

  it("regenerateWebhookToken régénère et n'est pas persisté", async () => {
    h.selectRows = [stored];
    await PATCH(json({ regenerateWebhookToken: true }) as never, patchParams);
    const cfg = h.updated!.triggerConfig as Record<string, unknown>;
    expect(cfg.token).not.toBe(stored.triggerConfig.token);
    expect(cfg.token).toMatch(/^[0-9a-f]{48}$/);
    expect(h.updated).not.toHaveProperty("regenerateWebhookToken");
  });

  it("un patch sans triggerConfig ne touche pas la config", async () => {
    h.selectRows = [stored];
    await PATCH(json({ name: "Nouveau" }) as never, patchParams);
    expect(h.updated).not.toHaveProperty("triggerConfig");
  });
});

describe("GET base-lié", () => {
  it("rend trigger_config complet à qui gère les automatisations", async () => {
    h.selectRows = [stored];
    const res = await GET(new Request("http://x"), dbParams);
    const [row] = await res.json();
    expect(row.triggerConfig.token).toBe(stored.triggerConfig.token);
    expect(row.triggerConfig.lastReceived).toBeTruthy();
  });

  it("n'expose ni jeton, ni secret, ni dernier corps sans droit de gestion", async () => {
    h.canManage = false;
    h.selectRows = [stored];
    const res = await GET(new Request("http://x"), dbParams);
    const [row] = await res.json();
    expect(row.triggerConfig).toEqual({});
  });
});

describe("point d'entrée public : lastReceived", () => {
  const tokenHex = "a".repeat(48);
  const hookParams = { params: Promise.resolve({ token: tokenHex }) };

  it("secret valide : enregistre taille, date et corps, sans en-tête", async () => {
    h.selectRows = [stored];
    const res = await HOOK(json({ hello: "x" }, { "x-webhook-secret": "b".repeat(48) }) as never, hookParams);
    expect(res.status).toBe(200);
    expect(h.updated).toBeTruthy();
    const lr = writtenLastReceived()!;
    expect(lr.body).toEqual({ hello: "x" });
    expect(lr.size).toBe(13);
    expect(typeof lr.at).toBe("string");
    expect(Object.keys(lr).sort()).toEqual(["at", "body", "size"]);
  });

  it("corps de plus de 16 Ko : body null et truncated", async () => {
    h.selectRows = [stored];
    await HOOK(json({ big: "y".repeat(20000) }, { "x-webhook-secret": "b".repeat(48) }) as never, hookParams);
    const lr = writtenLastReceived()!;
    expect(lr.body).toBeNull();
    expect(lr.truncated).toBe(true);
  });

  it("secret invalide : aucune écriture", async () => {
    h.selectRows = [stored];
    const res = await HOOK(json({ a: 1 }, { "x-webhook-secret": "faux" }) as never, hookParams);
    expect(res.status).toBe(404);
    expect(h.updated).toBeNull();
  });

  it("l'échec de l'écriture ne fait pas échouer la réception", async () => {
    h.selectRows = [stored];
    h.updateThrows = true;
    const res = await HOOK(json({ a: 1 }, { "x-webhook-secret": "b".repeat(48) }) as never, hookParams);
    expect(res.status).toBe(200);
    expect(h.executeCalls).toBe(1);
  });

  describe("filtre par formulaire Tally", () => {
    // Sans eventType : la réservation de soumission (base mockée ici) n'intervient pas.
    const tally = (formId: string) => ({ data: { formId, fields: [] } });
    const hdr = { "x-webhook-secret": "b".repeat(48) };
    const withForm = (cfg: Record<string, unknown>) => ({ ...stored, triggerConfig: { ...stored.triggerConfig, ...cfg } });

    it("même formulaire : déclenché", async () => {
      h.selectRows = [withForm({ tallyFormId: "wMeKx2" })];
      const res = await HOOK(json(tally("wMeKx2"), hdr) as never, hookParams);
      expect(res.status).toBe(200);
      expect(h.executeCalls).toBe(1);
      expect(writtenLastReceived()).not.toBeNull();
    });

    it("autre formulaire : ignoré, 2xx neutre, ni exécution ni lastReceived", async () => {
      h.selectRows = [withForm({ tallyFormId: "wMeKx2" })];
      const res = await HOOK(json(tally("autre"), hdr) as never, hookParams);
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({ status: "ignored" });
      expect(h.executeCalls).toBe(0);
      expect(h.updated).toBeNull();
    });

    it("pas de clé tallyFormId : déclenché comme avant", async () => {
      h.selectRows = [stored];
      const res = await HOOK(json(tally("n'importe lequel"), hdr) as never, hookParams);
      expect(res.status).toBe(200);
      expect(h.executeCalls).toBe(1);
    });
  });

  describe("automatisme désactivé", () => {
    const hdr = { "x-webhook-secret": "b".repeat(48) };
    const off = { ...stored, enabled: false };

    it("secret valide : enregistre lastReceived, n'exécute rien, répond 202", async () => {
      h.selectRows = [off];
      const res = await HOOK(json({ hello: "x" }, hdr) as never, hookParams);
      expect(res.status).toBe(202);
      expect(await res.json()).toEqual({ status: "received" });
      expect(h.executeCalls).toBe(0);
      expect(writtenLastReceived()!.body).toEqual({ hello: "x" });
    });

    it("réponse Tally avec secret valide : aucune réservation de soumission", async () => {
      h.reserve.mockClear();
      h.selectRows = [off];
      const body = { eventType: "FORM_RESPONSE", data: { responseId: "r1", formId: "f1", fields: [] } };
      const res = await HOOK(json(body, hdr) as never, hookParams);
      expect(res.status).toBe(202);
      expect(h.reserve).not.toHaveBeenCalled();
      expect(h.executeCalls).toBe(0);
    });

    it("secret invalide : 404 inchangé, aucune écriture", async () => {
      h.selectRows = [off];
      const res = await HOOK(json({ a: 1 }, { "x-webhook-secret": "faux" }) as never, hookParams);
      expect(res.status).toBe(404);
      expect(h.updated).toBeNull();
      expect(h.executeCalls).toBe(0);
    });

    it("activé : exécution comme avant", async () => {
      h.selectRows = [stored];
      const res = await HOOK(json({ a: 1 }, hdr) as never, hookParams);
      expect(res.status).toBe(200);
      expect(h.executeCalls).toBe(1);
    });

    it("autre formulaire Tally : ignoré sans écriture même désactivé", async () => {
      h.selectRows = [{ ...off, triggerConfig: { ...stored.triggerConfig, tallyFormId: "wMeKx2" } }];
      const res = await HOOK(json({ data: { formId: "autre", fields: [] } }, hdr) as never, hookParams);
      expect(await res.json()).toEqual({ status: "ignored" });
      expect(h.updated).toBeNull();
    });
  });
});
