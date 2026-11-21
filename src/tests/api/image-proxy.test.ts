import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { NextRequest } from "next/server";

vi.mock("@/lib/auth/get-user", () => ({
  getSessionUser: vi.fn().mockResolvedValue({ id: "user-1" }),
}));

// Anti-rebinding DNS : on neutralise la vraie résolution réseau dans les tests.
vi.mock("@/lib/security/url-validator-server", () => ({
  resolvePublicAddresses: vi.fn().mockResolvedValue([]),
  assertPublicHostname: vi.fn().mockResolvedValue(undefined),
}));

function makeReq(url: string | null) {
  const target = url
    ? `http://localhost/api/images/proxy?url=${encodeURIComponent(url)}`
    : `http://localhost/api/images/proxy`;
  return new NextRequest(target);
}

describe("GET /api/images/proxy", () => {
  beforeEach(() => vi.clearAllMocks());
  afterEach(() => vi.unstubAllGlobals());

  it("401 si non authentifié", async () => {
    const { getSessionUser } = await import("@/lib/auth/get-user");
    vi.mocked(getSessionUser).mockResolvedValueOnce(null);
    const { GET } = await import("@/app/api/images/proxy/route");
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const res = await GET(makeReq("https://example.com/a.jpg") as any);
    expect(res.status).toBe(401);
  });

  it("403 pour une cible privée (SSRF) — sans whitelist de domaine", async () => {
    const { GET } = await import("@/app/api/images/proxy/route");
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const res = await GET(makeReq("http://127.0.0.1/secret.png") as any);
    expect(res.status).toBe(403);
  });

  it("relaye une image depuis un domaine public ARBITRAIRE (hors banques connues)", async () => {
    const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47]);
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(png, {
          status: 200,
          headers: { "content-type": "image/jpeg" },
        })
      )
    );
    const { GET } = await import("@/app/api/images/proxy/route");
    const res = await GET(
      // domaine quelconque, jamais whitelisté auparavant
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      makeReq("https://www.example.org/logo.jpg") as any
    );
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("image/jpeg");
  });

  // Non-régression (revue adversariale du lot) : `image/jpg` et `image/x-png`
  // sont non standard mais courants sur des serveurs mal configurés, le
  // préfixe `image/` les laissait passer avant la liste blanche.
  it.each(["image/jpg", "image/x-png"])(
    "relaie une image dont le type non standard mais courant est %s",
    async (contentType) => {
      const bytes = new Uint8Array([1, 2, 3, 4]);
      vi.stubGlobal(
        "fetch",
        vi.fn().mockResolvedValue(
          new Response(bytes, { status: 200, headers: { "content-type": contentType } })
        )
      );
      const { GET } = await import("@/app/api/images/proxy/route");
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const res = await GET(makeReq("https://exemple.tld/logo.img") as any);
      expect(res.status).toBe(200);
      expect(res.headers.get("content-type")).toBe(contentType);
    }
  );

  // Le refus du SVG distant est voulu (exécutable par le navigateur) mais
  // doit rester exploitable côté UI : code et message stables dans le corps
  // JSON, à consommer par les parcours d'insertion d'image.
  it("refuse un SVG distant avec un corps JSON exploitable par l'UI", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response("<svg/>", { status: 200, headers: { "content-type": "image/svg+xml" } })
      )
    );
    const { GET } = await import("@/app/api/images/proxy/route");
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const res = await GET(makeReq("https://exemple.tld/logo.svg") as any);
    expect(res.status).toBe(422);
    const body = await res.json();
    expect(body.error).toBe("svg-not-supported");
    expect(body.message).toBeTruthy();
  });

  it("422 si le contenu distant n'est pas une image", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response("<html>", {
          status: 200,
          headers: { "content-type": "text/html" },
        })
      )
    );
    const { GET } = await import("@/app/api/images/proxy/route");
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const res = await GET(makeReq("https://example.com/page.html") as any);
    expect(res.status).toBe(422);
  });

  // Non-régression INJ-08 / volet redirections d'INJ-04 (audit du 2026-08-19) :
  // le fetch passe désormais par `safeExternalFetch` plutôt qu'un `redirect:
  // "follow"` en aveugle. Motif de vérification : « répond une erreur ET ne
  // fait rien » : chaque refus est prouvé par l'absence d'appel réseau.

  it("403 pour une adresse privée littérale, sans émettre aucune requête", async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    const { GET } = await import("@/app/api/images/proxy/route");
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const res = await GET(makeReq("http://127.0.0.1/secret.png") as any);
    expect(res.status).toBe(403);
    expect(fetchSpy).not.toHaveBeenCalled();
    const body = await res.text();
    // Le message ne doit pas cartographier le réseau interne.
    expect(body).not.toMatch(/127\.0\.0\.1|dns|résolu/i);
  });

  it("403 pour un nom public qui résout vers une adresse privée (DNS rebinding)", async () => {
    const { resolvePublicAddresses: assertPublicHostname } = await import("@/lib/security/url-validator-server");
    vi.mocked(assertPublicHostname).mockRejectedValueOnce(new Error("privée"));
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    const { GET } = await import("@/app/api/images/proxy/route");
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const res = await GET(makeReq("https://rebind.attaquant.tld/logo.png") as any);
    expect(res.status).toBe(403);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("bloque une redirection vers le réseau interne, le second saut n'est jamais émis", async () => {
    const fetchSpy = vi.fn().mockResolvedValueOnce(
      new Response(null, {
        status: 302,
        headers: { location: "http://169.254.169.254/latest/meta-data/" },
      })
    );
    vi.stubGlobal("fetch", fetchSpy);
    const { GET } = await import("@/app/api/images/proxy/route");
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const res = await GET(makeReq("https://exemple.tld/logo.png") as any);
    expect(res.status).toBe(403);
    // Un seul saut émis (le départ), jamais la cible interne.
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });
});
