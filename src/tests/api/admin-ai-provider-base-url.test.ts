/**
 * Non-régression : l'adresse de base d'un fournisseur d'IA est une cible de
 * requête sortante, contrôlée à l'écriture ET à l'émission (ADR-078, lot 6).
 *
 * Le cloisonnement du lot 6 a réservé à `super_admin` les deux routes qui
 * prennent une URL dans le CORPS de la requête (`providers/test` et
 * `providers/models`), au motif de ne pas laisser un scanner de réseau interne
 * à un administrateur d'organisation. Le contrôle restait contournable en DEUX
 * temps : la création de fournisseur, restée au rôle `admin`, acceptait
 * n'importe quelle adresse de base sans validation, et la détection de modèles
 * par identifiant de fournisseur, restée elle aussi au rôle `admin`, allait
 * ensuite l'appeler et relayait le résultat.
 *
 * Le correctif n'élève pas un rôle de plus, il valide la cible. Deux propriétés
 * distinctes sont prouvées ici :
 *
 * 1. une adresse de base refusée n'est JAMAIS stockée (aucun `db.insert`,
 *    aucun `db.update`) ;
 * 2. une adresse déjà en base ne produit AUCUNE requête sortante vers une cible
 *    interdite : ni protocole hors http(s), ni saut de redirection.
 *
 * L'auto-hébergement n'est pas cassé pour autant : un chemin passant vérifie
 * qu'une passerelle d'inférence du réseau local reste interrogeable, ce qui est
 * l'usage normal du produit et l'arbitrage explicite du lot 2.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { NextRequest } from "next/server";

const h = vi.hoisted(() => ({
  getSessionUser: vi.fn(),
  getRequestOrgId: vi.fn(),
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
  decrypt: (v: string) => v,
}));
vi.mock("@/lib/db", () => ({
  db: {
    select: vi.fn(() => chain(() => h.providerRows)),
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
    delete: vi.fn(() => chain(() => [])),
  },
}));

const PROVIDER = "33333333-3333-4333-8333-333333333333";
const URL_ROUTE = "http://localhost/api/admin/ai/providers";

// Adresses qu'aucun fournisseur d'IA légitime ne porte : elles ne servent qu'à
// faire lire un fichier local ou parler un protocole non HTTP au serveur.
const ADRESSES_REFUSEES = [
  "file:///etc/passwd",
  "gopher://127.0.0.1:11211/_stats",
  "pas-une-url-du-tout",
];

const jsonReq = (method: string, body: unknown) =>
  new NextRequest(URL_ROUTE, {
    method,
    body: JSON.stringify(body),
    headers: { "content-type": "application/json" },
  });

beforeEach(() => {
  vi.clearAllMocks();
  h.providerRows = [{ id: PROVIDER, organizationId: "org-a" }];
  h.insertValues.length = 0;
  h.updateCalls.count = 0;
  h.getSessionUser.mockResolvedValue({
    id: "admin-a",
    name: "Admin A",
    email: "admin@org-a.test",
    globalRole: "admin",
  });
  h.getRequestOrgId.mockResolvedValue("org-a");
});

describe("écriture d'un fournisseur : une adresse refusée n'est jamais stockée", () => {
  for (const adresse of ADRESSES_REFUSEES) {
    it(`POST refuse ${adresse} sans rien insérer`, async () => {
      const { POST } = await import("@/app/api/admin/ai/providers/route");
      const res = await POST(
        jsonReq("POST", {
          name: "mallory",
          displayName: "Mallory",
          apiBaseUrl: adresse,
        })
      );

      expect(res.status).toBe(400);
      // La propriété qui compte : rien n'atteint la base.
      expect(h.insertValues).toHaveLength(0);
    });

    it(`PATCH refuse ${adresse} sans rien écrire`, async () => {
      const { PATCH } = await import("@/app/api/admin/ai/providers/route");
      const res = await PATCH(
        jsonReq("PATCH", { id: PROVIDER, apiBaseUrl: adresse })
      );

      expect(res.status).toBe(400);
      expect(h.updateCalls.count).toBe(0);
    });
  }

  it("POST accepte une passerelle d'inférence du réseau local (auto-hébergement)", async () => {
    const { POST } = await import("@/app/api/admin/ai/providers/route");
    const res = await POST(
      jsonReq("POST", {
        name: "ollama",
        displayName: "Ollama local",
        apiBaseUrl: "http://192.168.1.42:11434/v1",
      })
    );

    expect(res.status).toBe(201);
    expect(h.insertValues).toHaveLength(1);
    expect((h.insertValues[0] as { apiBaseUrl: string }).apiBaseUrl).toBe(
      "http://192.168.1.42:11434/v1"
    );
  });

  it("POST : la portée instance se demande explicitement et exige le rôle d'instance", async () => {
    // Le cloisonnement forçait l'organisation de la requête pour TOUS les
    // appelants : plus aucun verbe ne créait de ligne `organization_id IS NULL`,
    // alors que le module de portée et le résolveur bâtissent leur logique
    // dessus.
    const { POST } = await import("@/app/api/admin/ai/providers/route");

    const refus = await POST(
      jsonReq("POST", { name: "p", displayName: "P", scope: "instance" })
    );
    expect(refus.status).toBe(403);
    expect(h.insertValues).toHaveLength(0);

    h.getSessionUser.mockResolvedValue({
      id: "root",
      name: "Root",
      email: "root@loriax.test",
      globalRole: "super_admin",
    });
    const ok = await POST(
      jsonReq("POST", { name: "p", displayName: "P", scope: "instance" })
    );
    expect(ok.status).toBe(201);
    expect(h.insertValues).toHaveLength(1);
    expect(
      (h.insertValues[0] as { organizationId: string | null }).organizationId
    ).toBeNull();
  });

  it("POST : sans mention de portée, un super_admin reste dans son organisation", async () => {
    h.getSessionUser.mockResolvedValue({
      id: "root",
      name: "Root",
      email: "root@loriax.test",
      globalRole: "super_admin",
    });

    const { POST } = await import("@/app/api/admin/ai/providers/route");
    const res = await POST(jsonReq("POST", { name: "p", displayName: "P" }));

    expect(res.status).toBe(201);
    expect(
      (h.insertValues[0] as { organizationId: string | null }).organizationId
    ).toBe("org-a");
  });
});

/**
 * Second volet : l'émission. Ici `detect-models` n'est PAS doublé, c'est son
 * comportement réel qui est mesuré, seul `fetch` global est instrumenté. Ce que
 * l'on prouve, c'est l'absence de requête sortante vers une cible interdite,
 * pas seulement un code de retour.
 */
describe("émission : une adresse en base ne fait sortir aucune requête interdite", () => {
  const fetchMock = vi.fn();

  beforeEach(() => {
    fetchMock.mockReset();
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  for (const adresse of ADRESSES_REFUSEES) {
    it(`aucune requête sortante pour ${adresse}`, async () => {
      const { detectModels } = await import("@/lib/ai/detect-models");
      const res = await detectModels({
        connectorType: "openai_compatible",
        apiBaseUrl: adresse,
        apiKey: "cle",
      });

      expect(res.models).toEqual([]);
      expect(res.error).toBeTruthy();
      expect(fetchMock).not.toHaveBeenCalled();
    });
  }

  it("une redirection vers le service de métadonnées n'est jamais suivie", async () => {
    // Le canal de retour est fermé par le refus des sauts, pas par un blocage
    // des adresses privées : la première requête, elle, est légitime.
    //
    // Le double de `fetch` reproduit le comportement de la plateforme : tant
    // qu'on ne lui retire pas le suivi automatique (`redirect: "manual"` ou
    // `"error"`), c'est ELLE qui va chercher la cible de la redirection, et
    // l'appelant ne voit jamais la 302. Un double qui rendrait la 302 telle
    // quelle dans tous les cas ferait passer le test même sans correctif.
    const IMDS = "http://169.254.169.254/latest/meta-data/";
    fetchMock.mockImplementation(async (input: unknown, init?: RequestInit) => {
      const url = String(input);
      if (url.startsWith("http://169.254.169.254")) {
        return Response.json({ data: [{ id: "jeton-imds" }] }, { status: 200 });
      }
      if (init?.redirect !== "manual" && init?.redirect !== "error") {
        return fetchMock(IMDS, init);
      }
      return new Response(null, { status: 302, headers: { location: IMDS } });
    });

    const { detectModels } = await import("@/lib/ai/detect-models");
    const res = await detectModels({
      connectorType: "openai_compatible",
      apiBaseUrl: "http://192.168.1.42:11434/v1",
      apiKey: "cle",
    });

    const hotes = fetchMock.mock.calls.map((c) => new URL(String(c[0])).hostname);
    expect(hotes).not.toContain("169.254.169.254");
    // Toutes les tentatives sont restées sur l'hôte configuré.
    expect(hotes.every((hote) => hote === "192.168.1.42")).toBe(true);
    // Et rien du service de métadonnées ne remonte à l'appelant.
    expect(res.models).toEqual([]);
  });

  it("une passerelle du réseau local reste interrogeable (auto-hébergement)", async () => {
    fetchMock.mockResolvedValue(
      Response.json({ data: [{ id: "gemma4:e4b" }] }, { status: 200 })
    );

    const { detectModels } = await import("@/lib/ai/detect-models");
    const res = await detectModels({
      connectorType: "openai_compatible",
      apiBaseUrl: "http://192.168.1.42:11434/v1",
      apiKey: "cle",
    });

    expect(res.models).toEqual(["gemma4:e4b"]);
    expect(fetchMock).toHaveBeenCalled();
  });

  it("le connecteur Anthropic ne parle pas non plus à une cible hors http(s)", async () => {
    const { detectModels } = await import("@/lib/ai/detect-models");
    const res = await detectModels({
      connectorType: "anthropic",
      apiBaseUrl: "file:///etc/passwd",
      apiKey: "cle",
    });

    expect(res.models).toEqual([]);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("citer le domaine Infomaniak ne suffit pas à récupérer son traitement", async () => {
    // La branche Infomaniak envoie le token en en-tête vers une liste blanche
    // d'hôtes : elle était choisie sur une simple sous-chaîne de l'URL.
    // Une liste non vide : dans l'ancien code, elle déclenchait ensuite
    // l'appel au catalogue tarifaire Infomaniak, token en en-tête.
    fetchMock.mockResolvedValue(
      Response.json({ data: [{ id: "m1" }] }, { status: 200 })
    );

    const { detectModels } = await import("@/lib/ai/detect-models");
    await detectModels({
      connectorType: "openai_compatible",
      apiBaseUrl: "https://mallory.test/v1?ref=api.infomaniak.com",
      apiKey: "token-infomaniak",
    });

    // Comparaison sur le nom d'HÔTE : la chaîne complète contient le domaine,
    // puisque c'est précisément ce que l'URL de Mallory cite.
    const hotes = fetchMock.mock.calls.map((c) => new URL(String(c[0])).hostname);
    expect(hotes).not.toContain("api.infomaniak.com");
    expect(hotes.every((hote) => hote === "mallory.test")).toBe(true);
  });
});
