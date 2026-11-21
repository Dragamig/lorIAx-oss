/**
 * Non-régression INJ-08 (audit du 2026-08-19).
 *
 * `POST /api/link-preview` rend au client le titre, la description et
 * l'image extraits de la page distante : un SSRF y est en lecture quasi
 * complète. La route doit passer par `safeExternalFetch` plutôt que par un
 * `fetch` dont seule la cible initiale était validée par syntaxe
 * (`validateExternalUrl`, sans résolution DNS, sans revalidation des
 * redirections).
 *
 * Motif de vérification : « répond une erreur ET ne fait rien ». Chaque cas
 * de refus est prouvé par l'absence d'appel réseau, pas seulement par le
 * code HTTP rendu.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { NextRequest } from "next/server";

const h = vi.hoisted(() => ({
  getSessionUser: vi.fn(),
  assertPublicHostname: vi.fn(),
  fetch: vi.fn(),
}));

vi.mock("@/lib/auth/get-user", () => ({ getSessionUser: h.getSessionUser }));
vi.mock("@/lib/security/url-validator-server", () => ({
  resolvePublicAddresses: h.assertPublicHostname,
  assertPublicHostname: h.assertPublicHostname,
}));
vi.mock("server-only", () => ({}));

import { POST } from "@/app/api/link-preview/route";

function call(url: string) {
  return POST(
    new NextRequest("http://localhost/api/link-preview", {
      method: "POST",
      body: JSON.stringify({ url }),
    }),
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  h.getSessionUser.mockResolvedValue({ id: "user-1" });
  h.assertPublicHostname.mockResolvedValue(undefined);
  vi.stubGlobal("fetch", h.fetch);
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("POST /api/link-preview", () => {
  it("refuse une adresse privée littérale sans émettre aucune requête", async () => {
    const res = await call("http://169.254.169.254/latest/meta-data/");

    expect(res.status).toBe(400);
    expect(h.fetch).not.toHaveBeenCalled();
    const json = await res.json();
    expect(json.error).not.toMatch(/169\.254|meta-data|dns|résolu/i);
  });

  it("refuse un nom public qui résout vers une adresse privée (DNS rebinding)", async () => {
    h.assertPublicHostname.mockRejectedValue(new Error("privée"));

    const res = await call("https://rebind.attaquant.tld/");

    expect(res.status).toBe(422);
    expect(h.fetch).not.toHaveBeenCalled();
    const json = await res.json();
    expect(json.error).not.toMatch(/attaquant|dns|résolu/i);
  });

  it("bloque une redirection vers le réseau interne, le second saut n'est jamais émis", async () => {
    h.fetch.mockResolvedValueOnce(
      new Response(null, {
        status: 302,
        headers: { location: "http://169.254.169.254/latest/meta-data/" },
      }),
    );

    const res = await call("https://exemple.tld/depart");

    expect(res.status).toBe(422);
    expect(h.fetch).toHaveBeenCalledTimes(1);
  });

  it("extrait les métadonnées d'une cible publique légitime", async () => {
    const html = "<html><head><title>Titre exemple</title></head><body></body></html>";
    h.fetch.mockResolvedValue(
      new Response(html, { status: 200, headers: { "content-type": "text/html" } }),
    );

    const res = await call("https://example.com/page");

    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.title).toBe("Titre exemple");
    expect(h.fetch).toHaveBeenCalledTimes(1);
    const init = h.fetch.mock.calls[0][1] as RequestInit;
    expect(init.redirect).toBe("manual");
  });

  // Non-régression : `WEBHOOK_ALLOW_PRIVATE_TARGETS` lève le refus des
  // adresses privées UNIQUEMENT pour les webhooks (voir dispatch.ts et
  // api/v1/webhooks). La route n'appelle `safeExternalFetch` avec aucune
  // option `allowPrivateTargets`, donc cette variable ne doit rien changer
  // ici : l'aperçu de lien reste fermé au réseau privé, variable posée ou non.
  it("reste fermée au réseau privé même si WEBHOOK_ALLOW_PRIVATE_TARGETS est activée", async () => {
    vi.stubEnv("WEBHOOK_ALLOW_PRIVATE_TARGETS", "true");

    const res = await call("http://169.254.169.254/latest/meta-data/");

    expect(res.status).toBe(400);
    expect(h.fetch).not.toHaveBeenCalled();
  });
});
