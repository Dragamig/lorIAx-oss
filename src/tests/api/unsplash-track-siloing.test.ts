/**
 * Non-régression P0-6 / AZ-12 (audit du 2026-08-19), suite jumelle de
 * `unsplash-track-ssrf.test.ts`.
 *
 * `unsplash-track-ssrf.test.ts` mocke intégralement `requireOrgScoped`, donc
 * ses tests de cloisonnement ne prouvent que la propagation de l'erreur du
 * helper, jamais que l'appartenance à l'organisation est vérifiée. Cette
 * suite utilise le VRAI `requireOrgScoped` (seuls la base et les en-têtes
 * sont mockés), sur le modèle de `studio-images-siloing.test.ts` : Mallory
 * est membre du seul tenant `acme`, et rejoue sa requête avec un en-tête
 * `x-org-slug: victime`.
 *
 * Motif de vérification : 404, et surtout ni `decrypt` ni `fetch` global ne
 * sont appelés, la clé Unsplash de l'organisation `victime` n'est donc jamais
 * déchiffrée ni exfiltrée. Un test de contrôle positif (Mallory sur `acme`)
 * prouve que la suite n'est pas vacuously true : le chemin légitime émet
 * bien la requête et déchiffre bien la clé.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

const h = vi.hoisted(() => ({
  getSessionUser: vi.fn(),
  decrypt: vi.fn(),
  fetch: vi.fn(),
  selectQueue: [] as unknown[][],
  selectCalls: { count: 0 },
}));

function chain(rows: unknown[]) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const self: any = {
    from: vi.fn().mockReturnThis(),
    where: vi.fn().mockReturnThis(),
    limit: vi.fn().mockResolvedValue(rows),
  };
  return self;
}

vi.mock("@/lib/auth/get-user", () => ({ getSessionUser: h.getSessionUser }));
// `requireOrgScoped` ne recopie plus la règle de résolution d'organisation, il
// délègue à `resolveRequestOrg` (revue adversariale du lot 6, 2026-08-20).
// Celle-ci consulte l'organisation partagée par défaut pour la distinguer d'un
// tenant isolé : seule cette lecture-là est doublée ici, la règle de
// résolution reste exercée pour de vrai.
vi.mock("@/lib/org/get-org-id", () => ({
  getDefaultOrgId: async () => "org-par-defaut",
}));

vi.mock("@/lib/db", () => ({
  db: {
    select: vi.fn(() => {
      const rows = h.selectQueue[h.selectCalls.count] ?? [];
      h.selectCalls.count += 1;
      return chain(rows);
    }),
  },
}));
vi.mock("@/lib/crypto", () => ({ decrypt: h.decrypt }));
vi.mock("server-only", () => ({}));

import { GET } from "@/app/api/studio/unsplash/track/route";

/** Mallory est membre du seul tenant `acme`, jamais du tenant `victime`. */
const MALLORY = { id: "mallory", email: "mallory@acme.tld", globalRole: "user" };

function call(orgSlug: string, url: string) {
  const target = `http://${orgSlug}.example.com/api/studio/unsplash/track?url=${encodeURIComponent(url)}`;
  return GET(
    new NextRequest(target, { headers: { "x-org-slug": orgSlug } })
  );
}

/** L'organisation `victime` existe, mais Mallory n'y a aucune ligne d'appartenance. */
function queueNonMembre() {
  h.selectQueue.length = 0;
  h.selectQueue.push([{ id: "org-victime", slug: "victime", isActive: true }]);
  h.selectQueue.push([]);
  h.selectCalls.count = 0;
}

/** Mallory est bien membre de `acme`, la clé Unsplash de l'org est en base. */
function queueMembre() {
  h.selectQueue.length = 0;
  h.selectQueue.push([{ id: "org-acme", slug: "acme", isActive: true }]);
  h.selectQueue.push([{ organizationId: "org-acme" }]);
  h.selectQueue.push([{ apiKeyEnc: "chiffre" }]);
  h.selectCalls.count = 0;
}

beforeEach(() => {
  vi.clearAllMocks();
  h.getSessionUser.mockResolvedValue(MALLORY);
  h.decrypt.mockReturnValue("CLE-UNSPLASH-SECRETE");
  vi.stubGlobal("fetch", h.fetch);
  h.fetch.mockResolvedValue(new Response(null, { status: 200 }));
});

describe("GET /api/studio/unsplash/track — cloisonnement (helper réel)", () => {
  it("répond 404 et ne déchiffre ni n'émet rien pour le tenant victime", async () => {
    queueNonMembre();

    const res = await call("victime", "https://api.unsplash.com/photos/x/download");

    expect(res.status).toBe(404);
    expect(h.decrypt).not.toHaveBeenCalled();
    expect(h.fetch).not.toHaveBeenCalled();
    // Seules les requêtes du helper (organisation, appartenance) ont eu lieu :
    // la clé Unsplash de l'organisation victime n'est jamais lue.
    expect(h.selectCalls.count).toBe(2);
  });

  it("usage légitime préservé : un membre de acme déclenche bien la notification Unsplash", async () => {
    queueMembre();

    const res = await call("acme", "https://api.unsplash.com/photos/abc/download");

    expect(res.status).toBe(204);
    expect(h.decrypt).toHaveBeenCalledTimes(1);
    expect(h.fetch).toHaveBeenCalledTimes(1);
    const [target] = h.fetch.mock.calls[0] as [URL, RequestInit];
    expect(String(target)).toContain("api.unsplash.com");
  });
});
