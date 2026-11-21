/**
 * Non-régression INJ-24 (audit du 2026-08-19).
 *
 * `POST /api/admin/ai/providers/test` et `GET|POST /api/admin/services/ollama-models`
 * font une requête sortante vers une URL de configuration (`apiBaseUrl` posté
 * par l'admin, ou `ollamaBaseUrl` de `system_settings`) sans contrainte de
 * protocole ni de redirection, et renvoyaient au client le message d'erreur
 * brut de la bibliothèque ou du réseau : oracle de cartographie du réseau
 * interne. Les deux routes sont réservées aux administrateurs globaux, donc
 * pas de franchissement de frontière de privilège : la correction porte sur
 * le protocole, les redirections et le contenu de l'erreur renvoyée, pas sur
 * un blocage des adresses privées (LorIAx est auto-hébergeable, pointer un
 * Ollama/vLLM interne est l'usage normal).
 *
 * Motif de vérification : pour chaque cas de refus, la route répond une
 * erreur ET n'émet aucune requête sortante.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

const h = vi.hoisted(() => ({
  getSessionUser: vi.fn(),
  generateText: vi.fn(),
  createOpenAICalls: [] as Array<{ baseURL?: string; fetch?: typeof fetch }>,
  dbWhereResult: [] as Array<{ value: unknown }>,
  fetch: vi.fn(),
}));

vi.mock("@/lib/auth/get-user", () => ({ getSessionUser: h.getSessionUser }));
vi.mock("server-only", () => ({}));

// --- Mocks spécifiques à /api/admin/ai/providers/test ---
vi.mock("ai", () => ({ generateText: h.generateText }));
vi.mock("@ai-sdk/anthropic", () => ({
  createAnthropic: () => ({ languageModel: () => ({ id: "anthropic-model" }) }),
}));
vi.mock("@ai-sdk/mistral", () => ({
  createMistral: () => ({ languageModel: () => ({ id: "mistral-model" }) }),
}));
vi.mock("@ai-sdk/openai", () => ({
  createOpenAI: (opts: { baseURL?: string; fetch?: typeof fetch }) => {
    h.createOpenAICalls.push(opts);
    return { chat: () => ({ id: "openai-compatible-model" }) };
  },
}));

// --- Mocks spécifiques à /api/admin/services/ollama-models ---
vi.mock("@/lib/db", () => ({
  db: {
    select: vi.fn(() => ({
      from: vi.fn().mockReturnThis(),
      where: vi.fn(() => Promise.resolve(h.dbWhereResult)),
    })),
  },
}));
vi.mock("@/lib/db/schema", () => ({ systemSettings: { key: "key", value: "value" } }));

import { POST as testProviderPOST } from "@/app/api/admin/ai/providers/test/route";
import { GET as ollamaModelsGET, POST as ollamaModelsPOST } from "@/app/api/admin/services/ollama-models/route";

function jsonRequest(url: string, body: unknown): NextRequest {
  return new NextRequest(url, {
    method: "POST",
    body: JSON.stringify(body),
    headers: { "Content-Type": "application/json" },
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  h.createOpenAICalls.length = 0;
  h.dbWhereResult.length = 0;
  // Administration d'instance : le téléchargement d'un modèle sur le serveur
  // d'inférence partagé y est réservé depuis le cloisonnement des réglages
  // (2026-08-20). Cette suite porte sur les protections SSRF, pas sur le rôle,
  // qui a sa propre suite (`admin-ollama-pull-instance.test.ts`).
  h.getSessionUser.mockResolvedValue({ id: "super-1", globalRole: "super_admin" });
  vi.stubGlobal("fetch", h.fetch);
});

describe("POST /api/admin/ai/providers/test", () => {
  it("refuse un protocole non http/https sans émettre de requête", async () => {
    const req = jsonRequest("http://example.com/api/admin/ai/providers/test", {
      connectorType: "openai_compatible",
      apiBaseUrl: "file:///etc/passwd",
      model: "llama3",
    });

    const res = await testProviderPOST(req);
    const body = await res.json();

    expect(res.status).toBe(400);
    expect(body.error).toBeTruthy();
    expect(h.generateText).not.toHaveBeenCalled();
    expect(h.createOpenAICalls).toHaveLength(0);
  });

  it("refuse une URL non analysable sans émettre de requête", async () => {
    const req = jsonRequest("http://example.com/api/admin/ai/providers/test", {
      connectorType: "openai_compatible",
      apiBaseUrl: "::::pas-une-url",
      model: "llama3",
    });

    const res = await testProviderPOST(req);

    expect(res.status).toBe(400);
    expect(h.generateText).not.toHaveBeenCalled();
  });

  it("ne renvoie ni hôte, ni code d'erreur système, ni pile dans le message d'échec", async () => {
    const erreurReseau = new Error(
      "connect ECONNREFUSED 10.0.4.17:11434\n    at TCPConnectWrap.afterConnect [as oncomplete] (node:net:1595:16)"
    );
    erreurReseau.name = "FetchError";
    h.generateText.mockRejectedValue(erreurReseau);

    const req = jsonRequest("http://example.com/api/admin/ai/providers/test", {
      connectorType: "openai_compatible",
      apiBaseUrl: "http://10.0.4.17:11434",
      model: "llama3",
    });

    const res = await testProviderPOST(req);
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.success).toBe(false);
    expect(body.error).not.toContain("10.0.4.17");
    expect(body.error).not.toContain("ECONNREFUSED");
    expect(body.error).not.toContain("node:net");
    expect(body.error).not.toContain("TCPConnectWrap");
  });

  it("distingue un délai dépassé d'un échec de connexion, sans révéler la cible", async () => {
    const timeout = new Error("The operation was aborted due to timeout");
    timeout.name = "TimeoutError";
    h.generateText.mockRejectedValue(timeout);

    const req = jsonRequest("http://example.com/api/admin/ai/providers/test", {
      connectorType: "openai_compatible",
      apiBaseUrl: "http://passerelle-interne.loriax.local:8080",
      model: "llama3",
    });

    const res = await testProviderPOST(req);
    const body = await res.json();

    expect(body.error).toContain("Délai dépassé");
    expect(body.error).not.toContain("passerelle-interne");
  });

  it("continue de fonctionner vers une cible interne légitime (usage auto-hébergé)", async () => {
    h.generateText.mockResolvedValue({ text: "OK" });

    const req = jsonRequest("http://example.com/api/admin/ai/providers/test", {
      connectorType: "openai_compatible",
      apiBaseUrl: "http://localhost:11434/v1",
      model: "llama3",
    });

    const res = await testProviderPOST(req);
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.success).toBe(true);
    expect(h.createOpenAICalls[0]?.baseURL).toBe("http://localhost:11434/v1");
  });

  it("ne suit aucune redirection sur la requête sortante", async () => {
    h.generateText.mockResolvedValue({ text: "OK" });

    const req = jsonRequest("http://example.com/api/admin/ai/providers/test", {
      connectorType: "openai_compatible",
      apiBaseUrl: "http://localhost:11434",
      model: "llama3",
    });

    await testProviderPOST(req);

    const customFetch = h.createOpenAICalls[0]?.fetch;
    expect(customFetch).toBeTypeOf("function");

    h.fetch.mockResolvedValue(new Response(null, { status: 200 }));
    await customFetch?.("http://localhost:11434/v1/chat/completions", { method: "POST" });

    const [, init] = h.fetch.mock.calls[0] as [unknown, RequestInit];
    expect(init.redirect).toBe("error");
  });

  // Non-régression (revue adversariale du lot) : une erreur qui vient du
  // fournisseur lui-même (réponse HTTP reçue, ici 401) doit rester
  // diagnosticable par l'admin — clé invalide, quota, modèle inconnu — sans
  // pour autant rouvrir l'oracle réseau sur les échecs de transport.
  it("distingue une erreur du fournisseur (401, clé invalide) d'un échec de transport", async () => {
    const erreurFournisseur = Object.assign(new Error("Invalid API key provided"), {
      name: "AI_APICallError",
      statusCode: 401,
    });
    h.generateText.mockRejectedValue(erreurFournisseur);

    const req = jsonRequest("http://example.com/api/admin/ai/providers/test", {
      connectorType: "openai_compatible",
      apiBaseUrl: "http://localhost:11434",
      model: "llama3",
    });

    const res = await testProviderPOST(req);
    const body = await res.json();

    expect(body.success).toBe(false);
    expect(body.error).toContain("401");
    expect(body.error).toContain("Invalid API key provided");
  });

  it("tronque un message d'erreur fournisseur trop long", async () => {
    const messageLong = "x".repeat(2000);
    const erreurFournisseur = Object.assign(new Error(messageLong), {
      name: "AI_APICallError",
      statusCode: 400,
    });
    h.generateText.mockRejectedValue(erreurFournisseur);

    const req = jsonRequest("http://example.com/api/admin/ai/providers/test", {
      connectorType: "openai_compatible",
      apiBaseUrl: "http://localhost:11434",
      model: "llama3",
    });

    const res = await testProviderPOST(req);
    const body = await res.json();

    expect(body.error.length).toBeLessThan(messageLong.length);
  });

  it("donne un message distinct pour une redirection refusée (http saisi, passerelle en https)", async () => {
    const erreurRedirection = Object.assign(new Error("Cannot connect to API: unexpected redirect"), {
      name: "AI_APICallError",
    });
    h.generateText.mockRejectedValue(erreurRedirection);

    const req = jsonRequest("http://example.com/api/admin/ai/providers/test", {
      connectorType: "openai_compatible",
      apiBaseUrl: "http://passerelle-interne.loriax.local:8080",
      model: "llama3",
    });

    const res = await testProviderPOST(req);
    const body = await res.json();

    expect(body.error).toContain("redirection");
    expect(body.error).not.toContain("passerelle-interne");
  });

  // Une APICallError sans statusCode (échec de transport enveloppé par le
  // SDK) ne doit jamais relayer son message brut : il peut porter l'adresse
  // ou le code d'erreur réseau (ECONNREFUSED, résolution DNS...).
  it("reste générique pour un échec de transport enveloppé sans statusCode", async () => {
    const erreurTransport = Object.assign(
      new Error("Cannot connect to API: connect ECONNREFUSED 10.0.4.17:11434"),
      { name: "AI_APICallError" }
    );
    h.generateText.mockRejectedValue(erreurTransport);

    const req = jsonRequest("http://example.com/api/admin/ai/providers/test", {
      connectorType: "openai_compatible",
      apiBaseUrl: "http://10.0.4.17:11434",
      model: "llama3",
    });

    const res = await testProviderPOST(req);
    const body = await res.json();

    expect(body.error).not.toContain("10.0.4.17");
    expect(body.error).not.toContain("ECONNREFUSED");
  });
});

describe("GET /api/admin/services/ollama-models", () => {
  it("refuse un protocole non http/https sans émettre de requête", async () => {
    h.dbWhereResult.push({ value: { ollamaBaseUrl: "gopher://interne:70" } });

    const res = await ollamaModelsGET();
    const body = await res.json();

    expect(res.status).toBe(400);
    expect(body.error).toBeTruthy();
    expect(h.fetch).not.toHaveBeenCalled();
  });

  it("ne renvoie ni hôte ni détail réseau quand Ollama est injoignable", async () => {
    h.dbWhereResult.push({ value: { ollamaBaseUrl: "http://10.20.30.40:11434" } });
    const erreur = new Error("connect ECONNREFUSED 10.20.30.40:11434");
    h.fetch.mockRejectedValue(erreur);

    const res = await ollamaModelsGET();
    const body = await res.json();

    expect(res.status).toBe(502);
    expect(body.error).not.toContain("10.20.30.40");
    expect(body.error).not.toContain("ECONNREFUSED");
  });

  it("continue de fonctionner vers une cible interne légitime (repli localhost)", async () => {
    h.dbWhereResult.push({ value: {} });
    h.fetch.mockResolvedValue(new Response(JSON.stringify({ models: [] }), { status: 200 }));

    const res = await ollamaModelsGET();
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.models).toEqual([]);
    const [target, init] = h.fetch.mock.calls[0] as [string, RequestInit];
    expect(target).toContain("localhost:11434");
    expect(init.redirect).toBe("error");
  });

  // Non-régression (revue adversariale du lot) : un Ollama publié derrière un
  // proxy inverse en sous-chemin (ex. https://ia.exemple.fr/ollama) doit être
  // appelé sur .../ollama/api/tags, pas sur l'origine seule qui écraserait le
  // chemin configuré et renverrait un 404.
  it("préserve le chemin de l'URL configurée (proxy inverse en sous-chemin)", async () => {
    h.dbWhereResult.push({ value: { ollamaBaseUrl: "https://ia.exemple.fr/ollama" } });
    h.fetch.mockResolvedValue(new Response(JSON.stringify({ models: [] }), { status: 200 }));

    await ollamaModelsGET();

    const [target] = h.fetch.mock.calls[0] as [string, RequestInit];
    expect(target).toBe("https://ia.exemple.fr/ollama/api/tags");
  });

  it("normalise la barre oblique finale de l'URL configurée avant d'ajouter le suffixe", async () => {
    h.dbWhereResult.push({ value: { ollamaBaseUrl: "https://ia.exemple.fr/ollama/" } });
    h.fetch.mockResolvedValue(new Response(JSON.stringify({ models: [] }), { status: 200 }));

    await ollamaModelsGET();

    const [target] = h.fetch.mock.calls[0] as [string, RequestInit];
    expect(target).toBe("https://ia.exemple.fr/ollama/api/tags");
  });

  // Une 4xx vient d'Ollama lui-même (modèle inconnu, requête malformée) :
  // diagnosticable par l'admin, sans corps volumineux relayé tel quel.
  it("rend le détail d'une erreur 4xx renvoyée par Ollama lui-même", async () => {
    h.dbWhereResult.push({ value: { ollamaBaseUrl: "http://localhost:11434" } });
    h.fetch.mockResolvedValue(
      new Response(JSON.stringify({ error: "modèle inconnu" }), { status: 404 })
    );

    const res = await ollamaModelsGET();
    const body = await res.json();

    expect(res.status).toBe(400);
    expect(body.error).toContain("404");
    expect(body.error).toContain("modèle inconnu");
  });

  it("donne un message distinct pour une redirection refusée (http saisi, passerelle en https)", async () => {
    h.dbWhereResult.push({ value: { ollamaBaseUrl: "http://ia.exemple.fr" } });
    const erreurRedirection = new TypeError("fetch failed", {
      cause: new Error("unexpected redirect"),
    });
    h.fetch.mockRejectedValue(erreurRedirection);

    const res = await ollamaModelsGET();
    const body = await res.json();

    expect(body.error).toContain("redirection");
    expect(body.error).not.toContain("ia.exemple.fr");
  });
});

describe("POST /api/admin/services/ollama-models", () => {
  it("refuse un protocole non http/https sans émettre de requête", async () => {
    h.dbWhereResult.push({ value: { ollamaBaseUrl: "file:///etc/passwd" } });

    const req = jsonRequest("http://example.com/api/admin/services/ollama-models", {
      name: "llama3",
    });

    const res = await ollamaModelsPOST(req);
    const body = await res.json();

    expect(res.status).toBe(400);
    expect(body.error).toBeTruthy();
    expect(h.fetch).not.toHaveBeenCalled();
  });

  it("ne renvoie pas le corps de réponse brut du service distant contacté", async () => {
    h.dbWhereResult.push({ value: { ollamaBaseUrl: "http://10.20.30.40:11434" } });
    h.fetch.mockResolvedValue(
      new Response("panneau-interne-admin sur 10.20.30.40, version 1.2.3", { status: 500 })
    );

    const req = jsonRequest("http://example.com/api/admin/services/ollama-models", {
      name: "llama3",
    });

    const res = await ollamaModelsPOST(req);
    const body = await res.json();

    expect(res.status).toBe(502);
    expect(body.error).not.toContain("panneau-interne-admin");
    expect(body.error).not.toContain("10.20.30.40");
  });

  it("ne suit aucune redirection sur la requête sortante", async () => {
    h.dbWhereResult.push({ value: { ollamaBaseUrl: "http://localhost:11434" } });
    h.fetch.mockResolvedValue(new Response(JSON.stringify({ status: "success" }), { status: 200 }));

    const req = jsonRequest("http://example.com/api/admin/services/ollama-models", {
      name: "llama3",
    });

    await ollamaModelsPOST(req);

    const [, init] = h.fetch.mock.calls[0] as [string, RequestInit];
    expect(init.redirect).toBe("error");
  });

  it("préserve le chemin de l'URL configurée (proxy inverse en sous-chemin)", async () => {
    h.dbWhereResult.push({ value: { ollamaBaseUrl: "https://ia.exemple.fr/ollama" } });
    h.fetch.mockResolvedValue(new Response(JSON.stringify({ status: "success" }), { status: 200 }));

    const req = jsonRequest("http://example.com/api/admin/services/ollama-models", {
      name: "llama3",
    });
    await ollamaModelsPOST(req);

    const [target] = h.fetch.mock.calls[0] as [string, RequestInit];
    expect(target).toBe("https://ia.exemple.fr/ollama/api/pull");
  });

  // Cas le plus fréquent d'une 4xx au pull : une faute de frappe dans le nom
  // du modèle. Le message générique précédent ("vérifiez qu'Ollama est
  // démarré") était faux dans ce cas et n'aidait pas l'admin.
  it("rend le détail d'une 4xx au pull (faute de frappe dans le nom du modèle)", async () => {
    h.dbWhereResult.push({ value: { ollamaBaseUrl: "http://localhost:11434" } });
    h.fetch.mockResolvedValue(
      new Response(JSON.stringify({ error: 'model "llam3-typo" not found' }), { status: 404 })
    );

    const req = jsonRequest("http://example.com/api/admin/services/ollama-models", {
      name: "llam3-typo",
    });
    const res = await ollamaModelsPOST(req);
    const body = await res.json();

    expect(res.status).toBe(400);
    expect(body.error).toContain("not found");
  });
});
