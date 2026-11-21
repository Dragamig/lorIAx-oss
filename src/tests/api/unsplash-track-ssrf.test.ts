/**
 * Non-régression P0-1 / INJ-02 / AZ-03 (audit du 2026-08-19).
 *
 * `GET /api/studio/unsplash/track?url=…` passait l'URL du client à `fetch`
 * avec la clé Unsplash de l'organisation déchiffrée dans un en-tête
 * `Authorization` : exfiltration du secret vers l'hôte de l'appelant, et SSRF
 * aveugle vers le réseau interne du déploiement.
 *
 * Motif de vérification : la réponse reste un 204 muet dans tous les cas, donc
 * l'absence d'effet de bord se prouve sur la requête sortante, qui ne doit
 * partir que vers `api.unsplash.com`.
 *
 * Ce fichier mocke intégralement `requireOrgScoped` : ses tests de
 * cloisonnement (401/404) ne prouvent que la propagation de l'erreur du
 * helper, jamais que la vérification d'appartenance à l'organisation est
 * réellement effectuée. Le cloisonnement avec le VRAI helper est couvert par
 * la suite jumelle `unsplash-track-siloing.test.ts`, sur le modèle de
 * `studio-images-siloing.test.ts`.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

const h = vi.hoisted(() => {
  /** Réplique locale : importer le vrai module tirerait next-auth dans le test. */
  class OrgScopeError extends Error {
    constructor(
      public readonly response: Response,
      public readonly reason: string,
    ) {
      super(reason);
    }
  }
  return {
    requireOrgScoped: vi.fn(),
    decrypt: vi.fn(),
    fetch: vi.fn(),
    OrgScopeError,
  };
});

vi.mock("@/lib/auth/require-org-scoped", () => ({
  requireOrgScoped: h.requireOrgScoped,
  OrgScopeError: h.OrgScopeError,
}));
vi.mock("@/lib/db", () => ({
  db: {
    select: vi.fn(() => ({
      from: vi.fn().mockReturnThis(),
      where: vi.fn().mockReturnThis(),
      limit: vi.fn().mockResolvedValue([{ apiKeyEnc: "chiffre" }]),
    })),
  },
}));
vi.mock("@/lib/crypto", () => ({ decrypt: h.decrypt }));
vi.mock("next/headers", () => ({
  headers: vi.fn().mockResolvedValue({ get: () => "acme" }),
}));
vi.mock("server-only", () => ({}));

import { GET } from "@/app/api/studio/unsplash/track/route";
import { NextResponse } from "next/server";

function call(url: string | null) {
  const target = url
    ? `http://acme.example.com/api/studio/unsplash/track?url=${encodeURIComponent(url)}`
    : "http://acme.example.com/api/studio/unsplash/track";
  return GET(new NextRequest(target));
}

beforeEach(() => {
  vi.clearAllMocks();
  h.requireOrgScoped.mockResolvedValue({
    user: { id: "mallory", globalRole: "user" },
    orgId: "org-1",
    orgSlug: "acme",
  });
  h.decrypt.mockReturnValue("CLE-UNSPLASH-SECRETE");
  vi.stubGlobal("fetch", h.fetch);
  h.fetch.mockResolvedValue(new Response(null, { status: 200 }));
});

describe("GET /api/studio/unsplash/track", () => {
  it("401 sans session", async () => {
    h.requireOrgScoped.mockRejectedValue(
      new h.OrgScopeError(
        NextResponse.json({ error: "Non authentifié" }, { status: 401 }),
        "unauthenticated",
      ),
    );
    const res = await call("https://api.unsplash.com/photos/x/download");
    expect(res.status).toBe(401);
    expect(h.fetch).not.toHaveBeenCalled();
    expect(h.decrypt).not.toHaveBeenCalled();
    // La route délègue bien la résolution de l'organisation au helper, sans
    // requête additionnelle : c'est le seul comportement que ce fichier peut
    // prouver puisque le helper est mocké dans son ensemble.
    expect(h.requireOrgScoped).toHaveBeenCalledTimes(1);
    expect(h.requireOrgScoped).toHaveBeenCalledWith({}, expect.any(NextRequest));
  });

  it("404 sans déchiffrer la clé quand le sous-domaine vise une organisation étrangère", async () => {
    // Constat P0-6 / AZ-12 : la résolution par slug ne contrôlait pas
    // l'appartenance, donc un membre d'un autre tenant consommait la clé
    // Unsplash de l'organisation visée.
    h.requireOrgScoped.mockRejectedValue(
      new h.OrgScopeError(NextResponse.json({ error: "Introuvable" }, { status: 404 }), "no-org"),
    );
    const res = await call("https://api.unsplash.com/photos/x/download");
    expect(res.status).toBe(404);
    expect(h.decrypt).not.toHaveBeenCalled();
    expect(h.fetch).not.toHaveBeenCalled();
  });

  it("n'émet aucune requête vers un hôte étranger, donc ne fuite pas la clé", async () => {
    const res = await call("https://collecteur.attaquant.tld/x");

    expect(res.status).toBe(204);
    expect(h.fetch).not.toHaveBeenCalled();
  });

  it("n'atteint pas le service de métadonnées du cloud", async () => {
    const res = await call("http://169.254.169.254/latest/meta-data/iam/");

    expect(res.status).toBe(204);
    expect(h.fetch).not.toHaveBeenCalled();
  });

  it("refuse un hôte qui se contente de préfixer le domaine d'Unsplash", async () => {
    const res = await call("https://api.unsplash.com.attaquant.tld/x");

    expect(res.status).toBe(204);
    expect(h.fetch).not.toHaveBeenCalled();
  });

  it("notifie bien Unsplash, avec la clé et sans suivre de redirection", async () => {
    const res = await call("https://api.unsplash.com/photos/abc/download?ixid=1");

    expect(res.status).toBe(204);
    expect(h.fetch).toHaveBeenCalledTimes(1);
    const [target, init] = h.fetch.mock.calls[0] as [URL, RequestInit];
    expect(String(target)).toContain("api.unsplash.com");
    expect((init.headers as Record<string, string>).Authorization).toContain(
      "CLE-UNSPLASH-SECRETE",
    );
    expect(init.redirect).toBe("error");
  });

  it("répond 204 sans rien émettre quand le paramètre est absent", async () => {
    const res = await call(null);
    expect(res.status).toBe(204);
    expect(h.fetch).not.toHaveBeenCalled();
  });
});
