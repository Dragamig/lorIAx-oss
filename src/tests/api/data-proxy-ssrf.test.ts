/**
 * Non-régression INJ-08 (audit du 2026-08-19).
 *
 * `POST /api/data-proxy` rend au client le corps intégral de la réponse
 * distante (JSON ou CSV) : un SSRF y est en lecture complète, pas seulement
 * un aveuglement. La route doit passer par `safeExternalFetch` plutôt que
 * par un `fetch` en `follow` dont seule la cible initiale était validée par
 * syntaxe (`validateExternalUrl`, sans résolution DNS).
 *
 * Motif de vérification : « répond une erreur ET ne fait rien ». Chaque cas
 * de refus est prouvé par l'absence d'appel réseau, pas seulement par le
 * code HTTP rendu.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
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

import { POST } from "@/app/api/data-proxy/route";

function call(body: unknown) {
  return POST(
    new NextRequest("http://localhost/api/data-proxy", {
      method: "POST",
      body: JSON.stringify(body),
    }),
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  h.getSessionUser.mockResolvedValue({ id: "user-1" });
  h.assertPublicHostname.mockResolvedValue(undefined);
  vi.stubGlobal("fetch", h.fetch);
});

describe("POST /api/data-proxy, cas rest-api", () => {
  it("refuse une adresse privée littérale sans émettre aucune requête", async () => {
    const res = await call({ type: "rest-api", url: "http://169.254.169.254/latest/meta-data/" });

    expect(res.status).toBe(400);
    expect(h.fetch).not.toHaveBeenCalled();
    const json = await res.json();
    // Le message ne doit pas cartographier le réseau interne.
    expect(json.error).not.toMatch(/169\.254|meta-data|dns|résolu/i);
  });

  it("refuse un nom public qui résout vers une adresse privée (DNS rebinding)", async () => {
    h.assertPublicHostname.mockRejectedValue(new Error("privée"));

    const res = await call({ type: "rest-api", url: "https://rebind.attaquant.tld/data" });

    expect(res.status).toBe(400);
    expect(h.fetch).not.toHaveBeenCalled();
  });

  it("bloque une redirection vers le réseau interne, le second saut n'est jamais émis", async () => {
    h.fetch.mockResolvedValueOnce(
      new Response(null, {
        status: 302,
        headers: { location: "http://169.254.169.254/latest/meta-data/" },
      }),
    );

    const res = await call({ type: "rest-api", url: "https://api.exemple.tld/data" });

    expect(res.status).toBe(400);
    // Un seul saut émis (le départ), jamais la cible interne.
    expect(h.fetch).toHaveBeenCalledTimes(1);
  });

  it("récupère les données d'une cible publique légitime", async () => {
    h.fetch.mockResolvedValue(
      new Response(JSON.stringify([{ a: 1 }]), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );

    const res = await call({ type: "rest-api", url: "https://api.exemple.tld/data" });

    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.data).toEqual([{ a: 1 }]);
    expect(h.fetch).toHaveBeenCalledTimes(1);
    const init = h.fetch.mock.calls[0][1] as RequestInit;
    expect(init.redirect).toBe("manual");
  });
});

describe("POST /api/data-proxy, cas google-sheets", () => {
  it("continue de fonctionner : construit l'URL CSV et la récupère", async () => {
    h.fetch.mockResolvedValue(
      new Response("a,b\n1,2", { status: 200, headers: { "content-type": "text/csv" } }),
    );

    const res = await call({
      type: "google-sheets",
      url: "https://docs.google.com/spreadsheets/d/abc123XYZ/edit#gid=0",
      gid: "0",
    });

    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.csv).toContain("a,b");
    expect(h.fetch).toHaveBeenCalledTimes(1);
    const [target] = h.fetch.mock.calls[0] as [URL];
    expect(String(target)).toContain("docs.google.com/spreadsheets/d/abc123XYZ/export");
  });
});
