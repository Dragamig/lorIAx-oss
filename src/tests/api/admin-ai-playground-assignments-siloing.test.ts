/**
 * Non-régression : cloisonnement du bac à sable d'inférence et portée instance
 * des assignations de modèle (constat AZ-06, lot 6).
 *
 * Deux trous que la remédiation initiale avait laissés ouverts :
 *
 * - `POST /api/admin/ai/playground` gardait le rôle `admin` puis chargeait le
 *   fournisseur par identifiant nu, déchiffrait sa clé d'API et exécutait
 *   l'inférence. L'administrateur de l'organisation A dépensait donc la clé de
 *   B, facturée à B. Motif de vérification : « répond 404 ET ne fait rien »,
 *   l'absence d'effet étant prouvée par le non-appel de `decrypt` et de
 *   `streamText`, pas par le seul code de retour.
 *
 * - `PUT /api/admin/ai/assignments` écrivait une table sans colonne
 *   d'organisation, à une ligne par usage, donc de portée instance : un
 *   administrateur d'organisation pouvait désactiver l'assignation, écraser le
 *   délai et le nombre de tentatives, ou repointer l'usage pour tous les
 *   tenants. Corollaire de l'ADR-079 : une ressource de portée instance se
 *   règle par le rôle, message `INSTANCE_ADMIN_ONLY_MESSAGE` en 403.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";
import { INSTANCE_ADMIN_ONLY_MESSAGE } from "@/lib/auth/rbac";

const h = vi.hoisted(() => ({
  getSessionUser: vi.fn(),
  getRequestOrgId: vi.fn(),
  decrypt: vi.fn((v: string) => `clair:${v}`),
  streamText: vi.fn(),
  providerRows: [] as unknown[],
  insertValues: [] as unknown[],
  updateCalls: { count: 0 },
}));

function chain(getRows: () => unknown[]) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const self: any = {
    then: (resolve: (v: unknown[]) => void, reject?: (e: unknown) => void) =>
      Promise.resolve(getRows()).then(resolve, reject),
  };
  for (const methode of ["from", "where", "set", "orderBy", "limit", "returning"]) {
    self[methode] = vi.fn(() => self);
  }
  return self;
}

vi.mock("@/lib/auth/get-user", () => ({ getSessionUser: h.getSessionUser }));
vi.mock("@/lib/org/get-request-org", () => ({ getRequestOrgId: h.getRequestOrgId }));
vi.mock("@/lib/crypto", () => ({
  encrypt: (v: string) => `enc:${v}`,
  decrypt: h.decrypt,
}));
vi.mock("ai", () => ({ streamText: h.streamText }));
vi.mock("@ai-sdk/anthropic", () => ({
  createAnthropic: () => ({ languageModel: () => ({ id: "anthropic" }) }),
}));
vi.mock("@ai-sdk/openai", () => ({
  createOpenAI: () => ({ languageModel: () => ({ id: "openai" }) }),
}));
vi.mock("@/lib/ai/usage-logger", () => ({ logAIUsage: vi.fn() }));
vi.mock("@/lib/db", () => ({
  db: {
    select: vi.fn(() => chain(() => h.providerRows)),
    insert: vi.fn(() => {
      const self = chain(() => []);
      self.values = vi.fn((v: unknown) => {
        h.insertValues.push(v);
        return self;
      });
      return self;
    }),
    update: vi.fn(() => {
      h.updateCalls.count += 1;
      return chain(() => []);
    }),
    delete: vi.fn(() => chain(() => [])),
  },
}));

const PROVIDER = "33333333-3333-4333-8333-333333333333";

const adminOrg = {
  id: "admin-a",
  name: "Admin A",
  email: "admin@org-a.test",
  globalRole: "admin",
};
const superAdmin = {
  id: "root",
  name: "Root",
  email: "root@loriax.test",
  globalRole: "super_admin",
};

const jsonReq = (url: string, method: string, body: unknown) =>
  new NextRequest(url, {
    method,
    body: JSON.stringify(body),
    headers: { "content-type": "application/json" },
  });

beforeEach(() => {
  vi.clearAllMocks();
  h.providerRows = [];
  h.insertValues.length = 0;
  h.updateCalls.count = 0;
  h.getSessionUser.mockResolvedValue(adminOrg);
  h.getRequestOrgId.mockResolvedValue("org-a");
  h.decrypt.mockImplementation((v: string) => `clair:${v}`);
  h.streamText.mockReturnValue({
    toTextStreamResponse: () => new Response("ok", { status: 200 }),
  });
});

describe("POST /api/admin/ai/playground : cloisonnement", () => {
  const playgroundReq = () =>
    jsonReq("http://localhost/api/admin/ai/playground", "POST", {
      providerId: PROVIDER,
      model: "gpt-x",
      userPrompt: "bonjour",
    });

  it("404 muet, aucune clé déchiffrée et aucune inférence pour un fournisseur d'un autre tenant", async () => {
    h.providerRows = [
      {
        id: PROVIDER,
        organizationId: "org-b",
        apiKeyEnc: "secret-de-org-b",
        connectorType: "openai_compatible",
      },
    ];

    const { POST } = await import("@/app/api/admin/ai/playground/route");
    const res = await POST(playgroundReq());

    // L'absence d'effet AVANT le code de retour : la clé de l'autre tenant
    // n'est ni déchiffrée, ni dépensée. C'est la propriété qui compte, un 404
    // rendu après une inférence déjà partie ne prouverait rien.
    expect(h.decrypt).not.toHaveBeenCalled();
    expect(h.streamText).not.toHaveBeenCalled();
    expect(res.status).toBe(404);
  });

  it("404 et aucune inférence quand aucune organisation n'est résolue (fail-closed)", async () => {
    h.providerRows = [
      {
        id: PROVIDER,
        organizationId: "org-a",
        apiKeyEnc: "secret",
        connectorType: "openai_compatible",
      },
    ];
    h.getRequestOrgId.mockResolvedValue(null);

    const { POST } = await import("@/app/api/admin/ai/playground/route");
    const res = await POST(playgroundReq());

    expect(h.decrypt).not.toHaveBeenCalled();
    expect(h.streamText).not.toHaveBeenCalled();
    expect(res.status).toBe(404);
  });

  it("un fournisseur de l'organisation reste utilisable", async () => {
    h.providerRows = [
      {
        id: PROVIDER,
        organizationId: "org-a",
        apiKeyEnc: "secret-de-org-a",
        connectorType: "openai_compatible",
      },
    ];

    const { POST } = await import("@/app/api/admin/ai/playground/route");
    const res = await POST(playgroundReq());

    expect(res.status).toBe(200);
    expect(h.decrypt).toHaveBeenCalledWith("secret-de-org-a");
    expect(h.streamText).toHaveBeenCalledOnce();
  });

  it("un fournisseur de portée instance reste utilisable par un admin d'organisation", async () => {
    // Lecture, pas écriture : c'est la configuration partagée qui sert déjà à
    // toute l'inférence de l'instance.
    h.providerRows = [
      {
        id: PROVIDER,
        organizationId: null,
        apiKeyEnc: "secret-instance",
        connectorType: "openai_compatible",
      },
    ];

    const { POST } = await import("@/app/api/admin/ai/playground/route");
    const res = await POST(playgroundReq());

    expect(res.status).toBe(200);
    expect(h.streamText).toHaveBeenCalledOnce();
  });
});

describe("/api/admin/ai/assignments : portée instance", () => {
  const putReq = (body: Record<string, unknown> = {}) =>
    jsonReq("http://localhost/api/admin/ai/assignments", "PUT", {
      usageType: "chat",
      providerId: PROVIDER,
      model: "gpt-x",
      timeoutSeconds: 1,
      maxRetries: 0,
      isEnabled: false,
      ...body,
    });

  it("PUT : 403 explicite et aucune écriture pour un admin d'organisation", async () => {
    const { PUT } = await import("@/app/api/admin/ai/assignments/route");
    const res = await PUT(putReq());

    // L'absence d'effet d'abord : ni altération, ni déni de service
    // inter-tenants, quel que soit le code de retour.
    expect(h.updateCalls.count).toBe(0);
    expect(h.insertValues).toHaveLength(0);
    expect(res.status).toBe(403);
    expect((await res.json()).error).toBe(INSTANCE_ADMIN_ONLY_MESSAGE);
  });

  it("PUT : le super_admin crée bien une assignation", async () => {
    h.getSessionUser.mockResolvedValue(superAdmin);
    h.providerRows = [];

    const { PUT } = await import("@/app/api/admin/ai/assignments/route");
    const res = await PUT(putReq());

    expect(res.status).toBe(200);
    expect(h.insertValues).toHaveLength(1);
  });

  it("PUT : le super_admin met bien à jour une assignation existante", async () => {
    h.getSessionUser.mockResolvedValue(superAdmin);
    h.providerRows = [{ id: "assign-1", usageType: "chat" }];

    const { PUT } = await import("@/app/api/admin/ai/assignments/route");
    const res = await PUT(putReq());

    expect(res.status).toBe(200);
    expect(h.updateCalls.count).toBe(1);
  });

  it("GET reste ouvert à l'administrateur d'organisation", async () => {
    // La lecture porte la configuration partagée de l'instance, jamais la
    // donnée d'un tenant : la fermer viderait l'écran d'assignation.
    h.providerRows = [{ id: "assign-1", usageType: "chat" }];

    const { GET } = await import("@/app/api/admin/ai/assignments/route");
    const res = await GET();

    expect(res.status).toBe(200);
  });
});
