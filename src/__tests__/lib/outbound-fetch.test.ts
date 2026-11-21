/**
 * Requêtes sortantes contrôlées — `src/lib/security/outbound-fetch.ts`.
 *
 * Non-régression des constats P0-1 / INJ-02, INJ-07, INJ-08 de l'audit du
 * 2026-08-19 : une URL fournie par l'utilisateur ne doit jamais atteindre le
 * réseau interne, ni emporter un secret vers un hôte non prévu, ni gagner
 * l'intérieur par une redirection.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const h = vi.hoisted(() => ({
  assertPublicHostname: vi.fn(),
  fetch: vi.fn(),
}));

vi.mock("server-only", () => ({}));
vi.mock("@/lib/security/url-validator-server", () => ({
  resolvePublicAddresses: h.assertPublicHostname,
}));

import {
  fetchAllowlistedHost,
  safeExternalFetch,
  OutboundRequestError,
} from "@/lib/security/outbound-fetch";

/** Réponse minimale, avec les en-têtes qui pilotent le suivi de redirection. */
function reply(status: number, headers: Record<string, string> = {}): Response {
  return new Response(null, { status, headers });
}

beforeEach(() => {
  vi.clearAllMocks();
  h.assertPublicHostname.mockResolvedValue([]);
  vi.stubGlobal("fetch", h.fetch);
  h.fetch.mockResolvedValue(reply(200));
});

describe("fetchAllowlistedHost", () => {
  const hosts = ["api.unsplash.com"];

  it("appelle l'hôte autorisé sans suivre de redirection", async () => {
    await fetchAllowlistedHost("https://api.unsplash.com/photos/x/download", { hosts });

    expect(h.fetch).toHaveBeenCalledTimes(1);
    const init = h.fetch.mock.calls[0][1] as RequestInit;
    expect(init.redirect).toBe("error");
    expect(init.signal).toBeDefined();
  });

  it("accepte un sous-domaine de l'hôte autorisé", async () => {
    await fetchAllowlistedHost("https://images.api.unsplash.com/x", { hosts });
    expect(h.fetch).toHaveBeenCalledTimes(1);
  });

  it("refuse un hôte étranger et n'émet aucune requête", async () => {
    await expect(
      fetchAllowlistedHost("https://collecteur.attaquant.tld/x", { hosts }),
    ).rejects.toMatchObject({ reason: "host-not-allowed" });
    expect(h.fetch).not.toHaveBeenCalled();
  });

  it("refuse un hôte qui ne fait que contenir le nom autorisé", async () => {
    await expect(
      fetchAllowlistedHost("https://api.unsplash.com.attaquant.tld/x", { hosts }),
    ).rejects.toMatchObject({ reason: "host-not-allowed" });
    expect(h.fetch).not.toHaveBeenCalled();
  });

  it("refuse le HTTP en clair", async () => {
    await expect(
      fetchAllowlistedHost("http://api.unsplash.com/x", { hosts }),
    ).rejects.toMatchObject({ reason: "protocol" });
    expect(h.fetch).not.toHaveBeenCalled();
  });

  it("refuse une adresse du réseau interne", async () => {
    await expect(
      fetchAllowlistedHost("https://169.254.169.254/latest/meta-data/", { hosts }),
    ).rejects.toMatchObject({ reason: "host-not-allowed" });
    expect(h.fetch).not.toHaveBeenCalled();
  });

  it("refuse un hôte privé pourtant inscrit sur la liste blanche", async () => {
    // Défense en profondeur : si la liste s'élargit un jour à un hôte interne,
    // c'est ce contrôle, et non la liste, qui doit arrêter la requête.
    await expect(
      fetchAllowlistedHost("https://169.254.169.254/latest/meta-data/", {
        hosts: ["169.254.169.254"],
      }),
    ).rejects.toMatchObject({ reason: "private-address" });
    expect(h.fetch).not.toHaveBeenCalled();
  });

  it("refuse un sous-domaine autorisé qui pointe vers un littéral interne", async () => {
    await expect(
      fetchAllowlistedHost("https://[::1]/interne", { hosts: ["[::1]"] }),
    ).rejects.toMatchObject({ reason: "private-address" });
    expect(h.fetch).not.toHaveBeenCalled();
  });

  it("refuse une URL invalide", async () => {
    await expect(fetchAllowlistedHost("pas une url", { hosts })).rejects.toBeInstanceOf(
      OutboundRequestError,
    );
    expect(h.fetch).not.toHaveBeenCalled();
  });
});

describe("safeExternalFetch", () => {
  it("laisse passer une cible publique", async () => {
    const res = await safeExternalFetch("https://exemple.tld/data.json");
    expect(res.status).toBe(200);
    expect(h.assertPublicHostname).toHaveBeenCalledTimes(1);
    expect((h.fetch.mock.calls[0][1] as RequestInit).redirect).toBe("manual");
  });

  it("fige l'adresse validée à la connexion (anti DNS rebinding)", async () => {
    h.assertPublicHostname.mockResolvedValue([{ address: "203.0.113.34", family: 4 }]);
    await safeExternalFetch("https://exemple.tld/data.json");
    const dispatcher = (h.fetch.mock.calls[0][1] as { dispatcher?: { constructor: { name: string } } }).dispatcher;
    expect(dispatcher?.constructor.name).toBe("Agent");
  });

  it("n'ajoute aucun dispatcher pour un littéral IP", async () => {
    await safeExternalFetch("https://203.0.113.8/data.json");
    expect((h.fetch.mock.calls[0][1] as { dispatcher?: unknown }).dispatcher).toBeUndefined();
  });

  it("refuse une adresse privée littérale sans résoudre le DNS", async () => {
    await expect(safeExternalFetch("http://169.254.169.254/latest/meta-data/")).rejects.toMatchObject(
      { reason: "private-address" },
    );
    expect(h.fetch).not.toHaveBeenCalled();
  });

  it("refuse un protocole non HTTP", async () => {
    await expect(safeExternalFetch("file:///etc/passwd")).rejects.toMatchObject({
      reason: "protocol",
    });
    expect(h.fetch).not.toHaveBeenCalled();
  });

  it("refuse un nom public qui résout vers une adresse privée", async () => {
    h.assertPublicHostname.mockRejectedValue(new Error("privée"));
    await expect(safeExternalFetch("https://rebind.attaquant.tld/")).rejects.toMatchObject({
      reason: "private-address",
    });
    expect(h.fetch).not.toHaveBeenCalled();
  });

  it("revalide chaque redirection et bloque un saut vers le réseau interne", async () => {
    h.fetch.mockResolvedValueOnce(
      reply(302, { location: "http://169.254.169.254/latest/meta-data/" }),
    );

    await expect(safeExternalFetch("https://exemple.tld/depart")).rejects.toMatchObject({
      reason: "private-address",
    });
    // Le premier saut a été émis, le second jamais.
    expect(h.fetch).toHaveBeenCalledTimes(1);
  });

  it("suit une redirection vers une cible publique", async () => {
    h.fetch.mockResolvedValueOnce(reply(302, { location: "https://autre.tld/arrivee" }));

    const res = await safeExternalFetch("https://exemple.tld/depart");

    expect(res.status).toBe(200);
    expect(h.fetch).toHaveBeenCalledTimes(2);
    expect(h.assertPublicHostname).toHaveBeenCalledTimes(2);
  });

  it("refuse une chaîne de redirections trop longue", async () => {
    h.fetch.mockResolvedValue(reply(302, { location: "https://exemple.tld/encore" }));

    await expect(
      safeExternalFetch("https://exemple.tld/depart", { maxRedirects: 1 }),
    ).rejects.toMatchObject({ reason: "too-many-redirects" });
    expect(h.fetch).toHaveBeenCalledTimes(2);
  });

  it("refuse toute redirection quand maxRedirects vaut zéro", async () => {
    h.fetch.mockResolvedValue(reply(302, { location: "https://autre.tld/arrivee" }));

    await expect(
      safeExternalFetch("https://exemple.tld/depart", { maxRedirects: 0 }),
    ).rejects.toMatchObject({ reason: "too-many-redirects" });
    expect(h.fetch).toHaveBeenCalledTimes(1);
  });

  it("refuse une réponse dont la taille annoncée dépasse la borne", async () => {
    h.fetch.mockResolvedValue(reply(200, { "content-length": "999999" }));

    await expect(
      safeExternalFetch("https://exemple.tld/gros", { maxBytes: 1024 }),
    ).rejects.toMatchObject({ reason: "too-large" });
  });
});

describe("safeExternalFetch — en-têtes et méthode à travers une redirection", () => {
  /** Init du fetch émis au saut `index`. */
  function initAt(index: number): RequestInit {
    return h.fetch.mock.calls[index][1] as RequestInit;
  }

  /** En-têtes du fetch émis au saut `index`, normalisés. */
  function headersAt(index: number): Headers {
    return new Headers(initAt(index).headers);
  }

  it("retire les en-têtes d'identité quand la redirection change d'origine", async () => {
    h.fetch.mockResolvedValueOnce(reply(302, { location: "https://tiers.tld/arrivee" }));

    await safeExternalFetch("https://exemple.tld/depart", {
      init: {
        method: "POST",
        headers: {
          Authorization: "Bearer jeton-secret",
          Cookie: "session=abc",
          "Proxy-Authorization": "Basic xxx",
          "X-Custom": "garde-moi",
        },
        body: "{}",
      },
    });

    expect(headersAt(0).get("authorization")).toBe("Bearer jeton-secret");
    const relayed = headersAt(1);
    expect(relayed.get("authorization")).toBeNull();
    expect(relayed.get("cookie")).toBeNull();
    expect(relayed.get("proxy-authorization")).toBeNull();
    expect(relayed.get("x-custom")).toBe("garde-moi");
  });

  it("conserve les en-têtes d'identité sur une redirection de même origine", async () => {
    h.fetch.mockResolvedValueOnce(reply(307, { location: "https://exemple.tld/ailleurs" }));

    await safeExternalFetch("https://exemple.tld/depart", {
      init: { method: "POST", headers: { Authorization: "Bearer jeton" }, body: "{}" },
    });

    expect(headersAt(1).get("authorization")).toBe("Bearer jeton");
  });

  it("accepte un tableau de paires comme en-têtes", async () => {
    h.fetch.mockResolvedValueOnce(reply(302, { location: "https://tiers.tld/arrivee" }));

    await safeExternalFetch("https://exemple.tld/depart", {
      init: { headers: [["Authorization", "Bearer jeton"], ["X-Custom", "v"]] },
    });

    expect(headersAt(1).get("authorization")).toBeNull();
    expect(headersAt(1).get("x-custom")).toBe("v");
  });

  it("accepte un objet Headers comme en-têtes", async () => {
    h.fetch.mockResolvedValueOnce(reply(302, { location: "https://tiers.tld/arrivee" }));

    await safeExternalFetch("https://exemple.tld/depart", {
      init: { headers: new Headers({ Authorization: "Bearer jeton", "X-Custom": "v" }) },
    });

    expect(headersAt(1).get("authorization")).toBeNull();
    expect(headersAt(1).get("x-custom")).toBe("v");
  });

  it.each([301, 302, 303])("convertit un POST en GET sans corps sur %i", async (status) => {
    h.fetch.mockResolvedValueOnce(reply(status, { location: "https://tiers.tld/arrivee" }));

    await safeExternalFetch("https://exemple.tld/depart", {
      init: {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: '{"a":1}',
      },
    });

    const relayed = initAt(1);
    expect(relayed.method).toBe("GET");
    expect(relayed.body).toBeUndefined();
    expect(new Headers(relayed.headers).get("content-type")).toBeNull();
  });

  it("préserve méthode et corps sur une 307", async () => {
    h.fetch.mockResolvedValueOnce(reply(307, { location: "https://tiers.tld/arrivee" }));

    await safeExternalFetch("https://exemple.tld/depart", {
      init: { method: "POST", body: '{"a":1}' },
    });

    expect(initAt(1).method).toBe("POST");
    expect(initAt(1).body).toBe('{"a":1}');
  });
});

describe("safeExternalFetch — borne de taille sur les octets reçus", () => {
  /** Réponse en flux, sans `Content-Length`, comme un codage par blocs. */
  function chunked(chunks: number[]): Response {
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        for (const size of chunks) controller.enqueue(new Uint8Array(size));
        controller.close();
      },
    });
    return new Response(stream, { status: 200 });
  }

  it("refuse une réponse sans Content-Length qui dépasse la borne", async () => {
    h.fetch.mockResolvedValue(chunked([512, 512, 512]));

    await expect(
      safeExternalFetch("https://exemple.tld/flux", { maxBytes: 1024 }),
    ).rejects.toMatchObject({ reason: "too-large" });
  });

  it("rend une réponse sous la borne, lisible par l'appelant", async () => {
    h.fetch.mockResolvedValue(
      new Response('{"ok":true}', { status: 200, headers: { "content-type": "application/json" } }),
    );

    const res = await safeExternalFetch("https://exemple.tld/petit", { maxBytes: 1024 });

    expect(res.status).toBe(200);
    expect(res.ok).toBe(true);
    expect(res.headers.get("content-type")).toBe("application/json");
    await expect(res.json()).resolves.toEqual({ ok: true });
  });

  it("ne lit rien et rend la réponse telle quelle sans borne", async () => {
    const original = new Response("charge utile", { status: 200 });
    h.fetch.mockResolvedValue(original);

    const res = await safeExternalFetch("https://exemple.tld/sans-borne");

    expect(res).toBe(original);
    await expect(res.text()).resolves.toBe("charge utile");
  });

  it("laisse passer une réponse sans corps", async () => {
    h.fetch.mockResolvedValue(new Response(null, { status: 204 }));

    const res = await safeExternalFetch("https://exemple.tld/vide", { maxBytes: 1024 });
    expect(res.status).toBe(204);
  });
});
