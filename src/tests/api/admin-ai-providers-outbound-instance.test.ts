/**
 * Non-régression : les routes sortantes qui acceptent une URL ET une clé
 * d'API dans le CORPS de la requête sont de portée instance
 * (`POST /api/admin/ai/providers/test` et
 * `POST /api/admin/ai/providers/models`), lot 6.
 *
 * L'en-tête de la route de test justifiait l'absence de blocage des adresses
 * privées par « réservée aux administrateurs globaux, donc pas de
 * franchissement de frontière de privilège ». L'ADR-079 a invalidé cette
 * prémisse : `admin` n'est plus un rôle d'instance, c'est un rôle borné à une
 * organisation. Laissées à `admin`, ces deux routes offraient donc à tout
 * administrateur d'organisation un scanner de réseau interne exécuté depuis le
 * serveur, avec relais de l'erreur du fournisseur.
 *
 * Le lot a traité les trois routes de test SMTP, Resend et LDAP sur ce même
 * raisonnement, en soulignant qu'elles n'acceptent PAS d'identifiants du
 * corps ; celles-ci en acceptent, ce qui les rend strictement plus dangereuses.
 *
 * Motif de vérification : « répond 403 ET n'émet aucune requête sortante »,
 * l'absence d'effet étant prouvée par le non-appel de `generateText` et de
 * `detectModels`.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";
import { INSTANCE_ADMIN_ONLY_MESSAGE } from "@/lib/auth/rbac";

const h = vi.hoisted(() => ({
  getSessionUser: vi.fn(),
  generateText: vi.fn(),
  detectModels: vi.fn(),
  fetch: vi.fn(),
}));

vi.mock("@/lib/auth/get-user", () => ({ getSessionUser: h.getSessionUser }));
vi.mock("ai", () => ({ generateText: h.generateText }));
vi.mock("@ai-sdk/anthropic", () => ({
  createAnthropic: () => ({ languageModel: () => ({ id: "anthropic" }) }),
}));
vi.mock("@ai-sdk/mistral", () => ({
  createMistral: () => ({ languageModel: () => ({ id: "mistral" }) }),
}));
vi.mock("@ai-sdk/openai", () => ({
  createOpenAI: () => ({ chat: () => ({ id: "openai-compatible" }) }),
}));
vi.mock("@/lib/ai/detect-models", () => ({
  detectModels: h.detectModels,
  detectRerankModels: vi.fn(),
}));

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

// Cible typique d'une cartographie de réseau interne depuis le serveur.
const CIBLE_INTERNE = "http://192.168.1.42:8080/v1";

const testReq = () =>
  new NextRequest("http://localhost/api/admin/ai/providers/test", {
    method: "POST",
    body: JSON.stringify({
      connectorType: "openai_compatible",
      apiBaseUrl: CIBLE_INTERNE,
      apiKey: "cle-de-mallory",
      model: "gemma4:e4b",
    }),
    headers: { "content-type": "application/json" },
  });

const modelsReq = () =>
  new NextRequest("http://localhost/api/admin/ai/providers/models", {
    method: "POST",
    body: JSON.stringify({
      connectorType: "openai_compatible",
      apiBaseUrl: CIBLE_INTERNE,
      apiKey: "cle-de-mallory",
    }),
    headers: { "content-type": "application/json" },
  });

beforeEach(() => {
  vi.clearAllMocks();
  h.generateText.mockResolvedValue({ text: "OK" });
  h.detectModels.mockResolvedValue({ models: ["m1"], details: [] });
  vi.stubGlobal("fetch", h.fetch);
});

describe("POST /api/admin/ai/providers/test : portée instance", () => {
  it("403 explicite et aucune requête sortante pour un admin d'organisation", async () => {
    h.getSessionUser.mockResolvedValue(adminOrg);

    const { POST } = await import("@/app/api/admin/ai/providers/test/route");
    const res = await POST(testReq());

    expect(res.status).toBe(403);
    expect((await res.json()).error).toBe(INSTANCE_ADMIN_ONLY_MESSAGE);
    expect(h.generateText).not.toHaveBeenCalled();
    expect(h.fetch).not.toHaveBeenCalled();
  });

  it("le super_admin teste bien un fournisseur", async () => {
    h.getSessionUser.mockResolvedValue(superAdmin);

    const { POST } = await import("@/app/api/admin/ai/providers/test/route");
    const res = await POST(testReq());

    expect(res.status).toBe(200);
    expect((await res.json()).success).toBe(true);
    expect(h.generateText).toHaveBeenCalledOnce();
  });
});

describe("POST /api/admin/ai/providers/models : portée instance", () => {
  it("403 explicite et aucune détection sortante pour un admin d'organisation", async () => {
    h.getSessionUser.mockResolvedValue(adminOrg);

    const { POST } = await import("@/app/api/admin/ai/providers/models/route");
    const res = await POST(modelsReq());

    expect(res.status).toBe(403);
    expect((await res.json()).error).toBe(INSTANCE_ADMIN_ONLY_MESSAGE);
    expect(h.detectModels).not.toHaveBeenCalled();
    expect(h.fetch).not.toHaveBeenCalled();
  });

  it("le super_admin détecte bien les modèles", async () => {
    h.getSessionUser.mockResolvedValue(superAdmin);

    const { POST } = await import("@/app/api/admin/ai/providers/models/route");
    const res = await POST(modelsReq());

    expect(res.status).toBe(200);
    expect(h.detectModels).toHaveBeenCalledOnce();
  });
});
