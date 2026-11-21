/**
 * Non-régression : cloisonnement des fournisseurs d'IA d'administration
 * (`/api/admin/ai/providers` et son doublon `/api/admin/providers`),
 * constat AZ-06, lot 6.
 *
 * La table `ai_providers` porte une colonne `organization_id` qu'aucun des
 * quatre verbes ne lisait ni n'écrivait : le GET rendait la configuration de
 * tous les fournisseurs de tous les tenants, et le PATCH acceptait un
 * identifiant nu puis écrivait l'objet reçu, `apiBaseUrl` compris. Un admin de
 * l'organisation A repointait ainsi le fournisseur par défaut vers son propre
 * point d'écoute, et comme le résolveur de fournisseur sélectionne le
 * fournisseur par défaut sans clause d'organisation, toute l'inférence de
 * l'instance partait chez lui avec la clé d'API en en-tête.
 *
 * Deux portées coexistent : `organization_id` renseigné (ressource du tenant,
 * 404 muet sur dépareillement) et `organization_id` NULL (portée instance,
 * réglée par le rôle, 403 explicite conformément au corollaire de l'ADR-079).
 *
 * Motif de vérification : « répond 403 ou 404 ET ne fait rien », l'absence
 * d'effet étant prouvée par le non-appel de `db.update` / `db.delete` /
 * `db.insert`. Chaque refus est doublé d'un chemin passant.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";
import { INSTANCE_ADMIN_ONLY_MESSAGE } from "@/lib/auth/rbac";

const h = vi.hoisted(() => ({
  getSessionUser: vi.fn(),
  detectModels: vi.fn(),
  detectRerankModels: vi.fn(),
  getRequestOrgId: vi.fn(),
  providerRows: [] as unknown[],
  selectWhereCalls: { count: 0 },
  insertValues: [] as unknown[],
  updateCalls: { count: 0 },
  deleteCalls: { count: 0 },
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
vi.mock("@/lib/ai/detect-models", () => ({
  detectModels: h.detectModels,
  detectRerankModels: h.detectRerankModels,
}));
vi.mock("@/lib/crypto", () => ({
  encrypt: (v: string) => `enc:${v}`,
  decrypt: (v: string) => v,
}));
vi.mock("@/lib/db", () => ({
  db: {
    select: vi.fn(() => {
      const self = chain(() => h.providerRows);
      const where = self.where;
      self.where = vi.fn((...args: unknown[]) => {
        h.selectWhereCalls.count += 1;
        return where(...args);
      });
      return self;
    }),
    insert: vi.fn(() => {
      const self = chain(() => [{ id: "nouveau" }]);
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
    delete: vi.fn(() => {
      h.deleteCalls.count += 1;
      return chain(() => []);
    }),
  },
}));

const PROVIDER = "33333333-3333-4333-8333-333333333333";

const jsonReq = (url: string, method: string, body: unknown) =>
  new NextRequest(url, {
    method,
    body: JSON.stringify(body),
    headers: { "content-type": "application/json" },
  });

function aucuneEcriture() {
  expect(h.updateCalls.count).toBe(0);
  expect(h.deleteCalls.count).toBe(0);
  expect(h.insertValues).toHaveLength(0);
}

beforeEach(() => {
  vi.clearAllMocks();
  h.providerRows = [];
  h.selectWhereCalls.count = 0;
  h.insertValues.length = 0;
  h.updateCalls.count = 0;
  h.deleteCalls.count = 0;
  h.getSessionUser.mockResolvedValue({
    id: "admin-a",
    name: "Admin A",
    email: "admin@org-a.test",
    globalRole: "admin",
  });
  h.getRequestOrgId.mockResolvedValue("org-a");
  h.detectModels.mockResolvedValue({ models: ["m1"], details: [] });
  h.detectRerankModels.mockResolvedValue(["r1"]);
});

const surfaces: Array<{ nom: string; chemin: string; url: string }> = [
  {
    nom: "/api/admin/ai/providers",
    chemin: "@/app/api/admin/ai/providers/route",
    url: "http://localhost/api/admin/ai/providers",
  },
];

for (const surface of surfaces) {
  describe(`${surface.nom} : cloisonnement`, () => {
    it("GET filtre la liste par organisation", async () => {
      h.providerRows = [{ id: PROVIDER, organizationId: "org-a" }];

      const { GET } = await import(surface.chemin);
      const res = await GET();

      expect(res.status).toBe(200);
      // La lecture porte une clause d'organisation, elle n'est plus globale.
      expect(h.selectWhereCalls.count).toBe(1);
    });

    it("GET répond 404 quand aucune organisation n'est résolue (fail-closed)", async () => {
      h.getRequestOrgId.mockResolvedValue(null);

      const { GET } = await import(surface.chemin);
      const res = await GET();

      expect(res.status).toBe(404);
    });

    it("POST estampille l'organisation de la requête, jamais celle du corps", async () => {
      const { POST } = await import(surface.chemin);
      const res = await POST(
        jsonReq(surface.url, "POST", {
          name: "mallory",
          displayName: "Mallory",
          apiBaseUrl: "http://mallory.example",
          organizationId: "org-b",
        })
      );

      expect(res.status).toBe(201);
      expect(h.insertValues).toHaveLength(1);
      expect((h.insertValues[0] as { organizationId: string }).organizationId).toBe(
        "org-a"
      );
    });

    it("PATCH : 404 muet et aucune écriture sur un fournisseur d'un autre tenant", async () => {
      h.providerRows = [{ id: PROVIDER, organizationId: "org-b" }];

      const { PATCH } = await import(surface.chemin);
      const res = await PATCH(
        jsonReq(surface.url, "PATCH", {
          id: PROVIDER,
          apiBaseUrl: "http://mallory.example",
          isDefault: true,
        })
      );

      expect(res.status).toBe(404);
      expect((await res.json()).error).toBe("Fournisseur introuvable");
      aucuneEcriture();
    });

    it("PATCH : 403 explicite et aucune écriture sur un fournisseur de portée instance", async () => {
      h.providerRows = [{ id: PROVIDER, organizationId: null }];

      const { PATCH } = await import(surface.chemin);
      const res = await PATCH(
        jsonReq(surface.url, "PATCH", {
          id: PROVIDER,
          apiBaseUrl: "http://mallory.example",
        })
      );

      expect(res.status).toBe(403);
      expect((await res.json()).error).toBe(INSTANCE_ADMIN_ONLY_MESSAGE);
      aucuneEcriture();
    });

    it("PATCH : le super_admin écrit bien un fournisseur de portée instance", async () => {
      h.providerRows = [{ id: PROVIDER, organizationId: null }];
      h.getSessionUser.mockResolvedValue({
        id: "root",
        name: "Root",
        email: "root@loriax.test",
        globalRole: "super_admin",
      });

      const { PATCH } = await import(surface.chemin);
      const res = await PATCH(
        jsonReq(surface.url, "PATCH", { id: PROVIDER, defaultModel: "m" })
      );

      expect(res.status).toBe(200);
      expect(h.updateCalls.count).toBe(1);
    });

    it("PATCH : un fournisseur de l'organisation reste modifiable", async () => {
      h.providerRows = [{ id: PROVIDER, organizationId: "org-a" }];

      const { PATCH } = await import(surface.chemin);
      const res = await PATCH(
        jsonReq(surface.url, "PATCH", { id: PROVIDER, defaultModel: "m" })
      );

      expect(res.status).toBe(200);
      expect(h.updateCalls.count).toBe(1);
    });

    it("DELETE : 404 muet et aucune suppression sur un fournisseur d'un autre tenant", async () => {
      h.providerRows = [{ id: PROVIDER, organizationId: "org-b" }];

      const { DELETE } = await import(surface.chemin);
      const res = await DELETE(jsonReq(surface.url, "DELETE", { id: PROVIDER }));

      expect(res.status).toBe(404);
      aucuneEcriture();
    });

    it("DELETE : un fournisseur de l'organisation reste supprimable", async () => {
      h.providerRows = [{ id: PROVIDER, organizationId: "org-a" }];

      const { DELETE } = await import(surface.chemin);
      const res = await DELETE(jsonReq(surface.url, "DELETE", { id: PROVIDER }));

      expect(res.status).toBe(200);
      expect(h.deleteCalls.count).toBe(1);
    });
  });
}

describe("GET /api/admin/ai/providers/[id]/models : cloisonnement", () => {
  const req = () =>
    new Request(`http://localhost/api/admin/ai/providers/${PROVIDER}/models`);
  const ctx = () => ({ params: Promise.resolve({ id: PROVIDER }) });

  it("404 muet et aucune requête sortante pour un fournisseur d'un autre tenant", async () => {
    // Cette route déchiffre la clé stockée et s'en sert pour interroger le
    // fournisseur : sans clause d'organisation, elle servait d'oracle sur la
    // configuration des autres tenants.
    h.providerRows = [{ id: PROVIDER, organizationId: "org-b" }];

    const { GET } = await import("@/app/api/admin/ai/providers/[id]/models/route");
    const res = await GET(req(), ctx());

    expect(res.status).toBe(404);
    expect(h.detectModels).not.toHaveBeenCalled();
    expect(h.detectRerankModels).not.toHaveBeenCalled();
  });

  it("404 quand aucune organisation n'est résolue (fail-closed)", async () => {
    h.providerRows = [{ id: PROVIDER, organizationId: "org-a" }];
    h.getRequestOrgId.mockResolvedValue(null);

    const { GET } = await import("@/app/api/admin/ai/providers/[id]/models/route");
    const res = await GET(req(), ctx());

    expect(res.status).toBe(404);
    expect(h.detectModels).not.toHaveBeenCalled();
  });

  it("détecte bien les modèles d'un fournisseur de l'organisation", async () => {
    h.providerRows = [{ id: PROVIDER, organizationId: "org-a", apiKeyEnc: null }];

    const { GET } = await import("@/app/api/admin/ai/providers/[id]/models/route");
    const res = await GET(req(), ctx());

    expect(res.status).toBe(200);
    expect(h.detectModels).toHaveBeenCalledOnce();
  });
});
